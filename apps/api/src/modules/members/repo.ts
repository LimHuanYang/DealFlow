import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { OrgRole, PublicMember } from '@dealflow/shared';

/**
 * The transaction handle Drizzle hands to `db.transaction(async (tx) => ...)`.
 * Derived from `Database['transaction']` so it tracks the schema-typed client.
 */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

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

/**
 * Thrown when an `admin` actor tries to modify or remove a member whose role
 * is `owner` or `admin`. Per spec §3 an admin may manage `member`-role users
 * only — never owners or fellow admins. Maps to 403 FORBIDDEN at the route.
 */
export class AdminCannotManageError extends Error {
  constructor(
    message = 'Admins may only manage regular members, not owners or other admins.',
  ) {
    super(message);
    this.name = 'AdminCannotManageError';
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

  /** Read a member's current role on a given executor (db or an open txn). */
  private async findRoleTx(
    tx: Transaction,
    orgId: string,
    userId: string,
  ): Promise<OrgRole | null> {
    const [row] = await tx
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
   * Lock and return the set of owner `user_id`s for `orgId` with a row-level
   * `FOR UPDATE` lock, *inside* an open transaction. Concurrent
   * owner-affecting changes (demote / remove / leave) serialize on these
   * locked rows, so the last-owner invariant can be checked and enforced
   * without a TOCTOU race: a second transaction blocks until the first
   * commits and then re-reads the post-mutation owner set.
   */
  private async lockOwnerIds(tx: Transaction, orgId: string): Promise<string[]> {
    const rows = await tx
      .select({ userId: schema.orgMembers.userId })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          eq(schema.orgMembers.role, 'owner'),
        ),
      )
      .for('update');
    return rows.map((r) => r.userId);
  }

  /**
   * Change the role of `targetUserId` in `orgId`.
   *
   * Invariants:
   *  - Target must exist (`MemberNotFoundError`).
   *  - If `actorRole !== 'owner'`, neither the target's current role nor the
   *    new role may be `'owner'` (`OwnerRoleChangeForbiddenError`).
   *  - If `actorRole === 'admin'`, the target's current role may not be
   *    `'owner'` or `'admin'` — admins manage regular members only
   *    (`AdminCannotManageError`).
   *  - Demoting the only owner is rejected (`LastOwnerError`).
   *
   * Runs in a transaction with a `FOR UPDATE` lock on the org's owner rows so
   * concurrent demotes can't race the last-owner check (TOCTOU).
   */
  async changeRole(
    orgId: string,
    targetUserId: string,
    newRole: OrgRole,
    actorRole: OrgRole,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ownerIds = await this.lockOwnerIds(tx, orgId);

      const current = await this.findRoleTx(tx, orgId, targetUserId);
      if (!current) throw new MemberNotFoundError();

      // Admins may only manage regular members — never owners or other admins.
      // Checked before the owner-grant guard so an admin touching an owner gets
      // the clearer "you can't manage this person" error (both are 403).
      if (actorRole === 'admin' && (current === 'owner' || current === 'admin')) {
        throw new AdminCannotManageError();
      }

      // Only owners may grant or revoke the owner role (covers a non-owner
      // promoting anyone to owner; the admin case above already blocks an
      // admin from touching an existing owner).
      if (actorRole !== 'owner' && (current === 'owner' || newRole === 'owner')) {
        throw new OwnerRoleChangeForbiddenError();
      }

      // Demoting the only owner leaves the org without an owner — forbidden.
      // `ownerIds` was read under FOR UPDATE, so this count is race-free.
      if (current === 'owner' && newRole !== 'owner' && ownerIds.length <= 1) {
        throw new LastOwnerError();
      }

      await tx
        .update(schema.orgMembers)
        .set({ role: newRole })
        .where(
          and(
            eq(schema.orgMembers.organizationId, orgId),
            eq(schema.orgMembers.userId, targetUserId),
          ),
        );
    });
  }

  /**
   * Hard-delete a member row.
   *
   * Invariants:
   *  - Target must exist (`MemberNotFoundError`).
   *  - If `actorRole === 'admin'`, the target may not be an `owner` or another
   *    `admin` — admins may only remove regular members
   *    (`AdminCannotManageError`).
   *  - Removing the only owner is rejected (`LastOwnerError`). Owners may
   *    remove anyone subject to this guard.
   *
   * Runs in a transaction with a `FOR UPDATE` lock on the org's owner rows so
   * concurrent removals can't race the last-owner check (TOCTOU).
   */
  async removeMember(
    orgId: string,
    targetUserId: string,
    actorRole: OrgRole,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ownerIds = await this.lockOwnerIds(tx, orgId);

      const current = await this.findRoleTx(tx, orgId, targetUserId);
      if (!current) throw new MemberNotFoundError();

      // Admins may only remove regular members — never owners or other admins.
      if (actorRole === 'admin' && (current === 'owner' || current === 'admin')) {
        throw new AdminCannotManageError();
      }

      // Removing the only owner leaves the org ownerless. `ownerIds` was read
      // under FOR UPDATE, so this count is race-free.
      if (current === 'owner' && ownerIds.length <= 1) {
        throw new LastOwnerError();
      }

      await tx
        .delete(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.organizationId, orgId),
            eq(schema.orgMembers.userId, targetUserId),
          ),
        );
    });
  }

  /**
   * Self-leave. Same invariants as `removeMember` but always run from the
   * caller's POV, with no admin-bypass: a sole owner cannot leave.
   *
   * Runs in a transaction with a `FOR UPDATE` lock on the org's owner rows so
   * two owners leaving concurrently can't both pass the last-owner check.
   */
  async leave(orgId: string, callerUserId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ownerIds = await this.lockOwnerIds(tx, orgId);

      const current = await this.findRoleTx(tx, orgId, callerUserId);
      if (!current) throw new MemberNotFoundError();

      // The sole owner cannot leave. `ownerIds` was read under FOR UPDATE.
      if (current === 'owner' && ownerIds.length <= 1) {
        throw new LastOwnerError();
      }

      await tx
        .delete(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.organizationId, orgId),
            eq(schema.orgMembers.userId, callerUserId),
          ),
        );
    });
  }
}
