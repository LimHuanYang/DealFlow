import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { verifyTrackingToken } from '../../lib/email-tracking-token.js';

/** 43-byte transparent 1x1 GIF. */
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

export interface TrackingRoutesDeps {
  db: Database;
  trackingSecret: string | undefined;
}

export async function registerTrackingRoutes(
  app: FastifyInstance,
  deps: TrackingRoutesDeps,
): Promise<void> {
  app.get('/track/open/:token', async (req, reply) => {
    const { token } = req.params as { token: string };

    function returnPixel() {
      reply.header('Content-Type', 'image/gif');
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      reply.header('Pragma', 'no-cache');
      return reply.send(TRANSPARENT_GIF);
    }

    if (!deps.trackingSecret) return returnPixel();
    const v = verifyTrackingToken(token, deps.trackingSecret);
    if (!v.ok) return returnPixel();

    try {
      const [row] = await deps.db
        .select({
          id: schema.activities.id,
          orgId: schema.activities.organizationId,
          enabled: schema.activities.trackingEnabled,
        })
        .from(schema.activities)
        .where(eq(schema.activities.id, v.activityId))
        .limit(1);
      if (!row || !row.enabled) return returnPixel();

      await deps.db.transaction(async (tx) => {
        await tx.insert(schema.emailEvents).values({
          organizationId: row.orgId,
          activityId: row.id,
          eventType: 'open',
        });
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
    } catch (err) {
      req.log.error({ err, token }, '/track/open failed');
      // Fall through — still return the pixel so we don't break the recipient's UI.
    }
    return returnPixel();
  });

  app.get('/track/click/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const { u } = req.query as { u?: string };

    if (!u) {
      return reply.status(400).send('Invalid tracking link');
    }
    // Decode the base64url-encoded URL.
    let decoded: string;
    try {
      decoded = Buffer.from(u, 'base64url').toString('utf8');
    } catch {
      return reply.status(400).send('Invalid tracking link');
    }
    // Enforce http(s) scheme — never blind-redirect (open redirect vuln).
    if (!/^https?:\/\//i.test(decoded)) {
      return reply.status(400).send('Invalid tracking link');
    }

    if (!deps.trackingSecret) {
      // No secret configured: just redirect without recording.
      return reply.redirect(decoded, 302);
    }
    const v = verifyTrackingToken(token, deps.trackingSecret);
    if (!v.ok) {
      return reply.status(400).send('Invalid tracking link');
    }

    try {
      const [row] = await deps.db
        .select({
          id: schema.activities.id,
          orgId: schema.activities.organizationId,
          enabled: schema.activities.trackingEnabled,
        })
        .from(schema.activities)
        .where(eq(schema.activities.id, v.activityId))
        .limit(1);
      if (row && row.enabled) {
        await deps.db.transaction(async (tx) => {
          await tx.insert(schema.emailEvents).values({
            organizationId: row.orgId,
            activityId: row.id,
            eventType: 'click',
            url: decoded,
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
      }
    } catch (err) {
      req.log.error({ err, token }, '/track/click write failed');
      // Fall through — redirect anyway.
    }
    return reply.redirect(decoded, 302);
  });
}
