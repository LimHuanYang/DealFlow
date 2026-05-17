import type { FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@dealflow/shared';

/**
 * preHandler hook that 401s unauthenticated and 400s authenticated users
 * with no current_org_id (e.g., login-only users until Sub-Plan 2c adds
 * explicit org switching).
 *
 * Routes that need an authenticated user *and* an active org use this as
 * their preHandler.
 */
export async function requireOrg(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user || !req.session) {
    void reply.status(401).send({
      error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Not authenticated' },
    });
    return;
  }
  if (!req.session.currentOrgId) {
    void reply.status(400).send({
      error: {
        code: 'NO_CURRENT_ORG',
        message: 'No current organization selected. Pick one or sign up to create one.',
      },
    });
    return;
  }
}
