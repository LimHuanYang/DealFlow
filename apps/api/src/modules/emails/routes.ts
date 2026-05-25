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
import { loadEnv, type Env } from '../../env.js';
import { signTrackingToken } from '../../lib/email-tracking-token.js';
import { wrapBodyAsHtml } from '../../lib/email-html-wrap.js';

export interface EmailRoutesDeps {
  db: Database;
  encryptionKey: Buffer;
  /** Optional env override (tests inject this to control tracking behaviour). */
  env?: Partial<Env>;
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
    ccEmails: row.ccEmails,
    bccEmails: row.bccEmails,
    trackingEnabled: row.trackingEnabled,
    deliveryStatus: row.deliveryStatus as 'sent' | 'failed',
    openCount: row.openCount,
    firstOpenedAt: row.firstOpenedAt?.toISOString() ?? null,
    lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null,
    clickCount: row.clickCount,
    firstClickedAt: row.firstClickedAt?.toISOString() ?? null,
    lastClickedAt: row.lastClickedAt?.toISOString() ?? null,
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
  const resolvedEnv = { ...loadEnv(), ...deps.env };
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
    const trackEnabled = parsed.data.trackEnabled ?? true;
    const trackingActive = trackEnabled && !!resolvedEnv.EMAIL_TRACKING_SECRET;

    // 1. Pre-create the activity row so we have an ID to embed in tracking URLs.
    const created = await activitiesRepo.create(orgId, userId, {
      kind: 'email',
      body: parsed.data.body,
      contactId: parsed.data.contactId,
      ccEmails: parsed.data.cc ?? null,
      bccEmails: parsed.data.bcc ?? null,
      trackingEnabled: trackEnabled,
      deliveryStatus: 'sent',
    });

    // 2. Build HTML body if tracking is active.
    let html: string | undefined;
    if (trackingActive) {
      const token = signTrackingToken(created.id, resolvedEnv.EMAIL_TRACKING_SECRET!);
      const pixelUrl = `${resolvedEnv.PUBLIC_API_URL}/track/open/${token}`;
      const wrapped = wrapBodyAsHtml(parsed.data.body, {
        pixelUrl,
        rewriteLink: (originalUrl) =>
          `${resolvedEnv.PUBLIC_API_URL}/track/click/${token}?u=${encodeURIComponent(
            Buffer.from(originalUrl, 'utf8').toString('base64url'),
          )}`,
      });
      html = wrapped.html;
    }

    try {
      const result = await provider.send({
        from: personalisedFrom,
        to: contactRow.email,
        replyTo: userRow.email,
        subject: parsed.data.subject,
        text: parsed.data.body,
        ...(html ? { html } : {}),
        ...(parsed.data.cc ? { cc: parsed.data.cc } : {}),
        ...(parsed.data.bcc ? { bcc: parsed.data.bcc } : {}),
      });

      // 3. Stamp the SMTP messageId + subject on the activity.
      const [updated] = await deps.db
        .update(schema.activities)
        .set({
          subject: parsed.data.subject,
          externalId: result.messageId,
          updatedAt: new Date(),
        })
        .where(eq(schema.activities.id, created.id))
        .returning();

      // 4. Insert a 'sent' email_events row for the timeline.
      await deps.db.insert(schema.emailEvents).values({
        organizationId: orgId,
        activityId: created.id,
        eventType: 'sent',
      });

      return reply.status(201).send({ activity: publicActivity(updated ?? created) });
    } catch (err) {
      // Send failed — mark the activity row and DON'T record a sent event.
      await deps.db
        .update(schema.activities)
        .set({ deliveryStatus: 'failed', updatedAt: new Date() })
        .where(eq(schema.activities.id, created.id));
      if (err instanceof EmailDisabledError) return emailDisabled(reply);
      req.log.error({ err }, 'POST /emails failed');
      return emailUpstreamError(reply);
    }
  });
}
