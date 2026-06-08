import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildEmailProvider,
  describeEmail,
  type EmailConfig,
  type EmailProvider,
  EmailDisabledError,
} from '@dealflow/email';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  acceptInvitationBodySchema,
  createInvitationBodySchema,
  ERROR_CODES,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { requireRole } from '../../plugins/require-role.js';
import { loadEnv, type Env } from '../../env.js';
import { hashPassword } from '../../lib/password.js';
import { normalizeEmail, isValidEmail } from '../../lib/email.js';
import { buildInviteEmail } from '../../lib/invite-email.js';
import { OrgIntegrationsRepo } from '../integrations/repo.js';
import { SessionsRepo } from '../auth/sessions.repo.js';
import { UsersRepo } from '../auth/users.repo.js';
import {
  InvitationAlreadyAcceptedError,
  InvitationDuplicateError,
  InvitationExpiredError,
  InvitationForExistingMemberError,
  InvitationNotFoundError,
  InvitationsRepo,
} from './invitations.repo.js';

const idParamSchema = z.object({ id: z.string().uuid() });
const tokenParamSchema = z.object({ token: z.string().min(1).max(512) });

/**
 * Match signup's password rule. The shared `acceptInvitationBodySchema`
 * permits `.min(8)` so the public preview-payload validates loosely, but the
 * actual signup-on-accept path enforces the same min as `POST /auth/signup`.
 */
const ACCEPT_NEW_USER_MIN_PASSWORD = 12;

export interface InvitationsRoutesDeps {
  db: Database;
  encryptionKey: Buffer;
  /** Optional env override (tests inject this). */
  env?: Partial<Env>;
  /**
   * Optional override (tests only). Same shape as the emails-route override
   * so the test harness can inject a single fake provider for both modules.
   */
  emailProviderForOrg?: (orgId: string) => Promise<{
    provider: EmailProvider;
    fromAddress: string | null;
  }>;
}

/** Replicates the same per-org SMTP loader the emails module uses. */
async function loadEmailConfig(
  integrations: OrgIntegrationsRepo,
  orgId: string,
): Promise<EmailConfig> {
  const dec = await integrations.getDecrypted(orgId);
  if (!dec.smtp) return {};
  return {
    smtp: {
      host: dec.smtp.host,
      port: dec.smtp.port,
      user: dec.smtp.user,
      pass: dec.smtp.pass,
      fromEmail: dec.smtp.fromEmail,
      fromName: dec.smtp.fromName,
    },
  };
}

/** Per-org inviter name + org name lookup for the email body and preview. */
async function loadInviteContext(
  db: Database,
  orgId: string,
  inviterId: string | null,
): Promise<{ orgName: string; inviterName: string | null }> {
  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);
  let inviterName: string | null = null;
  if (inviterId) {
    const [u] = await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, inviterId))
      .limit(1);
    inviterName = u?.name ?? null;
  }
  return { orgName: org?.name ?? 'your team', inviterName };
}

export async function registerInvitationsRoutes(
  app: FastifyInstance,
  deps: InvitationsRoutesDeps,
): Promise<void> {
  const resolvedEnv = { ...loadEnv(), ...deps.env };
  const invitationsRepo = new InvitationsRepo(deps.db);
  const integrations = new OrgIntegrationsRepo(deps.db, deps.encryptionKey);
  const sessions = new SessionsRepo(deps.db);
  const users = new UsersRepo(deps.db);

  /**
   * Resolve the per-org email provider the SAME way the emails module does:
   * test-only override first, otherwise load + decrypt SMTP config and build
   * a SMTP provider (or Noop when SMTP isn't configured).
   */
  async function resolveEmail(orgId: string): Promise<{
    provider: EmailProvider;
    fromAddress: string | null;
  }> {
    if (deps.emailProviderForOrg) return deps.emailProviderForOrg(orgId);
    const cfg = await loadEmailConfig(integrations, orgId);
    const provider = buildEmailProvider(cfg);
    const desc = describeEmail(cfg);
    return { provider, fromAddress: desc.fromAddress };
  }

  /**
   * Best-effort send. Swallows EmailDisabledError so create/resend still
   * succeeds when the org hasn't configured SMTP — the UI then offers the
   * caller a copy-link fallback.
   */
  async function sendInviteEmail(
    orgId: string,
    to: string,
    inviteUrl: string,
    role: 'admin' | 'member',
    inviterId: string | null,
  ): Promise<void> {
    const [{ provider, fromAddress }, ctx] = await Promise.all([
      resolveEmail(orgId),
      loadInviteContext(deps.db, orgId, inviterId),
    ]);
    if (!fromAddress) return; // SMTP not configured — silent skip.
    const built = buildInviteEmail({
      orgName: ctx.orgName,
      inviterName: ctx.inviterName,
      role,
      acceptUrl: inviteUrl,
    });
    try {
      await provider.send({
        from: fromAddress,
        to,
        replyTo: fromAddress,
        subject: built.subject,
        text: built.text,
        html: built.html,
      });
    } catch (err) {
      if (err instanceof EmailDisabledError) return;
      // Re-throw transport errors so create can roll back / surface 502 if
      // we ever want to make the email mandatory in the future. For now the
      // route catches and logs only.
      app.log.warn({ err }, 'invitation email send failed');
    }
  }

  // ───────────────────────── POST /orgs/current/invitations ────────────────
  app.post(
    '/api/v1/orgs/current/invitations',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const parsed = createInvitationBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Invalid invitation payload',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }
      const orgId = req.session!.currentOrgId!;
      const inviterId = req.user!.id;

      try {
        const { invitation, token } = await invitationsRepo.create(
          orgId,
          { email: parsed.data.email, role: parsed.data.role },
          inviterId,
        );
        const inviteUrl = `${resolvedEnv.PUBLIC_WEB_URL}/invite/${token}`;
        await sendInviteEmail(
          orgId,
          parsed.data.email,
          inviteUrl,
          parsed.data.role,
          inviterId,
        );
        return reply.status(201).send({ invitation, inviteUrl });
      } catch (err) {
        if (err instanceof InvitationForExistingMemberError) {
          return reply.status(409).send({
            error: { code: ERROR_CODES.ALREADY_MEMBER, message: err.message },
          });
        }
        if (err instanceof InvitationDuplicateError) {
          return reply.status(409).send({
            error: { code: ERROR_CODES.ALREADY_INVITED, message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ───────────────────── POST /orgs/current/invitations/:id/resend ─────────
  app.post(
    '/api/v1/orgs/current/invitations/:id/resend',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const params = idParamSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid invitation id' },
        });
      }
      const orgId = req.session!.currentOrgId!;
      const inviterId = req.user!.id;

      try {
        const invitation = await invitationsRepo.resend(orgId, params.data.id);
        // Need the raw token to rebuild the invite URL.
        const [row] = await deps.db
          .select({ token: schema.invitations.token, role: schema.invitations.role })
          .from(schema.invitations)
          .where(
            and(
              eq(schema.invitations.id, invitation.id),
              eq(schema.invitations.organizationId, orgId),
            ),
          )
          .limit(1);
        if (row) {
          const inviteUrl = `${resolvedEnv.PUBLIC_WEB_URL}/invite/${row.token}`;
          await sendInviteEmail(
            orgId,
            invitation.email,
            inviteUrl,
            row.role as 'admin' | 'member',
            inviterId,
          );
        }
        return reply.send({ invitation });
      } catch (err) {
        if (err instanceof InvitationNotFoundError) {
          return reply.status(404).send({
            error: { code: ERROR_CODES.NOT_FOUND, message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ───────────────────── DELETE /orgs/current/invitations/:id ──────────────
  app.delete(
    '/api/v1/orgs/current/invitations/:id',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const params = idParamSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid invitation id' },
        });
      }
      const orgId = req.session!.currentOrgId!;
      await invitationsRepo.revoke(orgId, params.data.id);
      return reply.status(204).send();
    },
  );

  // ───────────────────────── GET /invitations/:token (public) ──────────────
  app.get('/api/v1/invitations/:token', async (req, reply) => {
    const params = tokenParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid token' },
      });
    }
    const inv = await invitationsRepo.getByToken(params.data.token);
    if (!inv) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.INVITATION_NOT_FOUND, message: 'Invitation not found.' },
      });
    }
    if (inv.acceptedAt) {
      return reply.status(410).send({
        error: {
          code: ERROR_CODES.INVITATION_ALREADY_ACCEPTED,
          message: 'Invitation has already been accepted.',
        },
      });
    }
    const ctx = await loadInviteContext(deps.db, inv.organizationId, inv.invitedBy);
    const existingUser = await users.findByEmail(inv.email);
    const expired = inv.expiresAt.getTime() <= Date.now();
    return reply.send({
      orgName: ctx.orgName,
      inviterName: ctx.inviterName,
      role: inv.role,
      emailHasAccount: !!existingUser,
      expired,
    });
  });

  // ───────────────────────── POST /invitations/:token/accept (public) ──────
  app.post('/api/v1/invitations/:token/accept', async (req, reply) => {
    const params = tokenParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid token' },
      });
    }
    const bodyParsed = acceptInvitationBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid accept payload',
          details: bodyParsed.error.flatten().fieldErrors,
        },
      });
    }

    const inv = await invitationsRepo.getByToken(params.data.token);
    if (!inv) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.INVITATION_NOT_FOUND, message: 'Invitation not found.' },
      });
    }
    if (inv.expiresAt.getTime() <= Date.now() && !inv.acceptedAt) {
      return reply.status(410).send({
        error: { code: ERROR_CODES.INVITATION_EXPIRED, message: 'Invitation has expired.' },
      });
    }

    const inviteEmail = normalizeEmail(inv.email);
    const existingUser = await users.findByEmail(inviteEmail);

    // ── Existing-user path ─────────────────────────────────────────────────
    if (existingUser) {
      // The accept flow only joins the *currently signed-in* user that
      // matches the invitation email. A different signed-in user or no
      // session → SIGNIN_REQUIRED so the web app can redirect to login.
      if (!req.user || req.user.id !== existingUser.id) {
        return reply.status(401).send({
          error: {
            code: ERROR_CODES.SIGNIN_REQUIRED,
            message: 'Sign in with the invited email to accept this invitation.',
          },
        });
      }

      try {
        const result = await invitationsRepo.accept(params.data.token, existingUser.id);
        // Update the caller's session current_org_id to the invited org so a
        // subsequent GET /orgs/current resolves to the new org.
        if (req.session) {
          await deps.db
            .update(schema.sessions)
            .set({ currentOrgId: result.organizationId })
            .where(eq(schema.sessions.id, req.session.id));
        }
        return reply.send({
          organizationId: result.organizationId,
          role: result.role,
        });
      } catch (err) {
        if (err instanceof InvitationNotFoundError) {
          return reply.status(404).send({
            error: { code: ERROR_CODES.INVITATION_NOT_FOUND, message: err.message },
          });
        }
        if (err instanceof InvitationExpiredError) {
          return reply.status(410).send({
            error: { code: ERROR_CODES.INVITATION_EXPIRED, message: err.message },
          });
        }
        if (err instanceof InvitationAlreadyAcceptedError) {
          return reply.status(410).send({
            error: { code: ERROR_CODES.INVITATION_ALREADY_ACCEPTED, message: err.message },
          });
        }
        throw err;
      }
    }

    // ── New-user path ──────────────────────────────────────────────────────
    // Email isn't yet a user → require name + password (with the same min as
    // signup) and create the user + a session.
    const { name, password } = bodyParsed.data;
    if (!name || !password) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'name and password are required for new accounts.',
        },
      });
    }
    if (password.length < ACCEPT_NEW_USER_MIN_PASSWORD) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: `Password must be at least ${ACCEPT_NEW_USER_MIN_PASSWORD} characters.`,
        },
      });
    }
    if (!isValidEmail(inviteEmail)) {
      // Should never trigger — the invitation row's email passed Zod at create
      // time — but guard anyway so we don't insert a junk user row.
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid invitation email.' },
      });
    }

    const passwordHash = await hashPassword(password);
    const user = await users.create({ email: inviteEmail, name, passwordHash });
    let result;
    try {
      result = await invitationsRepo.accept(params.data.token, user.id);
    } catch (err) {
      if (err instanceof InvitationExpiredError) {
        return reply.status(410).send({
          error: { code: ERROR_CODES.INVITATION_EXPIRED, message: err.message },
        });
      }
      if (err instanceof InvitationAlreadyAcceptedError) {
        return reply.status(410).send({
          error: { code: ERROR_CODES.INVITATION_ALREADY_ACCEPTED, message: err.message },
        });
      }
      if (err instanceof InvitationNotFoundError) {
        return reply.status(404).send({
          error: { code: ERROR_CODES.INVITATION_NOT_FOUND, message: err.message },
        });
      }
      throw err;
    }
    const session = await sessions.create({
      userId: user.id,
      currentOrgId: result.organizationId,
      expiresInDays: resolvedEnv.SESSION_DURATION_DAYS,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });
    const signed = reply.signCookie(session.id);
    reply.setCookie(resolvedEnv.SESSION_COOKIE_NAME, signed);
    return reply.status(201).send({
      organizationId: result.organizationId,
      role: result.role,
    });
  });
}
