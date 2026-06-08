import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { OrgRole, PublicMember } from '@dealflow/shared';

/**
 * Thrown when a state transition would leave the org with zero owners
 * (demoting or removing the only owner, or that owner leaving).
 */
export class LastOwnerError extends Error {
  constructor(message = 'Cannot remove or demote the only owner of the organization.') {
    super(message);
    this.name = 'LastOwnerError';
  }
}

/**
 * Thrown when a non-owner caller tries to grant or revoke the owner role.
 * Only existing owners may add or remove other owners.
 */
export class OwnerRoleChangeForbiddenError extends Error {
  constructor(
    message = 'Only owners may grant or revoke the owner role.',
  ) {
    super(message);
    this.name = 'OwnerRoleChangeForbiddenError';
  }
}

/** Thrown when the target `org_members` row does not exist. */
export class MemberNotFoundError extends Error {
  constructor(message = 'Member not found in this organization.') {
    super(message);
    this.name = 'MemberNotFoundError';
  }
}

const ROLE_ORDER_SQL = sql`CASE ${schema.orgMembers.role}
  WHEN 'owner' THEN 0
  WHEN 'admin' THEN 1
  WHEN 'member' THEN 2
  ELSE 3
END`;

export class MembersRepo {
  constructor(private readonly db: Database) {}

  /**
   * List all members of `orgId` joined onto `users` for name/email, ordered
   * owner → admin → member, then by `joinedAt` ascending so the founder
   * surfaces first within each role bucket.
   */
  async listMembers(orgId: string): Promise<PublicMember[]> {
    const rows = await this.db
      .select({
        userId: schema.orgMembers.userId,
        role: schema.orgMembers.role,
        joinedAt: schema.orgMembers.joinedAt,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
      .where(eq(schema.orgMembers.organizationId, orgId))
      .orderBy(ROLE_ORDER_SQL, asc(schema.orgMembers.joinedAt));

    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: r.role as OrgRole,
      joinedAt: r.joinedAt.toISOString(),
    }));
  }

  /** Count of owners in `orgId`. Used by the last-owner invariant checks. */
  async countOwners(orgId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.role, 'owner'),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  private async findRole(orgId: string, userId: string): Promise<OrgRole | null> {
    const [row] = await this.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, userId),
        ),
      )
      .limit(1);
    return (row?.role as OrgRole | undefined) ?? null;
  }

  /**
   * Change the role of `targetUserId` in `orgId`.
   *
   * Invariants:
   *  - Target must exist (`MemberNotFoundError`).
   *  - If `actorRole !== 'owner'`, neither the target's current role nor the
   *    new role may be `'owner'` (`OwnerRoleChangeForbiddenError`).
   *  - Demoting the only owner is rejected (`LastOwnerError`).
   */
  async changeRole(
    orgId: string,
    targetUserId: string,
    newRole: OrgRole,
    actorRole: OrgRole,
  ): Promise<void> {
    const current = await this.findRole(orgId, targetUserId);
    if (!current) throw new MemberNotFoundError();

    if (actorRole !== 'owner' && (current === 'owner' || newRole === 'owner')) {
      throw new OwnerRoleChangeForbiddenError();
    }

    // Demoting the only owner leaves the org without an owner — forbidden.
    if (current === 'owner' && newRole !== 'owner') {
      const owners = await this.countOwners(orgId);
      if (owners <= 1) throw new LastOwnerError();
    }

    await this.db
      .update(schema.orgMembers)
      .set({ role: newRole })
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, targetUserId),
        ),
      );
  }

  /**
   * Hard-delete a member row.
   *
   * Invariants:
   *  - Target must exist (`MemberNotFoundError`).
   *  - Removing the only owner is rejected (`LastOwnerError`).
   */
  async removeMember(orgId: string, targetUserId: string): Promise<void> {
    const current = await this.findRole(orgId, targetUserId);
    if (!current) throw new MemberNotFoundError();

    if (current === 'owner') {
      const owners = await this.countOwners(orgId);
      if (owners <= 1) throw new LastOwnerError();
    }

    await this.db
      .delete(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, targetUserId),
        ),
      );
  }

  /**
   * Self-leave. Same invariants as `removeMember` but always run from the
   * caller's POV, with no admin-bypass: a sole owner cannot leave.
   */
  async leave(orgId: string, callerUserId: string): Promise<void> {
    const current = await this.findRole(orgId, callerUserId);
    if (!current) throw new MemberNotFoundError();

    if (current === 'owner') {
      const owners = await this.countOwners(orgId);
      if (owners <= 1) throw new LastOwnerError();
    }

    await this.db
      .delete(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.userId, callerUserId),
        ),
      );
  }
}
