import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import type { FastifyInstance } from 'fastify';
import {
  InvitationsRepo,
  InvitationAlreadyAcceptedError,
  InvitationDuplicateError,
  InvitationExpiredError,
  InvitationForExistingMemberError,
  InvitationNotFoundError,
} from '../../../src/modules/members/invitations.repo.js';

interface SeededMember {
  userId: string;
}

describe('InvitationsRepo', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let repo: InvitationsRepo;

  let orgId: string;
  let owner: SeededMember;
  let member: SeededMember;

  async function seedMemberInOrg(
    targetOrgId: string,
    role: OrgRole,
    email?: string,
  ): Promise<SeededMember> {
    const auth = await signupTestUser(app, email ? { email } : undefined);
    await testDb.db
      .insert(schema.orgMembers)
      .values({ organizationId: targetOrgId, userId: auth.userId, role });
    return { userId: auth.userId };
  }

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    repo = new InvitationsRepo(testDb.db);

    const ownerAuth = await signupTestUser(app);
    owner = { userId: ownerAuth.userId };
    orgId = ownerAuth.orgId;

    member = await seedMemberInOrg(orgId, 'member', 'existing.member@acme.com');
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  describe('create', () => {
    it('returns { invitation, token }; token is opaque base64url and ≥40 chars; expiresAt ≈ now+7d', async () => {
      const before = Date.now();
      const result = await repo.create(
        orgId,
        { email: `new.${Date.now()}@acme.com`, role: 'member' },
        owner.userId,
      );

      // Token shape — base64url chars only, ≥40 (43 chars for 32 bytes).
      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.token.length).toBeGreaterThanOrEqual(40);

      // PublicInvitation shape.
      expect(result.invitation.id).toBeTruthy();
      expect(result.invitation.email).toMatch(/@acme\.com$/);
      expect(result.invitation.role).toBe('member');
      const expiresAt = new Date(result.invitation.expiresAt).getTime();
      const expected = before + 7 * 24 * 60 * 60 * 1000;
      // ±60s window for clock variance.
      expect(Math.abs(expiresAt - expected)).toBeLessThan(60_000);
    });

    it('rejects when email already belongs to an active org member (case-insensitive)', async () => {
      // Existing member's email was 'existing.member@acme.com'. Upper-case it
      // to prove the citext column does case-insensitive matching.
      await expect(
        repo.create(
          orgId,
          { email: 'EXISTING.MEMBER@ACME.COM', role: 'member' },
          owner.userId,
        ),
      ).rejects.toBeInstanceOf(InvitationForExistingMemberError);
    });

    it('rejects when an unexpired invitation for the same email already exists', async () => {
      const email = `dup.${Date.now()}@acme.com`;
      await repo.create(orgId, { email, role: 'member' }, owner.userId);
      await expect(
        repo.create(orgId, { email, role: 'member' }, owner.userId),
      ).rejects.toBeInstanceOf(InvitationDuplicateError);
    });
  });

  describe('listPending', () => {
    it('excludes expired and accepted rows', async () => {
      // 1. Fresh pending invite.
      const pendingEmail = `pending.${Date.now()}@acme.com`;
      const { invitation: pending } = await repo.create(
        orgId,
        { email: pendingEmail, role: 'member' },
        owner.userId,
      );
      // 2. Expired invite — directly insert with past expiresAt.
      const expiredEmail = `expired.${Date.now()}@acme.com`;
      const [expiredRow] = await testDb.db
        .insert(schema.invitations)
        .values({
          organizationId: orgId,
          email: expiredEmail,
          role: 'member',
          token: `manual-expired-${randomUUID()}`,
          invitedBy: owner.userId,
          expiresAt: new Date(Date.now() - 60_000),
        })
        .returning();
      // 3. Accepted invite — fresh create, then UPDATE acceptedAt.
      const acceptedEmail = `accepted.${Date.now()}@acme.com`;
      const { invitation: acceptedInv } = await repo.create(
        orgId,
        { email: acceptedEmail, role: 'member' },
        owner.userId,
      );
      await testDb.db
        .update(schema.invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.invitations.id, acceptedInv.id));

      const rows = await repo.listPending(orgId);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(pending.id);
      expect(ids).not.toContain(expiredRow!.id);
      expect(ids).not.toContain(acceptedInv.id);
    });
  });

  describe('getByToken', () => {
    it('returns null for an unknown token', async () => {
      const out = await repo.getByToken('definitely-not-a-real-token');
      expect(out).toBeNull();
    });

    it('returns the full row for a valid token', async () => {
      const email = `gbk.${Date.now()}@acme.com`;
      const { invitation, token } = await repo.create(
        orgId,
        { email, role: 'admin' },
        owner.userId,
      );

      const out = await repo.getByToken(token);
      expect(out).not.toBeNull();
      expect(out!.id).toBe(invitation.id);
      expect(out!.organizationId).toBe(orgId);
      expect(out!.email.toLowerCase()).toBe(email.toLowerCase());
      expect(out!.role).toBe('admin');
      expect(out!.invitedBy).toBe(owner.userId);
      expect(out!.expiresAt).toBeInstanceOf(Date);
      expect(out!.acceptedAt).toBeNull();
    });
  });

  describe('resend', () => {
    it('bumps expiresAt further; token unchanged; returns updated PublicInvitation', async () => {
      const email = `resend.${Date.now()}@acme.com`;
      const { invitation, token } = await repo.create(
        orgId,
        { email, role: 'member' },
        owner.userId,
      );
      const beforeMs = new Date(invitation.expiresAt).getTime();

      // Bring the current expiresAt closer to "now" so the resend bump is
      // detectable (otherwise the test could flake when resend runs <1s after
      // create and the +7d math is identical to the millisecond).
      await testDb.db
        .update(schema.invitations)
        .set({ expiresAt: new Date(Date.now() + 60_000) })
        .where(eq(schema.invitations.id, invitation.id));

      const updated = await repo.resend(orgId, invitation.id);
      expect(updated.id).toBe(invitation.id);
      const afterMs = new Date(updated.expiresAt).getTime();
      expect(afterMs).toBeGreaterThan(beforeMs);

      // Token unchanged.
      const sameToken = await repo.getByToken(token);
      expect(sameToken).not.toBeNull();
      expect(sameToken!.id).toBe(invitation.id);
    });
  });

  describe('revoke', () => {
    it('deletes the row; second call is idempotent', async () => {
      const email = `revoke.${Date.now()}@acme.com`;
      const { invitation } = await repo.create(
        orgId,
        { email, role: 'member' },
        owner.userId,
      );

      await repo.revoke(orgId, invitation.id);
      const [row] = await testDb.db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, invitation.id));
      expect(row).toBeUndefined();

      // Second call must not throw.
      await expect(repo.revoke(orgId, invitation.id)).resolves.toBeUndefined();
    });
  });

  describe('accept', () => {
    it('joins user to org and stamps acceptedAt; idempotent for the same user', async () => {
      // Create an invitation for an existing (different) user.
      const inviteeAuth = await signupTestUser(app);
      const email = inviteeAuth.userId
        ? `invitee.${Date.now()}@acme.com`
        : 'fallback@acme.com';
      // Insert the user with this email so accept can find them.
      // Easier: fetch the user's email from the signup, but signupTestUser
      // doesn't return it — just use the user row we already have.
      const [userRow] = await testDb.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, inviteeAuth.userId));
      const inviteEmail = userRow!.email;

      const { invitation, token } = await repo.create(
        orgId,
        { email: inviteEmail, role: 'admin' },
        owner.userId,
      );

      const out = await repo.accept(token, inviteeAuth.userId);
      expect(out.organizationId).toBe(orgId);
      expect(out.role).toBe('admin');

      // org_members row exists.
      const [member] = await testDb.db
        .select()
        .from(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.organizationId, orgId),
            eq(schema.orgMembers.userId, inviteeAuth.userId),
          ),
        );
      expect(member?.role).toBe('admin');

      // acceptedAt stamped.
      const [row] = await testDb.db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, invitation.id));
      expect(row!.acceptedAt).not.toBeNull();

      // Idempotent second call — should not throw, returns same shape.
      const out2 = await repo.accept(token, inviteeAuth.userId);
      expect(out2.organizationId).toBe(orgId);
      expect(out2.role).toBe('admin');
    });

    it('throws InvitationNotFoundError for an unknown token', async () => {
      await expect(repo.accept('nope-not-a-token', randomUUID())).rejects.toBeInstanceOf(
        InvitationNotFoundError,
      );
    });

    it('throws InvitationExpiredError when expiresAt is in the past', async () => {
      // Fast-forward an invitation's expiresAt to the past.
      const email = `accept-expired.${Date.now()}@acme.com`;
      const inviteeAuth = await signupTestUser(app, { email });
      const { invitation, token } = await repo.create(
        orgId,
        { email, role: 'member' },
        owner.userId,
      );
      await testDb.db
        .update(schema.invitations)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.invitations.id, invitation.id));

      await expect(repo.accept(token, inviteeAuth.userId)).rejects.toBeInstanceOf(
        InvitationExpiredError,
      );
    });

    it('throws InvitationAlreadyAcceptedError if a *different* user tries to accept', async () => {
      // First user accepts.
      const firstEmail = `acc-first.${Date.now()}@acme.com`;
      const first = await signupTestUser(app, { email: firstEmail });
      const { token } = await repo.create(
        orgId,
        { email: firstEmail, role: 'member' },
        owner.userId,
      );
      await repo.accept(token, first.userId);

      // A different user trying the same token should be rejected.
      const intruder = await signupTestUser(app);
      await expect(repo.accept(token, intruder.userId)).rejects.toBeInstanceOf(
        InvitationAlreadyAcceptedError,
      );
    });

    // Sanity reference to `member` so eslint doesn't complain about it being unused
    // when the test file is read in isolation; the seeded member underpins
    // the duplicate-membership check above via the citext email match.
    it('seeded existing member remains in the org', async () => {
      const [row] = await testDb.db
        .select()
        .from(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.organizationId, orgId),
            eq(schema.orgMembers.userId, member.userId),
          ),
        );
      expect(row).toBeDefined();
    });
  });
});
