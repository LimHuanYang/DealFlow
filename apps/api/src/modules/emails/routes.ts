import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
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
import {
  ERROR_CODES,
  sendEmailBodySchema,
  emailDashboardQuerySchema,
  emailRollupEntityTypeSchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ActivitiesRepo } from '../activities/activities.repo.js';
import { OrgIntegrationsRepo } from '../integrations/repo.js';
import { loadEnv, type Env } from '../../env.js';
import { signTrackingToken } from '../../lib/email-tracking-token.js';
import { wrapBodyAsHtml } from '../../lib/email-html-wrap.js';
import {
  validateAttachment,
  validateAttachmentTotal,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from '../../lib/email-attachments-validate.js';
import { cacheAttachment, evictAttachment, attachmentCachePath } from '../../lib/email-attachments-store.js';
import { EmailAttachmentsRepo } from './email-attachments.repo.js';

const idParamSchema = z.object({ id: z.string().uuid() });

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

function publicActivity(
  row: typeof schemaType.activities.$inferSelect,
  attachments: (typeof schemaType.emailAttachments.$inferSelect)[] = [],
) {
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
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      cached: a.cachePath !== null && (a.cacheExpiresAt === null || a.cacheExpiresAt > new Date()),
      createdAt: a.createdAt.toISOString(),
    })),
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
  const attachmentsRepo = new EmailAttachmentsRepo(deps.db);

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
    // 1. Parse body — JSON or multipart.
    let parsedJson: unknown;
    const filesBuffered: { filename: string; mimeType: string; buffer: Buffer }[] = [];

    if (req.isMultipart()) {
      let runningTotal = 0;
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          if (part.file.truncated) {
            return reply.status(400).send({
              error: {
                code: 'ATTACHMENT_TOO_LARGE',
                message: `File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit`,
                details: { filename: part.filename },
              },
            });
          }
          // Running-total guard: abort early so we never buffer more than the
          // total limit (+ at most one in-flight file) in memory.
          runningTotal += buf.length;
          if (runningTotal > MAX_TOTAL_BYTES) {
            return reply.status(400).send({
              error: {
                code: 'ATTACHMENTS_TOTAL_TOO_LARGE',
                message: `Total attachment size exceeds ${MAX_TOTAL_BYTES / 1024 / 1024} MB limit`,
              },
            });
          }
          filesBuffered.push({ filename: part.filename, mimeType: part.mimetype, buffer: buf });
        } else if (part.fieldname === 'body') {
          try {
            parsedJson = JSON.parse(part.value as string);
          } catch {
            return reply.status(400).send({
              error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'body field is not valid JSON' },
            });
          }
        }
      }
    } else {
      parsedJson = req.body;
    }

    const parsed = sendEmailBodySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid email payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    // 2. Validate attachments.
    for (const f of filesBuffered) {
      const v = validateAttachment({ filename: f.filename, mimeType: f.mimeType, sizeBytes: f.buffer.length });
      if (!v.ok) {
        return reply.status(400).send({ error: { code: v.code, message: v.message, details: { filename: f.filename } } });
      }
    }
    const totalCheck = validateAttachmentTotal(filesBuffered.map((f) => f.buffer.length));
    if (!totalCheck.ok) {
      return reply.status(400).send({ error: { code: totalCheck.code, message: totalCheck.message } });
    }

    // 3. Recipient + sender lookups.
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

    // 4. Pre-create the activity row so we have an ID to embed in tracking URLs.
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

    // 5. Build HTML body if tracking is active.
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

    // 6. Resolve per-org cache settings.
    const integrationsPublic = await integrations.getMasked(orgId);
    const cacheDays = integrationsPublic.email.attachmentCacheDays; // '7' | '30' | '90' | 'never'
    const cacheExpiresAt = cacheDays === 'never' ? null : new Date(Date.now() + Number(cacheDays) * 86_400_000);
    const cacheDir = resolvedEnv.ATTACHMENTS_CACHE_DIR;

    // 7. Insert attachment rows (cachePath filled after disk write).
    const attachmentRows = await attachmentsRepo.createMany(
      orgId,
      created.id,
      filesBuffered.map((f) => ({
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.buffer.length,
        cachePath: null,
        cacheExpiresAt,
      })),
    );

    const providerAttachments: { filename: string; path?: string; content?: Buffer }[] = [];
    for (let i = 0; i < attachmentRows.length; i++) {
      const row = attachmentRows[i]!;
      const file = filesBuffered[i]!;
      try {
        const rel = await cacheAttachment({ cacheDir, orgId, attachmentId: row.id, buffer: file.buffer });
        await deps.db
          .update(schema.emailAttachments)
          .set({ cachePath: rel })
          .where(eq(schema.emailAttachments.id, row.id));
        providerAttachments.push({ filename: file.filename, path: join(cacheDir, rel) });
      } catch (err) {
        // Cache write failed (disk full etc.) — send still proceeds from the buffer.
        req.log.warn({ err, attachmentId: row.id }, 'attachment cache write failed');
        providerAttachments.push({ filename: file.filename, content: file.buffer });
      }
    }

    // 8. Send.
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
        ...(providerAttachments.length > 0 ? { attachments: providerAttachments } : {}),
      });

      // Stamp the SMTP messageId on the activity (subject already set at pre-create).
      const [updated] = await deps.db
        .update(schema.activities)
        .set({
          externalId: result.messageId,
          updatedAt: new Date(),
        })
        .where(eq(schema.activities.id, created.id))
        .returning();

      // Insert a 'sent' email_events row for the timeline.
      await deps.db.insert(schema.emailEvents).values({
        organizationId: orgId,
        activityId: created.id,
        eventType: 'sent',
      });

      const finalAttachments = await attachmentsRepo.listForActivity(orgId, created.id);
      return reply.status(201).send({ activity: publicActivity(updated ?? created, finalAttachments) });
    } catch (err) {
      // Roll back attachments (rows + cached files) and mark failed.
      try {
        const rolled = await attachmentsRepo.deleteForActivity(orgId, created.id);
        for (const r of rolled) {
          if (r.cachePath) await evictAttachment({ cacheDir, orgId, attachmentId: r.id });
        }
        await deps.db
          .update(schema.activities)
          .set({ deliveryStatus: 'failed', updatedAt: new Date() })
          .where(eq(schema.activities.id, created.id));
      } catch (rollbackErr) {
        req.log.error({ err: rollbackErr, activityId: created.id }, 'attachment send rollback failed');
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

  app.get('/api/v1/attachments/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const row = await attachmentsRepo.findById(orgId, params.data.id);
    if (!row) {
      // Don't leak existence across tenants — same 404 as cache-miss.
      return reply.status(404).send({
        error: {
          code: 'ATTACHMENT_NOT_CACHED',
          message: "Retrieve from your email provider's Sent folder.",
        },
      });
    }

    const cacheDir = resolvedEnv.ATTACHMENTS_CACHE_DIR;
    const expired = row.cacheExpiresAt !== null && row.cacheExpiresAt <= new Date();

    if (row.cachePath === null || expired) {
      if (row.cachePath !== null) {
        // Lazy eviction of the expired file.
        await attachmentsRepo.clearCachePath(row.id);
        await evictAttachment({ cacheDir, orgId, attachmentId: row.id });
      }
      return reply.status(404).send({
        error: {
          code: 'ATTACHMENT_NOT_CACHED',
          message: "Retrieve from your email provider's Sent folder.",
        },
      });
    }

    const absPath = attachmentCachePath({ cacheDir, orgId, attachmentId: row.id });
    try {
      const s = await stat(absPath);
      if (!s.isFile()) throw new Error('not a file');
    } catch {
      // DB says cached but file is gone — clear the column, 404.
      await attachmentsRepo.clearCachePath(row.id);
      return reply.status(404).send({
        error: {
          code: 'ATTACHMENT_NOT_CACHED',
          message: "Retrieve from your email provider's Sent folder.",
        },
      });
    }

    reply.header('Content-Type', row.mimeType);
    reply.header('Content-Length', String(row.sizeBytes));
    // Strip CR/LF/control chars (header-injection guard) and escape quotes.
    const safeName = row.filename.replace(/[\r\n\x00-\x1f]/g, '').replace(/"/g, '\\"');
    reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
    return reply.send(createReadStream(absPath));
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
