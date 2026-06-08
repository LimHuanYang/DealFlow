import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { OrgRole, PublicMember, PublicOrgSummary } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import type { FastifyInstance } from 'fastify';

/**
 * HTTP integration tests for the members and multi-org endpoints
 * (Phase C2, Team Management). Uses the same membership seeding pattern as
 * contacts.ownership.test.ts: sign up a new user (their cookie + session
 * already exist), then graft them into the target org by inserting an
 * org_members row and repointing that session's current_org_id at the org.
 */
interface SeededMember {
  cookie: string;
  userId: string;
}

describe('Members + orgs HTTP routes', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  let orgAId: string;
  let owner: SeededMember;
  let admin: SeededMember;
  let memberA: SeededMember;

  // Second org with its own owner (no overlap with org A) — used for
  // multi-org tests (GET /orgs scope, POST /orgs/switch authorization).
  let orgBId: string;
  let ownerB: SeededMember;

  async function seedMemberInOrg(targetOrgId: string, role: OrgRole): Promise<SeededMember> {
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

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });

    // Org A: owner (from signup) + admin + memberA grafted in.
    const ownerAuth = await signupTestUser(app, { orgName: 'OrgA' });
    owner = { cookie: ownerAuth.cookie, userId: ownerAuth.userId };
    orgAId = ownerAuth.orgId;
    admin = await seedMemberInOrg(orgAId, 'admin');
    memberA = await seedMemberInOrg(orgAId, 'member');

    // Org B: separate owner via a fresh signup. memberA must NOT see this org.
    const ownerBAuth = await signupTestUser(app, { orgName: 'OrgB' });
    ownerB = { cookie: ownerBAuth.cookie, userId: ownerBAuth.userId };
    orgBId = ownerBAuth.orgId;
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  describe('GET /api/v1/orgs/current/members', () => {
    it('returns all members + an empty invitations array as a regular member', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/orgs/current/members',
        headers: { cookie: memberA.cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { members: PublicMember[]; invitations: unknown[] };
      expect(body.members).toHaveLength(3);
      const roles = body.members.map((m) => m.role);
      expect(roles).toEqual(['owner', 'admin', 'member']);
      expect(body.invitations).toEqual([]);
    });
  });

  describe('PATCH /api/v1/orgs/current/members/:userId', () => {
    it('403 FORBIDDEN when caller is a regular member (role gate)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/current/members/${admin.userId}`,
        headers: { cookie: memberA.cookie },
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('admin can change a member role', async () => {
      // Seed a fresh victim so role flips don't taint other tests.
      const victim = await seedMemberInOrg(orgAId, 'member');
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/current/members/${victim.userId}`,
        headers: { cookie: admin.cookie },
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('owner can change a member role', async () => {
      const victim = await seedMemberInOrg(orgAId, 'member');
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/current/members/${victim.userId}`,
        headers: { cookie: owner.cookie },
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('404 NOT_FOUND when target userId is not a member of this org', async () => {
      // ownerB exists as a user but belongs to org B, not org A.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/current/members/${ownerB.userId}`,
        headers: { cookie: admin.cookie },
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('409 LAST_OWNER when demoting the sole owner', async () => {
      // Owner of org A is the only owner.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/current/members/${owner.userId}`,
        headers: { cookie: owner.cookie },
        payload: { role: 'admin' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('LAST_OWNER');
    });

    it('403 FORBIDDEN when an admin tries to grant the owner role', async () => {
      const victim = await seedMemberInOrg(orgAId, 'member');
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/current/members/${victim.userId}`,
        headers: { cookie: admin.cookie },
        payload: { role: 'owner' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });
  });

  describe('DELETE /api/v1/orgs/current/members/:userId', () => {
    it('admin can remove a regular member', async () => {
      const victim = await seedMemberInOrg(orgAId, 'member');
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/current/members/${victim.userId}`,
        headers: { cookie: admin.cookie },
      });
      expect([200, 204]).toContain(res.statusCode);

      // Victim is gone from the org.
      const after = await app.inject({
        method: 'GET',
        url: '/api/v1/orgs/current/members',
        headers: { cookie: admin.cookie },
      });
      const body = after.json() as { members: PublicMember[] };
      expect(body.members.map((m) => m.userId)).not.toContain(victim.userId);
    });

    it('409 LAST_OWNER when admin removes the sole owner', async () => {
      // Admin tries to delete the sole owner — must hit LAST_OWNER, not
      // CANNOT_REMOVE_SELF (different caller than target).
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/current/members/${owner.userId}`,
        headers: { cookie: admin.cookie },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('LAST_OWNER');
    });

    it('400 CANNOT_REMOVE_SELF when admin tries to delete themselves', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/current/members/${admin.userId}`,
        headers: { cookie: admin.cookie },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CANNOT_REMOVE_SELF');
    });
  });

  describe('POST /api/v1/orgs/current/members/leave', () => {
    it('regular member can leave; subsequent requireOrg calls 403 NOT_A_MEMBER', async () => {
      const leaver = await seedMemberInOrg(orgAId, 'member');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orgs/current/members/leave',
        headers: { cookie: leaver.cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      // The org_members row is gone, so the next requireOrg-guarded call 403s.
      const after = await app.inject({
        method: 'GET',
        url: '/api/v1/orgs/current/members',
        headers: { cookie: leaver.cookie },
      });
      expect(after.statusCode).toBe(403);
      expect(after.json().error.code).toBe('NOT_A_MEMBER');
    });

    it('409 LAST_OWNER when the sole owner tries to leave', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orgs/current/members/leave',
        headers: { cookie: owner.cookie },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('LAST_OWNER');
    });
  });

  describe('GET /api/v1/orgs', () => {
    it('returns only orgs the caller belongs to (memberA does NOT see org B)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/orgs',
        headers: { cookie: memberA.cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { orgs: PublicOrgSummary[] };
      const ids = body.orgs.map((o) => o.id);
      expect(ids).toContain(orgAId);
      expect(ids).not.toContain(orgBId);
    });

    it("ownerB sees only org B", async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/orgs',
        headers: { cookie: ownerB.cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { orgs: PublicOrgSummary[] };
      const ids = body.orgs.map((o) => o.id);
      expect(ids).toEqual([orgBId]);
      expect(body.orgs[0]!.role).toBe('owner');
      expect(body.orgs[0]!.name).toBe('OrgB');
    });
  });

  describe('POST /api/v1/orgs/switch', () => {
    it('403 FORBIDDEN when switching to an org the caller is not a member of', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orgs/switch',
        headers: { cookie: memberA.cookie },
        payload: { organizationId: orgBId },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('200 when switching to an org the caller belongs to; current org changes', async () => {
      // Seed a user who belongs to BOTH org A and org B.
      const multi = await signupTestUser(app, { orgName: 'TempThrowaway' });
      // Sign-up created its own org for `multi` — graft them into A and B,
      // then point their session at A as the active org for now.
      await testDb.db
        .insert(schema.orgMembers)
        .values({ organizationId: orgAId, userId: multi.userId, role: 'member' });
      await testDb.db
        .insert(schema.orgMembers)
        .values({ organizationId: orgBId, userId: multi.userId, role: 'member' });
      await testDb.db
        .update(schema.sessions)
        .set({ currentOrgId: orgAId })
        .where(eq(schema.sessions.userId, multi.userId));

      // Switch to org B.
      const switchRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orgs/switch',
        headers: { cookie: multi.cookie },
        payload: { organizationId: orgBId },
      });
      expect(switchRes.statusCode).toBe(200);
      expect(switchRes.json()).toEqual({ ok: true });

      // The subsequent GET /organizations/current must now return org B.
      const current = await app.inject({
        method: 'GET',
        url: '/api/v1/organizations/current',
        headers: { cookie: multi.cookie },
      });
      expect(current.statusCode).toBe(200);
      const body = current.json() as { organization: { id: string; name: string } };
      expect(body.organization.id).toBe(orgBId);
      expect(body.organization.name).toBe('OrgB');
    });
  });
});
