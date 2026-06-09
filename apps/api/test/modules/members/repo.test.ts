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
  MembersRepo,
  LastOwnerError,
  OwnerRoleChangeForbiddenError,
  AdminCannotManageError,
  MemberNotFoundError,
} from '../../../src/modules/members/repo.js';

/**
 * Pure repo tests for MembersRepo invariants (Phase C1, Team Management).
 *
 * Each member is seeded the same way the contacts ownership tests do it:
 * sign up a brand-new user (creates their own throwaway org), then graft them
 * into the *target* org by inserting an `org_members` row with the desired
 * role. We don't need to repoint sessions here because the repo doesn't read
 * the session — it operates on raw orgId/userId/role inputs.
 */
interface SeededMember {
  userId: string;
}

describe('MembersRepo', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let repo: MembersRepo;

  let orgId: string;
  let owner: SeededMember;
  let admin: SeededMember;
  let member: SeededMember;

  async function seedMemberInOrg(targetOrgId: string, role: OrgRole): Promise<SeededMember> {
    const auth = await signupTestUser(app);
    await testDb.db
      .insert(schema.orgMembers)
      .values({ organizationId: targetOrgId, userId: auth.userId, role });
    return { userId: auth.userId };
  }

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    repo = new MembersRepo(testDb.db);

    // Owner: signup creates the org and an `org_members` row with role 'owner'.
    const ownerAuth = await signupTestUser(app);
    owner = { userId: ownerAuth.userId };
    orgId = ownerAuth.orgId;

    admin = await seedMemberInOrg(orgId, 'admin');
    member = await seedMemberInOrg(orgId, 'member');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('listMembers returns 3 rows with correct fields, ordered owner > admin > member', async () => {
    const rows = await repo.listMembers(orgId);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.userId).toBe(owner.userId);
    expect(rows[0]!.role).toBe('owner');
    expect(rows[1]!.userId).toBe(admin.userId);
    expect(rows[1]!.role).toBe('admin');
    expect(rows[2]!.userId).toBe(member.userId);
    expect(rows[2]!.role).toBe('member');

    // Required public fields
    for (const r of rows) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.email).toBe('string');
      expect(typeof r.joinedAt).toBe('string');
      // joinedAt is ISO string
      expect(() => new Date(r.joinedAt).toISOString()).not.toThrow();
    }
  });

  it('countOwners returns 1 when there is a sole owner', async () => {
    const n = await repo.countOwners(orgId);
    expect(n).toBe(1);
  });

  it('changeRole demoting the only owner throws LastOwnerError', async () => {
    await expect(repo.changeRole(orgId, owner.userId, 'admin', 'owner')).rejects.toBeInstanceOf(
      LastOwnerError,
    );
  });

  it('changeRole granting owner as admin throws OwnerRoleChangeForbiddenError', async () => {
    await expect(
      repo.changeRole(orgId, member.userId, 'owner', 'admin'),
    ).rejects.toBeInstanceOf(OwnerRoleChangeForbiddenError);
  });

  it('changeRole demoting owner succeeds once a second owner exists', async () => {
    // Add a second owner (so the demote no longer hits the last-owner invariant).
    const secondOwner = await seedMemberInOrg(orgId, 'owner');

    await repo.changeRole(orgId, owner.userId, 'admin', 'owner');

    const [row] = await testDb.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, owner.userId),
        ),
      );
    expect(row?.role).toBe('admin');

    // Restore owner role so the rest of the test file keeps its baseline.
    await testDb.db
      .update(schema.orgMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, owner.userId),
        ),
      );
    // Remove the helper second-owner.
    await testDb.db
      .delete(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, secondOwner.userId),
        ),
      );
  });

  it('changeRole on a non-existent user throws MemberNotFoundError', async () => {
    await expect(
      repo.changeRole(orgId, randomUUID(), 'admin', 'owner'),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it('removeMember removing the sole owner throws LastOwnerError', async () => {
    await expect(repo.removeMember(orgId, owner.userId, 'owner')).rejects.toBeInstanceOf(
      LastOwnerError,
    );
  });

  it('removeMember removing a non-owner succeeds; listMembers no longer includes them', async () => {
    // Seed a fresh member just for this case so we don't disturb the baseline.
    const tmp = await seedMemberInOrg(orgId, 'member');
    await repo.removeMember(orgId, tmp.userId, 'owner');
    const rows = await repo.listMembers(orgId);
    expect(rows.map((r) => r.userId)).not.toContain(tmp.userId);
  });

  it('removeMember succeeds against one of two owners', async () => {
    const secondOwner = await seedMemberInOrg(orgId, 'owner');
    await repo.removeMember(orgId, secondOwner.userId, 'owner');
    const owners = await repo.countOwners(orgId);
    expect(owners).toBe(1);
  });

  it('removeMember on a non-existent user throws MemberNotFoundError', async () => {
    await expect(repo.removeMember(orgId, randomUUID(), 'owner')).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
  });

  // ── Fix 1: an admin may only manage `member`-role users ──────────────────

  it('changeRole: admin demoting another admin throws AdminCannotManageError', async () => {
    const otherAdmin = await seedMemberInOrg(orgId, 'admin');
    await expect(
      repo.changeRole(orgId, otherAdmin.userId, 'member', 'admin'),
    ).rejects.toBeInstanceOf(AdminCannotManageError);
    // Cleanup.
    await repo.removeMember(orgId, otherAdmin.userId, 'owner');
  });

  it('changeRole: admin modifying an owner throws AdminCannotManageError', async () => {
    await expect(
      repo.changeRole(orgId, owner.userId, 'member', 'admin'),
    ).rejects.toBeInstanceOf(AdminCannotManageError);
  });

  it('changeRole: admin changing a member to admin still succeeds', async () => {
    const tmp = await seedMemberInOrg(orgId, 'member');
    await repo.changeRole(orgId, tmp.userId, 'admin', 'admin');
    const [row] = await testDb.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, tmp.userId),
        ),
      );
    expect(row?.role).toBe('admin');
    await repo.removeMember(orgId, tmp.userId, 'owner');
  });

  it('changeRole: owner demoting another admin still succeeds', async () => {
    const tmp = await seedMemberInOrg(orgId, 'admin');
    await repo.changeRole(orgId, tmp.userId, 'member', 'owner');
    const [row] = await testDb.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, tmp.userId),
        ),
      );
    expect(row?.role).toBe('member');
    await repo.removeMember(orgId, tmp.userId, 'owner');
  });

  it('removeMember: admin removing another admin throws AdminCannotManageError', async () => {
    const otherAdmin = await seedMemberInOrg(orgId, 'admin');
    await expect(
      repo.removeMember(orgId, otherAdmin.userId, 'admin'),
    ).rejects.toBeInstanceOf(AdminCannotManageError);
    await repo.removeMember(orgId, otherAdmin.userId, 'owner');
  });

  it('removeMember: admin removing an owner throws AdminCannotManageError', async () => {
    await expect(
      repo.removeMember(orgId, owner.userId, 'admin'),
    ).rejects.toBeInstanceOf(AdminCannotManageError);
  });

  it('removeMember: admin removing a regular member still succeeds', async () => {
    const tmp = await seedMemberInOrg(orgId, 'member');
    await repo.removeMember(orgId, tmp.userId, 'admin');
    const rows = await repo.listMembers(orgId);
    expect(rows.map((r) => r.userId)).not.toContain(tmp.userId);
  });

  it('removeMember: owner removing an admin still succeeds', async () => {
    const tmp = await seedMemberInOrg(orgId, 'admin');
    await repo.removeMember(orgId, tmp.userId, 'owner');
    const rows = await repo.listMembers(orgId);
    expect(rows.map((r) => r.userId)).not.toContain(tmp.userId);
  });

  it('leave as sole owner throws LastOwnerError', async () => {
    await expect(repo.leave(orgId, owner.userId)).rejects.toBeInstanceOf(LastOwnerError);
  });

  it('leave as a regular member succeeds', async () => {
    const tmp = await seedMemberInOrg(orgId, 'member');
    await repo.leave(orgId, tmp.userId);
    const rows = await repo.listMembers(orgId);
    expect(rows.map((r) => r.userId)).not.toContain(tmp.userId);
  });

  it('leave on a non-existent user throws MemberNotFoundError', async () => {
    await expect(repo.leave(orgId, randomUUID())).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
