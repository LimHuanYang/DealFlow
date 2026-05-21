import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { type EmailProvider, EmailDisabledError } from '@dealflow/email';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { ERROR_CODES, sendEmailBodySchema } from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ActivitiesRepo } from '../activities/activities.repo.js';

export interface EmailRoutesDeps {
  db: Database;
  emailProvider: EmailProvider;
  /** Raw sender email address. Null when disabled. */
  emailFromAddress: string | null;
  /** Whether the provider has the minimum config to send. */
  emailEnabled: boolean;
}

function publicActivity(row: typeof schema.activities.$inferSelect) {
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
    error: {
      code: 'EMAIL_DISABLED',
      message: 'Email is not configured on this DealFlow instance.',
    },
  });
}

function emailUpstreamError(reply: FastifyReply) {
  return reply.status(502).send({
    error: { code: 'EMAIL_UPSTREAM_ERROR', message: 'Email provider request failed.' },
  });
}

export async function registerEmailRoutes(
  app: FastifyInstance,
  deps: EmailRoutesDeps,
): Promise<void> {
  const activities = new ActivitiesRepo(deps.db);

  app.get('/api/v1/email/status', { preHandler: requireOrg }, async (_req, reply) => {
    return reply.send({ enabled: deps.emailEnabled, from: deps.emailFromAddress });
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
    if (!deps.emailEnabled || !deps.emailFromAddress) return emailDisabled(reply);

    const orgId = req.session!.currentOrgId!;
    const userId = req.user!.id;

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
        error: {
          code: 'CONTACT_HAS_NO_EMAIL',
          message: 'This contact has no email address on file. Add one before sending.',
        },
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

    // Personalised from: "Alice <noreply@dealflow.app>".
    const personalisedFrom = `${userRow.name} <${deps.emailFromAddress}>`;

    try {
      const result = await deps.emailProvider.send({
        from: personalisedFrom,
        to: contactRow.email,
        replyTo: userRow.email,
        subject: parsed.data.subject,
        text: parsed.data.body,
      });
      const created = await activities.create(orgId, userId, {
        kind: 'email',
        body: parsed.data.body,
        contactId: parsed.data.contactId,
      });
      // ActivitiesRepo.create doesn't accept subject/externalId; bump via UPDATE.
      const [updated] = await deps.db
        .update(schema.activities)
        .set({ subject: parsed.data.subject, externalId: result.messageId, updatedAt: new Date() })
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
