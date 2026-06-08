import type { FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES, type OrgRole } from '@dealflow/shared';

/**
 * preHandler factory that authorizes by org role. Chain it after `requireOrg`,
 * which loads `req.membership`:
 *
 *   { preHandler: [requireOrg, requireRole(['owner', 'admin'])] }
 *
 * 403s FORBIDDEN when there is no membership (e.g. requireOrg was not run, or
 * the caller is not a member) or the caller's role is not in `roles`.
 */
export function requireRole(roles: OrgRole[]) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const role = req.membership?.role;
    if (!role || !roles.includes(role)) {
      void reply.status(403).send({
        error: { code: ERROR_CODES.FORBIDDEN, message: 'Insufficient role for this action.' },
      });
      return;
    }
  };
}
