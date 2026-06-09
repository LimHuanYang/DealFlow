import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  ERROR_CODES,
  type OrgRole,
  type PublicOrgSummary,
  switchOrgBodySchema,
  updateMemberRoleBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { requireRole } from '../../plugins/require-role.js';
import {
  AdminCannotManageError,
  LastOwnerError,
  MemberNotFoundError,
  MembersRepo,
  OwnerRoleChangeForbiddenError,
} from './repo.js';
import { InvitationsRepo } from './invitations.repo.js';

const userIdParamSchema = z.object({ userId: z.string().uuid() });

export interface MembersRoutesDeps {
  db: Database;
}

export async function registerMembersRoutes(
  app: FastifyInstance,
  deps: MembersRoutesDeps,
): Promise<void> {
  const repo = new MembersRepo(deps.db);
  const invitationsRepo = new InvitationsRepo(deps.db);

  // ───────────────────────── GET /orgs/current/members ─────────────────────
  // Any member of the active org may list. Mutations are gated by role below.
  // Pending invitations are also returned so the Settings UI renders both
  // lists from a single request.
  app.get(
    '/api/v1/orgs/current/members',
    { preHandler: requireOrg },
    async (req, reply) => {
      const orgId = req.session!.currentOrgId!;
      const [members, invitations] = await Promise.all([
        repo.listMembers(orgId),
        invitationsRepo.listPending(orgId),
      ]);
      return reply.send({ members, invitations });
    },
  );

  // ───────────────────────── PATCH /orgs/current/members/:userId ───────────
  app.patch(
    '/api/v1/orgs/current/members/:userId',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const params = userIdParamSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid member id' },
        });
      }
      const body = updateMemberRoleBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Invalid role payload',
            details: body.error.flatten().fieldErrors,
          },
        });
      }

      const orgId = req.session!.currentOrgId!;
      const actorRole = req.membership!.role;

      // A user cannot change their own role (spec §3). Block before the repo so
      // an owner can't accidentally demote themselves out of the last-owner
      // seat via this endpoint either.
      if (params.data.userId === req.user!.id) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.CANNOT_CHANGE_OWN_ROLE,
            message: 'You cannot change your own role.',
          },
        });
      }

      try {
        await repo.changeRole(orgId, params.data.userId, body.data.role, actorRole);
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof LastOwnerError) {
          return reply.status(409).send({
            error: { code: ERROR_CODES.LAST_OWNER, message: err.message },
          });
        }
        if (
          err instanceof OwnerRoleChangeForbiddenError ||
          err instanceof AdminCannotManageError
        ) {
          return reply.status(403).send({
            error: { code: ERROR_CODES.FORBIDDEN, message: err.message },
          });
        }
        if (err instanceof MemberNotFoundError) {
          return reply.status(404).send({
            error: { code: ERROR_CODES.NOT_FOUND, message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ───────────────────────── DELETE /orgs/current/members/:userId ──────────
  app.delete(
    '/api/v1/orgs/current/members/:userId',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const params = userIdParamSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid member id' },
        });
      }

      const orgId = req.session!.currentOrgId!;
      // Self-removal must go through /leave so the last-owner check is the
      // sole gate (and so we can't pretend a self-delete is an admin action).
      if (params.data.userId === req.user!.id) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.CANNOT_REMOVE_SELF,
            message: 'Use POST /api/v1/orgs/current/members/leave to remove yourself.',
          },
        });
      }

      const actorRole = req.membership!.role;

      try {
        await repo.removeMember(orgId, params.data.userId, actorRole);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof LastOwnerError) {
          return reply.status(409).send({
            error: { code: ERROR_CODES.LAST_OWNER, message: err.message },
          });
        }
        if (err instanceof AdminCannotManageError) {
          return reply.status(403).send({
            error: { code: ERROR_CODES.FORBIDDEN, message: err.message },
          });
        }
        if (err instanceof MemberNotFoundError) {
          return reply.status(404).send({
            error: { code: ERROR_CODES.NOT_FOUND, message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ───────────────────────── POST /orgs/current/members/leave ──────────────
  // Anyone in the org may leave — no requireRole gate. Last-owner is the only
  // blocker (delegated to the repo).
  app.post(
    '/api/v1/orgs/current/members/leave',
    { preHandler: requireOrg },
    async (req, reply) => {
      const orgId = req.session!.currentOrgId!;
      try {
        await repo.leave(orgId, req.user!.id);
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof LastOwnerError) {
          return reply.status(409).send({
            error: { code: ERROR_CODES.LAST_OWNER, message: err.message },
          });
        }
        if (err instanceof MemberNotFoundError) {
          // Should not happen — requireOrg already verified membership — but
          // surface a sensible 404 just in case the row vanished mid-request.
          return reply.status(404).send({
            error: { code: ERROR_CODES.NOT_FOUND, message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ───────────────────────── GET /orgs ────────────────────────────────────
  // Multi-org list for the active user. Orgs the caller belongs to, with the
  // caller's role in each, ordered by name.
  app.get('/api/v1/orgs', { preHandler: requireOrg }, async (req, reply) => {
    const userId = req.user!.id;
    const rows = await deps.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        role: schema.orgMembers.role,
      })
      .from(schema.orgMembers)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.orgMembers.organizationId),
      )
      .where(eq(schema.orgMembers.userId, userId))
      .orderBy(asc(schema.organizations.name));

    const orgs: PublicOrgSummary[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role as OrgRole,
    }));
    return reply.send({ orgs });
  });

  // ───────────────────────── POST /orgs/switch ────────────────────────────
  // Verify membership in the target org, then repoint this session's
  // current_org_id at it. Session id comes from `req.session!.id` (matches
  // the auth module's `req.session.id` usage in logout).
  app.post('/api/v1/orgs/switch', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = switchOrgBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid switch payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const targetOrgId = parsed.data.organizationId;
    const userId = req.user!.id;

    const [membership] = await deps.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.organizationId, targetOrgId),
          eq(schema.orgMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!membership) {
      return reply.status(403).send({
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'You are not a member of that organization.',
        },
      });
    }

    await deps.db
      .update(schema.sessions)
      .set({ currentOrgId: targetOrgId })
      .where(eq(schema.sessions.id, req.session!.id));

    return reply.send({ ok: true });
  });
}
