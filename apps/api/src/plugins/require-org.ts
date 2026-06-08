import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { ERROR_CODES, type OrgRole } from '@dealflow/shared';

/**
 * preHandler hook that 401s unauthenticated and 400s authenticated users
 * with no current_org_id (e.g., login-only users until Sub-Plan 2c adds
 * explicit org switching).
 *
 * On success it also loads the caller's membership in the current org onto
 * `req.membership` (403 NOT_A_MEMBER if the session points at an org the user
 * does not belong to), so downstream handlers and `requireRole` can authorize
 * by role.
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

  const [member] = await req.server.db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(
      and(
        eq(schema.orgMembers.organizationId, req.session.currentOrgId),
        eq(schema.orgMembers.userId, req.user.id),
      ),
    )
    .limit(1);
  if (!member) {
    void reply.status(403).send({
      error: {
        code: ERROR_CODES.NOT_A_MEMBER,
        message: 'You are not a member of this organization.',
      },
    });
    return;
  }
  req.membership = { role: member.role as OrgRole };
}
