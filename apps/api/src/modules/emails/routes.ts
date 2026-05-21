import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import {
  buildEmailProvider,
  describeEmail,
  EmailDisabledError,
  type EmailConfig,
  type EmailProvider,
} from '@dealflow/email';
import type { Database, schema as schemaType } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { ERROR_CODES, sendEmailBodySchema } from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ActivitiesRepo } from '../activities/activities.repo.js';
import { OrgIntegrationsRepo } from '../integrations/repo.js';

export interface EmailRoutesDeps {
  db: Database;
  encryptionKey: Buffer;
  /** Optional override (tests only). */
  emailProviderForOrg?: (orgId: string) => Promise<{
    provider: EmailProvider;
    fromAddress: string | null;
  }>;
}

function publicActivity(row: typeof schemaType.activities.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    subject: row.subject,
    externalId: row.externalId,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    contactId: row.contactId,
    companyId: row.companyId,
    dealId: row.dealId,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function emailDisabled(reply: FastifyReply) {
  return reply.status(503).send({
    error: { code: 'EMAIL_DISABLED', message: 'Email is not configured for this organization.' },
  });
}

function emailUpstreamError(reply: FastifyReply) {
  return reply.status(502).send({
    error: { code: 'EMAIL_UPSTREAM_ERROR', message: 'Email provider request failed.' },
  });
}

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

export async function registerEmailRoutes(
  app: FastifyInstance,
  deps: EmailRoutesDeps,
): Promise<void> {
  const activitiesRepo = new ActivitiesRepo(deps.db);
  const integrations = new OrgIntegrationsRepo(deps.db, deps.encryptionKey);

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

  app.get('/api/v1/email/status', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    const { fromAddress } = await resolveEmail(orgId);
    return reply.send({ enabled: !!fromAddress, from: fromAddress });
  });

  app.post('/api/v1/emails', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = sendEmailBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid email payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const userId = req.user!.id;
    const { provider, fromAddress } = await resolveEmail(orgId);
    if (!fromAddress) return emailDisabled(reply);

    const [contactRow] = await deps.db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, orgId),
          eq(schema.contacts.id, parsed.data.contactId),
        ),
      )
      .limit(1);
    if (!contactRow) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' } });
    }
    if (!contactRow.email) {
      return reply.status(400).send({
        error: { code: 'CONTACT_HAS_NO_EMAIL', message: 'This contact has no email address.' },
      });
    }

    const [userRow] = await deps.db
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!userRow) {
      return reply
        .status(500)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Sender not found' } });
    }

    const personalisedFrom = `${userRow.name} <${fromAddress}>`;

    try {
      const result = await provider.send({
        from: personalisedFrom,
        to: contactRow.email,
        replyTo: userRow.email,
        subject: parsed.data.subject,
        text: parsed.data.body,
      });
      const created = await activitiesRepo.create(orgId, userId, {
        kind: 'email',
        body: parsed.data.body,
        contactId: parsed.data.contactId,
      });
      const [updated] = await deps.db
        .update(schema.activities)
        .set({
          subject: parsed.data.subject,
          externalId: result.messageId,
          updatedAt: new Date(),
        })
        .where(eq(schema.activities.id, created.id))
        .returning();
      return reply.status(201).send({ activity: publicActivity(updated ?? created) });
    } catch (err) {
      if (err instanceof EmailDisabledError) return emailDisabled(reply);
      req.log.error({ err }, 'POST /emails failed');
      return emailUpstreamError(reply);
    }
  });
}
