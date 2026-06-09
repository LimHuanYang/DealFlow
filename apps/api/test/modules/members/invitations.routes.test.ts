import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { EmailProvider, SendEmailInput, SendEmailOutput } from '@dealflow/email';
import type { PublicInvitation, PublicMember } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import type { FastifyInstance } from 'fastify';

/**
 * HTTP integration tests for the invitation endpoints (Phase D3).
 *
 * Membership seeding follows the same pattern as Phase C: sign up a fresh
 * user (creates their own throwaway org), then graft them into the *target*
 * org by inserting an `org_members` row and repointing their session's
 * `current_org_id` at it. This lets us drive the routes as different roles
 * (owner / admin / member) via cookies.
 */

interface SeededMember {
  cookie: string;
  userId: string;
}

interface SentRecord {
  to: string;
  subject: string;
  text: string;
  html?: string | undefined;
}

/**
 * Test double for the per-org EmailProvider override. Records every send so
 * tests can assert subject / body / accept URL.
 */
function makeFakeProvider(): { provider: EmailProvider; sent: SentRecord[] } {
  const sent: SentRecord[] = [];
  const provider: EmailProvider = {
    async send(input: SendEmailInput): Promise<SendEmailOutput> {
      sent.push({
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return { messageId: `<test-${sent.length}@dealflow>` };
    },
  };
  return { provider, sent };
}

async function seedMemberInOrg(
  app: FastifyInstance,
  testDb: TestDatabase,
  targetOrgId: string,
  role: 'owner' | 'admin' | 'member',
): Promise<SeededMember> {
  const auth = await signupTestUser(app);
  await testDb.db
    .insert(schema.orgMembers)
    .values({ organizationId: targetOrgId, userId: auth.userId, role });
  await testDb.db
    .update(schema.sessions)
    .set({ currentOrgId: targetOrgId })
    .where(eq(schema.sessions.userId, auth.userId));
  return { cookie: auth.cookie, userId: auth.userId };
}

describe('POST /api/v1/orgs/current/invitations (create)', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let sent: SentRecord[];

  let orgId: string;
  let owner: SeededMember;
  let admin: SeededMember;
  let member: SeededMember;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    sent = fake.sent;
    app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });

    const ownerAuth = await signupTestUser(app, { orgName: 'Acme HQ' });
    owner = { cookie: ownerAuth.cookie, userId: ownerAuth.userId };
    orgId = ownerAuth.orgId;
    admin = await seedMemberInOrg(app, testDb, orgId, 'admin');
    member = await seedMemberInOrg(app, testDb, orgId, 'member');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('admin creates an invitation; 201 with inviteUrl + PublicInvitation', async () => {
    sent.length = 0;
    const email = `invitee.${Date.now()}@external.com`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: admin.cookie },
      payload: { email, role: 'member' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      invitation: PublicInvitation;
      inviteUrl: string;
    };
    expect(body.invitation.email.toLowerCase()).toBe(email.toLowerCase());
    expect(body.invitation.role).toBe('member');
    expect(body.invitation.expiresAt).toBeTruthy();
    expect(body.inviteUrl).toMatch(/^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]+$/);

    // Provider called with subject containing the org name, body containing the URL.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
    expect(sent[0]!.subject).toContain('Acme HQ');
    expect(sent[0]!.text).toContain(body.inviteUrl);

    // Row exists in DB.
    const rows = await testDb.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, body.invitation.id));
    expect(rows).toHaveLength(1);
  });

  it('regular member → 403 FORBIDDEN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: member.cookie },
      payload: { email: `m.${Date.now()}@x.com`, role: 'member' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('admin trying to assign role=owner → 400 VALIDATION_FAILED (assignableRoleSchema)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: admin.cookie },
      payload: { email: `o.${Date.now()}@x.com`, role: 'owner' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('409 ALREADY_INVITED when email already has a pending invitation', async () => {
    const email = `dup.${Date.now()}@external.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: admin.cookie },
      payload: { email, role: 'member' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: admin.cookie },
      payload: { email, role: 'member' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_INVITED');
  });

  it('409 ALREADY_MEMBER when email already belongs to a member of the org', async () => {
    // The seeded admin is already in the org; look up their email and try
    // re-inviting them.
    const [u] = await testDb.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, admin.userId));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: u!.email, role: 'member' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_MEMBER');
  });
});

describe('POST /api/v1/orgs/current/invitations — no SMTP configured', () => {
  it('still returns 201 with inviteUrl when org has no SMTP', async () => {
    const testDb = await startTestPostgres();
    // NO emailProviderForOrg override → falls through to the default
    // per-org loader, which returns a Noop provider when SMTP isn't set.
    const app = await buildTestApp({ db: testDb.db });
    const owner = await signupTestUser(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: `nosmtp.${Date.now()}@x.com`, role: 'member' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { inviteUrl: string };
    expect(body.inviteUrl).toMatch(/^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]+$/);

    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/orgs/current/invitations/:id/resend', () => {
  it('admin resend bumps expiresAt; provider invoked again', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: `re.${Date.now()}@x.com`, role: 'member' },
    });
    const inv = (createRes.json() as { invitation: PublicInvitation }).invitation;
    const beforeMs = new Date(inv.expiresAt).getTime();
    fake.sent.length = 0;

    // Squeeze expiresAt closer to now so the bump is detectable.
    await testDb.db
      .update(schema.invitations)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.invitations.id, inv.id));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/current/invitations/${inv.id}/resend`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const updated = (res.json() as { invitation: PublicInvitation }).invitation;
    const afterMs = new Date(updated.expiresAt).getTime();
    expect(afterMs).toBeGreaterThan(beforeMs);
    expect(fake.sent).toHaveLength(1);

    await app.close();
    await testDb.stop();
  });
});

describe('DELETE /api/v1/orgs/current/invitations/:id', () => {
  it('admin revokes; row gone; returns 204', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: `del.${Date.now()}@x.com`, role: 'member' },
    });
    const inv = (createRes.json() as { invitation: PublicInvitation }).invitation;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/orgs/current/invitations/${inv.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);

    const rows = await testDb.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, inv.id));
    expect(rows).toHaveLength(0);

    await app.close();
    await testDb.stop();
  });
});

describe('GET /api/v1/orgs/current/members includes pending invitations', () => {
  it('returns the pending invitation in invitations[]', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);

    const email = `mem.${Date.now()}@x.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email, role: 'admin' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orgs/current/members',
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { members: PublicMember[]; invitations: PublicInvitation[] };
    expect(body.invitations.length).toBeGreaterThan(0);
    expect(body.invitations.some((i) => i.email.toLowerCase() === email.toLowerCase())).toBe(true);

    await app.close();
    await testDb.stop();
  });
});

describe('GET /api/v1/invitations/:token (public preview)', () => {
  it('unknown token → 404 INVITATION_NOT_FOUND', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/invitations/totally-unknown-token-xyz',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('INVITATION_NOT_FOUND');
    await app.close();
    await testDb.stop();
  });

  it('valid + email not registered → emailHasAccount: false', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app, { orgName: 'Acme PVT' });
    const inviteEmail = `newuser.${Date.now()}@external.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: inviteEmail, role: 'admin' },
    });
    const [row] = await testDb.db.select().from(schema.invitations);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invitations/${row!.token}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orgName).toBe('Acme PVT');
    expect(body.role).toBe('admin');
    expect(body.emailHasAccount).toBe(false);
    expect(body.expired).toBe(false);
    await app.close();
    await testDb.stop();
  });

  it('valid + email already a user → emailHasAccount: true', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);
    // Create another signed-up user; we'll invite them into the first org.
    const existing = await signupTestUser(app);
    const [u] = await testDb.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, existing.userId));
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: u!.email, role: 'member' },
    });
    const [row] = await testDb.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.email, u!.email));
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invitations/${row!.token}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().emailHasAccount).toBe(true);
    await app.close();
    await testDb.stop();
  });

  it('already-accepted → 410 INVITATION_ALREADY_ACCEPTED', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: `acc.${Date.now()}@x.com`, role: 'member' },
    });
    const [row] = await testDb.db.select().from(schema.invitations);
    await testDb.db
      .update(schema.invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invitations.id, row!.id));

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invitations/${row!.token}`,
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('INVITATION_ALREADY_ACCEPTED');
    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/invitations/:token/accept', () => {
  it('new-user path: creates user, joins org, sets session cookie, 201', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app, { orgName: 'Invited Co' });
    const orgId = owner.orgId;
    const inviteEmail = `newjoin.${Date.now()}@external.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: inviteEmail, role: 'member' },
    });
    const [row] = await testDb.db.select().from(schema.invitations);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${row!.token}/accept`,
      payload: { name: 'New Joiner', password: 'CorrectHorseBatteryStaple1' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.organizationId).toBe(orgId);
    expect(body.role).toBe('member');

    // Session cookie was set.
    const sessionCookie = res.cookies.find((c) => c.name === 'dealflow_session');
    expect(sessionCookie).toBeDefined();
    const cookie = `${sessionCookie!.name}=${sessionCookie!.value}`;

    // GET /organizations/current via the new session returns the invited org.
    const orgRes = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/current',
      headers: { cookie },
    });
    expect(orgRes.statusCode).toBe(200);
    expect((orgRes.json() as { organization: { id: string } }).organization.id).toBe(orgId);

    // org_members row exists.
    const memberRows = await testDb.db
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.organizationId, orgId));
    expect(memberRows.some((r) => r.role === 'member')).toBe(true);

    await app.close();
    await testDb.stop();
  });

  it('existing-user, no session → 401 SIGNIN_REQUIRED', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);
    const existing = await signupTestUser(app);
    const [u] = await testDb.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, existing.userId));
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: u!.email, role: 'member' },
    });
    const [row] = await testDb.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.email, u!.email));

    // No cookie at all — should hit SIGNIN_REQUIRED.
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${row!.token}/accept`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('SIGNIN_REQUIRED');

    await app.close();
    await testDb.stop();
  });

  it('existing-user, valid session → 200; current_org_id updated', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app, { orgName: 'TargetOrg' });
    const existing = await signupTestUser(app);
    const [u] = await testDb.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, existing.userId));
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: u!.email, role: 'admin' },
    });
    const [row] = await testDb.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.email, u!.email));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${row!.token}/accept`,
      headers: { cookie: existing.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.organizationId).toBe(owner.orgId);
    expect(body.role).toBe('admin');

    // Session's current_org_id was updated.
    const cur = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/current',
      headers: { cookie: existing.cookie },
    });
    expect((cur.json() as { organization: { id: string } }).organization.id).toBe(owner.orgId);

    // Idempotent re-accept → 200.
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${row!.token}/accept`,
      headers: { cookie: existing.cookie },
      payload: {},
    });
    expect(res2.statusCode).toBe(200);
    // Only one org_members row for (orgId, existing.userId).
    const memberRows = await testDb.db
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.userId, existing.userId));
    const inTarget = memberRows.filter((r) => r.organizationId === owner.orgId);
    expect(inTarget).toHaveLength(1);

    await app.close();
    await testDb.stop();
  });

  it('expired token → 410 INVITATION_EXPIRED', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);
    const inviteEmail = `exp.${Date.now()}@external.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: inviteEmail, role: 'member' },
    });
    const [row] = await testDb.db.select().from(schema.invitations);

    // Fast-forward expiresAt to the past.
    await testDb.db
      .update(schema.invitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.invitations.id, row!.id));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${row!.token}/accept`,
      payload: { name: 'Late', password: 'CorrectHorseBatteryStaple1' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('INVITATION_EXPIRED');

    await app.close();
    await testDb.stop();
  });

  it('new-user accept on an EXPIRED token leaves NO orphaned users row (Fix 3 atomicity)', async () => {
    // Regression for the orphaned-user bug: the new-user accept path must
    // create the user + membership atomically *after* re-validating the
    // invitation, so a late failure (here: expiry) never persists a user row.
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);
    const inviteEmail = `orphan.${Date.now()}@external.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: inviteEmail, role: 'member' },
    });
    const [row] = await testDb.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.email, inviteEmail.toLowerCase()));

    // Expire the invitation so accept fails on the server.
    await testDb.db
      .update(schema.invitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.invitations.id, row!.id));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${row!.token}/accept`,
      payload: { name: 'Would Be Orphan', password: 'CorrectHorseBatteryStaple1' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('INVITATION_EXPIRED');

    // Critical: the failed accept must not have persisted a user row.
    const orphan = await testDb.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, inviteEmail.toLowerCase()));
    expect(orphan).toHaveLength(0);

    await app.close();
    await testDb.stop();
  });

  it('new-user path missing password → 400 VALIDATION_FAILED', async () => {
    const testDb = await startTestPostgres();
    const fake = makeFakeProvider();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fake.provider,
        fromAddress: 'noreply@dealflow.test',
      }),
    });
    const owner = await signupTestUser(app);
    const inviteEmail = `nopw.${Date.now()}@external.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/orgs/current/invitations',
      headers: { cookie: owner.cookie },
      payload: { email: inviteEmail, role: 'member' },
    });
    const [row] = await testDb.db.select().from(schema.invitations);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${row!.token}/accept`,
      payload: { name: 'Jane' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    await app.close();
    await testDb.stop();
  });
});
