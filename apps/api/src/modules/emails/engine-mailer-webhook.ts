import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { ERROR_CODES } from '@dealflow/shared';
import { mapEngineMailerEvent, type EngineMailerWebhookPayload } from './webhook-event-mapper.js';

export interface EngineMailerWebhookDeps {
  db: Database;
  /**
   * Shared secret expected in the `?key=` query param. EngineMailer has no HMAC
   * signing — the secret rides in the callback URL — so we compare it in
   * constant time. When undefined, the endpoint rejects everything (fail safe).
   */
  webhookSecret: string | undefined;
}

/** Constant-time string compare that tolerates length mismatches. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Inbound EngineMailer tracking webhook. Replaces the self-hosted pixel +
 * click-redirect: EngineMailer POSTs open/click/delivery events here and we
 * update the matching activity (correlated by `details.txid` ===
 * `activities.external_id`). Always returns 200 on a verified request so
 * EngineMailer does not treat it as failed (it does not retry non-200).
 */
export async function registerEngineMailerWebhook(
  app: FastifyInstance,
  deps: EngineMailerWebhookDeps,
): Promise<void> {
  app.post('/api/v1/webhooks/engine-mailer', async (req, reply) => {
    const key = (req.query as { key?: string }).key;
    if (!deps.webhookSecret || !key || !safeEqual(key, deps.webhookSecret)) {
      return reply
        .code(401)
        .send({ error: { code: ERROR_CODES.WEBHOOK_KEY_INVALID, message: 'Invalid webhook key' } });
    }

    const mapped = mapEngineMailerEvent((req.body ?? {}) as EngineMailerWebhookPayload);
    if (!mapped) {
      return reply.code(200).send({ ok: true });
    }

    try {
      const [row] = await deps.db
        .select({
          id: schema.activities.id,
          orgId: schema.activities.organizationId,
          enabled: schema.activities.trackingEnabled,
        })
        .from(schema.activities)
        .where(eq(schema.activities.externalId, mapped.txid))
        .limit(1);

      if (row) {
        if (mapped.kind === 'open' && row.enabled) {
          await deps.db.transaction(async (tx) => {
            await tx
              .insert(schema.emailEvents)
              .values({ organizationId: row.orgId, activityId: row.id, eventType: 'open' });
            await tx
              .update(schema.activities)
              .set({
                openCount: sql`open_count + 1`,
                firstOpenedAt: sql`COALESCE(first_opened_at, NOW())`,
                lastOpenedAt: sql`NOW()`,
                updatedAt: new Date(),
              })
              .where(eq(schema.activities.id, row.id));
          });
        } else if (mapped.kind === 'click' && row.enabled) {
          await deps.db.transaction(async (tx) => {
            await tx.insert(schema.emailEvents).values({
              organizationId: row.orgId,
              activityId: row.id,
              eventType: 'click',
              url: mapped.url,
            });
            await tx
              .update(schema.activities)
              .set({
                clickCount: sql`click_count + 1`,
                firstClickedAt: sql`COALESCE(first_clicked_at, NOW())`,
                lastClickedAt: sql`NOW()`,
                updatedAt: new Date(),
              })
              .where(eq(schema.activities.id, row.id));
          });
        } else if (mapped.kind === 'delivery') {
          await deps.db
            .update(schema.activities)
            .set({ deliveryStatus: mapped.deliveryStatus, updatedAt: new Date() })
            .where(eq(schema.activities.id, row.id));
        }
      }
    } catch (err) {
      req.log.error({ err, txid: mapped.txid }, 'engine-mailer webhook write failed');
      // Fall through — still ack with 200.
    }
    return reply.code(200).send({ ok: true });
  });
}
