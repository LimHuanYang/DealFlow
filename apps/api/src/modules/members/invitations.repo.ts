import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { OrgRole, PublicInvitation } from '@dealflow/shared';

/** Thrown when no invitation row matches the supplied token. */
export class InvitationNotFoundError extends Error {
  constructor(message = 'Invitation not found.') {
    super(message);
    this.name = 'InvitationNotFoundError';
  }
}

/** Thrown when the invitation's `expiresAt` is in the past. */
export class InvitationExpiredError extends Error {
  constructor(message = 'Invitation has expired.') {
    super(message);
    this.name = 'InvitationExpiredError';
  }
}

/**
 * Thrown by `accept` when the invitation is already accepted *by a different
 * user*. The same user re-calling `accept` with the same token is treated as
 * idempotent and returns successfully.
 */
export class InvitationAlreadyAcceptedError extends Error {
  constructor(message = 'Invitation has already been accepted.') {
    super(message);
    this.name = 'InvitationAlreadyAcceptedError';
  }
}

/**
 * Thrown by `create` when an unexpired pending invitation already exists
 * for the same (orgId, email) pair.
 */
export class InvitationDuplicateError extends Error {
  constructor(
    message = 'An invitation for this email is already pending in this organization.',
  ) {
    super(message);
    this.name = 'InvitationDuplicateError';
  }
}

/**
 * Thrown by `create` when the target email is already an active member of
 * the org. Email match uses the `citext` column (case-insensitive).
 */
export class InvitationForExistingMemberError extends Error {
  constructor(message = 'This person is already a member of the organization.') {
    super(message);
    this.name = 'InvitationForExistingMemberError';
  }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Generate a 256-bit URL-safe random token. ~43 chars, base64url. */
function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

function toPublicInvitation(row: typeof schema.invitations.$inferSelect): PublicInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role as OrgRole,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export class InvitationsRepo {
  constructor(private readonly db: Database) {}

  /**
   * Create a fresh invitation row.
   *
   *   - Rejects when the email already belongs to an active org member
   *     (`InvitationForExistingMemberError`). Match is case-insensitive,
   *     leveraging the `citext` columns on both `users.email` and
   *     `invitations.email`.
   *   - Rejects when a non-expired pending invitation for the same email
   *     already exists in this org (`InvitationDuplicateError`).
   *   - Token: 256 bits (base64url, ~43 chars). expiresAt: now + 7 days.
   */
  async create(
    orgId: string,
    input: { email: string; role: 'admin' | 'member' },
    invitedBy: string | null,
  ): Promise<{ invitation: PublicInvitation; token: string }> {
    // 1. Refuse if email is already an active org member.
    const [existingMember] = await this.db
      .select({ userId: schema.orgMembers.userId })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
      .where(
        and(
          eq(schema.orgMembers.organizationId, orgId),
          // citext column = case-insensitive equality, but normalize the
          // incoming string anyway so it survives any future column-type
          // change.
          eq(schema.users.email, input.email.toLowerCase()),
        ),
      )
      .limit(1);
    if (existingMember) throw new InvitationForExistingMemberError();

    // 2. Refuse on duplicate pending unexpired invite.
    const now = new Date();
    const [dup] = await this.db
      .select({ id: schema.invitations.id })
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.organizationId, orgId),
          eq(schema.invitations.email, input.email.toLowerCase()),
          isNull(schema.invitations.acceptedAt),
          gt(schema.invitations.expiresAt, now),
        ),
      )
      .limit(1);
    if (dup) throw new InvitationDuplicateError();

    // 3. Insert.
    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);
    const [row] = await this.db
      .insert(schema.invitations)
      .values({
        organizationId: orgId,
        email: input.email.toLowerCase(),
        role: input.role,
        token,
        invitedBy,
        expiresAt,
      })
      .returning();
    if (!row) throw new Error('Failed to insert invitation');
    return { invitation: toPublicInvitation(row), token };
  }

  /**
   * Pending invitations for `orgId` — not yet accepted and not yet expired.
   * Ordered newest-first so the Settings UI's pending list shows latest first.
   */
  async listPending(orgId: string): Promise<PublicInvitation[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.organizationId, orgId),
          isNull(schema.invitations.acceptedAt),
          gt(schema.invitations.expiresAt, now),
        ),
      )
      .orderBy(desc(schema.invitations.createdAt));
    return rows.map(toPublicInvitation);
  }

  /**
   * Look up by raw token. Returns enough of the row for the public preview
   * + accept routes; `null` when nothing matches.
   */
  async getByToken(token: string): Promise<{
    id: string;
    organizationId: string;
    email: string;
    role: 'admin' | 'member';
    invitedBy: string | null;
    expiresAt: Date;
    acceptedAt: Date | null;
  } | null> {
    const [row] = await this.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.token, token))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      role: row.role as 'admin' | 'member',
      invitedBy: row.invitedBy,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
    };
  }

  /**
   * Reset `expiresAt` to now + 7d. Token is unchanged so a previously
   * emailed link keeps working.
   */
  async resend(orgId: string, id: string): Promise<PublicInvitation> {
    const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);
    const [row] = await this.db
      .update(schema.invitations)
      .set({ expiresAt })
      .where(
        and(
          eq(schema.invitations.id, id),
          eq(schema.invitations.organizationId, orgId),
        ),
      )
      .returning();
    if (!row) throw new InvitationNotFoundError();
    return toPublicInvitation(row);
  }

  /** Delete a pending row. Idempotent — no error if it's already gone. */
  async revoke(orgId: string, id: string): Promise<void> {
    await this.db
      .delete(schema.invitations)
      .where(
        and(
          eq(schema.invitations.id, id),
          eq(schema.invitations.organizationId, orgId),
        ),
      );
  }

  /**
   * Atomically join `userId` to the invitation's org with the invitation's
   * role and stamp `acceptedAt`. Runs inside a transaction so concurrent
   * accept calls converge:
   *
   *  - Unknown token → `InvitationNotFoundError`.
   *  - `expiresAt` in the past → `InvitationExpiredError`.
   *  - Already accepted by a *different* user → `InvitationAlreadyAcceptedError`.
   *  - Already accepted by *the same* user → idempotent success.
   *  - Already a member (no row inserted) → still stamps `acceptedAt` and
   *    returns the membership role; never throws on the second call.
   */
  async accept(
    token: string,
    userId: string,
  ): Promise<{ organizationId: string; role: 'admin' | 'member' }> {
    return this.db.transaction(async (tx) => {
      // Re-fetch inside the txn so concurrent accept calls see a consistent view.
      const [inv] = await tx
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.token, token))
        .limit(1);
      if (!inv) throw new InvitationNotFoundError();

      const orgId = inv.organizationId;
      const role = inv.role as 'admin' | 'member';

      // Already accepted? Same user is idempotent; different user is rejected.
      if (inv.acceptedAt) {
        const [existing] = await tx
          .select({ role: schema.orgMembers.role })
          .from(schema.orgMembers)
          .where(
            and(
              eq(schema.orgMembers.organizationId, orgId),
              eq(schema.orgMembers.userId, userId),
            ),
          )
          .limit(1);
        if (existing) {
          return { organizationId: orgId, role: existing.role as 'admin' | 'member' };
        }
        throw new InvitationAlreadyAcceptedError();
      }

      if (inv.expiresAt.getTime() <= Date.now()) {
        throw new InvitationExpiredError();
      }

      // Insert membership only if not already present (idempotency).
      const [existing] = await tx
        .select({ role: schema.orgMembers.role })
        .from(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.organizationId, orgId),
            eq(schema.orgMembers.userId, userId),
          ),
        )
        .limit(1);

      let effectiveRole: 'admin' | 'member' = role;
      if (!existing) {
        await tx
          .insert(schema.orgMembers)
          .values({ organizationId: orgId, userId, role });
      } else {
        effectiveRole = existing.role as 'admin' | 'member';
      }

      // Stamp acceptedAt — using NOW() so concurrent inserts see a sane value.
      await tx
        .update(schema.invitations)
        .set({ acceptedAt: sql`NOW()` })
        .where(eq(schema.invitations.id, inv.id));

      return { organizationId: orgId, role: effectiveRole };
    });
  }
}
