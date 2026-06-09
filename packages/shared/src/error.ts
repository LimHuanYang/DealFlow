import { z } from 'zod';

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  /** Team management: a state change would leave the org without an owner. */
  LAST_OWNER: 'LAST_OWNER',
  /**
   * Team management: caller tried to remove their own membership via the
   * admin DELETE route. They must use POST /members/leave instead.
   */
  CANNOT_REMOVE_SELF: 'CANNOT_REMOVE_SELF',
  /**
   * Team management: a user tried to change their own role via the member
   * PATCH route. Self-role-change is forbidden (spec §3).
   */
  CANNOT_CHANGE_OWN_ROLE: 'CANNOT_CHANGE_OWN_ROLE',
  /** Invitations: target email already belongs to an active org member. */
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  /** Invitations: an unexpired invitation for the same email already exists. */
  ALREADY_INVITED: 'ALREADY_INVITED',
  /** Invitations: token does not match any invitation row. */
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  /** Invitations: the invitation's expiresAt is in the past. */
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  /** Invitations: the invitation has already been accepted by another user. */
  INVITATION_ALREADY_ACCEPTED: 'INVITATION_ALREADY_ACCEPTED',
  /**
   * Public accept flow: the invited email already has an account but the
   * caller has no matching session — the web app should redirect to
   * /login?next=/invite/<token>.
   */
  SIGNIN_REQUIRED: 'SIGNIN_REQUIRED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
