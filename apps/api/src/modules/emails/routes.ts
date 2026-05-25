import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm';
import {
  buildEmailProvider,
  describeEmail,
  EmailDisabledError,
  type EmailConfig,
  type EmailProvider,
} from '@dealflow/email';
import type { Database, schema as schemaType } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { ERROR_CODES, sendEmailBodySchema, emailDashboardQuerySchema, emailRollupEntityTypeSchema } from '@dealflow/shared';
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
    //    subject is stamped here so concurrent reads don't see a subject-less row.
    const created = await activitiesRepo.create(orgId, userId, {
      kind: 'email',
      body: parsed.data.body,
      subject: parsed.data.subject,
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

      // 3. Stamp the SMTP messageId on the activity (subject already set at pre-create).
      const [updated] = await deps.db
        .update(schema.activities)
        .set({
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
      // Best-effort: if THIS update also throws, log it but still return the error response.
      try {
        await deps.db
          .update(schema.activities)
          .set({ deliveryStatus: 'failed', updatedAt: new Date() })
          .where(eq(schema.activities.id, created.id));
      } catch (updateErr) {
        req.log.error({ err: updateErr, activityId: created.id }, 'Failed to mark activity as failed');
      }
      if (err instanceof EmailDisabledError) return emailDisabled(reply);
      req.log.error({ err }, 'POST /emails failed');
      return emailUpstreamError(reply);
    }
  });

  app.get('/api/v1/emails', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = emailDashboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid filter' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const { status, range, q, cursor } = parsed.data;

    const conds = [
      eq(schema.activities.organizationId, orgId),
      eq(schema.activities.kind, 'email'),
    ];
    if (range !== 'all') {
      const ms = range === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;
      conds.push(gte(schema.activities.createdAt, new Date(Date.now() - ms)));
    }
    if (status === 'failed') {
      conds.push(eq(schema.activities.deliveryStatus, 'failed'));
    } else if (status === 'opened') {
      conds.push(sql`${schema.activities.openCount} > 0`);
    } else if (status === 'clicked') {
      conds.push(sql`${schema.activities.clickCount} > 0`);
    }
    if (q) {
      conds.push(ilike(schema.activities.subject, `%${q}%`));
    }
    if (cursor) {
      const decoded = new Date(cursor);
      if (!Number.isNaN(decoded.getTime())) {
        conds.push(lt(schema.activities.createdAt, decoded));
      }
    }

    const PAGE_SIZE = 50;
    const rows = await deps.db
      .select({
        id: schema.activities.id,
        subject: schema.activities.subject,
        sentAt: schema.activities.createdAt,
        deliveryStatus: schema.activities.deliveryStatus,
        openCount: schema.activities.openCount,
        clickCount: schema.activities.clickCount,
        contactFirstName: schema.contacts.firstName,
        contactLastName: schema.contacts.lastName,
        contactEmail: schema.contacts.email,
      })
      .from(schema.activities)
      .leftJoin(schema.contacts, eq(schema.activities.contactId, schema.contacts.id))
      .where(and(...conds))
      .orderBy(desc(schema.activities.createdAt))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const sliced = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const items = sliced.map((r) => ({
      id: r.id,
      subject: r.subject,
      recipientName: [r.contactFirstName, r.contactLastName].filter(Boolean).join(' ') || null,
      recipientEmail: r.contactEmail,
      sentAt: r.sentAt.toISOString(),
      deliveryStatus: r.deliveryStatus as 'sent' | 'failed',
      openCount: r.openCount,
      clickCount: r.clickCount,
    }));
    const nextCursor =
      hasMore && sliced.length > 0 ? sliced[sliced.length - 1]!.sentAt.toISOString() : null;
    return reply.send({ items, nextCursor });
  });

  app.get(
    '/api/v1/emails/engagement/:entityType/:id',
    { preHandler: requireOrg },
    async (req, reply) => {
      const params = req.params as { entityType: string; id: string };
      const entityType = emailRollupEntityTypeSchema.safeParse(params.entityType);
      if (!entityType.success) {
        return reply.status(400).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Bad entity type' },
        });
      }
      const orgId = req.session!.currentOrgId!;
      const fkColumn =
        entityType.data === 'contact'
          ? schema.activities.contactId
          : entityType.data === 'company'
            ? schema.activities.companyId
            : schema.activities.dealId;

      const [agg] = await deps.db
        .select({
          sent: sql<number>`COUNT(*)::int`,
          opened: sql<number>`(COUNT(*) FILTER (WHERE ${schema.activities.openCount} > 0))::int`,
          clickedWith: sql<number>`(COUNT(*) FILTER (WHERE ${schema.activities.clickCount} > 0))::int`,
          lastActivityAt: sql<Date | null>`MAX(${schema.activities.createdAt})`,
        })
        .from(schema.activities)
        .where(
          and(
            eq(schema.activities.organizationId, orgId),
            eq(schema.activities.kind, 'email'),
            eq(fkColumn, params.id),
          ),
        );

      const sent = agg?.sent ?? 0;
      const opened = agg?.opened ?? 0;
      const clickedWith = agg?.clickedWith ?? 0;
      const rawLastAt = agg?.lastActivityAt ?? null;
      const lastActivityAt =
        rawLastAt instanceof Date
          ? rawLastAt.toISOString()
          : typeof rawLastAt === 'string'
            ? rawLastAt
            : null;
      return reply.send({
        sent,
        opened,
        openedPct: sent > 0 ? opened / sent : 0,
        clickedWith,
        clickedWithPct: sent > 0 ? clickedWith / sent : 0,
        lastActivityAt,
      });
    },
  );
}
