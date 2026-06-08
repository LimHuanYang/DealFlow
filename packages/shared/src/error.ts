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
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
