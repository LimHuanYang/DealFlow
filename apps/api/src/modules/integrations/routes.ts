import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { buildAIProvider, type AIConfig, AIDisabledError } from '@dealflow/ai';
import { buildEmailProvider, type EmailConfig, EmailDisabledError } from '@dealflow/email';
import {
  engineMailerConfigSchema,
  ERROR_CODES,
  testAIBodySchema,
  updateIntegrationsBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { requireRole } from '../../plugins/require-role.js';
import { OrgIntegrationsRepo } from './repo.js';

/**
 * Body schema for POST /test-email. The recipient is optional — if omitted,
 * the test sends to the logged-in user's own email (legacy behaviour). The
 * Settings UI now exposes a "Send test to:" input so users can verify the
 * SMTP path works for arbitrary recipients without writing a full template.
 */
const testEmailBodySchema = z.object({
  to: z.string().email().optional(),
});

export interface IntegrationsRoutesDeps {
  db: Database;
  encryptionKey: Buffer;
}

export async function registerIntegrationsRoutes(
  app: FastifyInstance,
  deps: IntegrationsRoutesDeps,
): Promise<void> {
  const repo = new OrgIntegrationsRepo(deps.db, deps.encryptionKey);

  app.get('/api/v1/integrations', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    const masked = await repo.getMasked(orgId);
    return reply.send(masked);
  });

  app.patch(
    '/api/v1/integrations',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const parsed = updateIntegrationsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Invalid integrations patch',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }
      const orgId = req.session!.currentOrgId!;
      await repo.update(orgId, parsed.data);
      const masked = await repo.getMasked(orgId);
      return reply.send(masked);
    },
  );

  // --- EngineMailer email integration (dedicated endpoints) ---
  app.get('/api/v1/integrations/email', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    return reply.send(await repo.getMaskedEmail(orgId));
  });

  app.patch(
    '/api/v1/integrations/email',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const parsed = engineMailerConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Invalid EngineMailer config',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }
      const orgId = req.session!.currentOrgId!;
      await repo.saveEngineMailer(orgId, parsed.data);
      return reply.send(await repo.getMaskedEmail(orgId));
    },
  );

  app.post(
    '/api/v1/integrations/test-ai',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const parsed = testAIBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid provider' },
        });
      }
      const orgId = req.session!.currentOrgId!;
      const dec = await repo.getDecrypted(orgId);
      const providerConfig = dec[parsed.data.provider];
      if (!providerConfig) {
        return reply.send({ ok: false, error: 'Provider not configured.' });
      }
      const defaultModel: Record<typeof parsed.data.provider, string> = {
        anthropic: 'claude-haiku-4-5',
        gemini: 'gemini-2.5-flash-lite',
        grok: 'grok-3-mini',
      };
      const cfg: AIConfig = {
        [parsed.data.provider]: {
          apiKey: providerConfig.apiKey,
          model: providerConfig.model ?? defaultModel[parsed.data.provider],
        },
      } as AIConfig;
      const { providers } = buildAIProvider(cfg);
      try {
        await providers.summarizeNote({
          text: 'Hello, this is a connection test from DealFlow.',
        });
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof AIDisabledError) {
          return reply.send({ ok: false, error: 'Provider returned disabled error.' });
        }
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: msg.slice(0, 200) });
      }
    },
  );

  app.post(
    '/api/v1/integrations/test-email',
    { preHandler: [requireOrg, requireRole(['owner', 'admin'])] },
    async (req, reply) => {
      const parsed = testEmailBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Invalid test-email body',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }
      const orgId = req.session!.currentOrgId!;
      const userId = req.user!.id;
      const dec = await repo.getDecrypted(orgId);

      // Send the test to the logged-in user's own email (or a caller-supplied
      // recipient). `replyTo` stays the user's mailbox.
      const [userRow] = await deps.db
        .select({ email: schema.users.email, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!userRow) {
        return reply.send({ ok: false, error: 'Sender not found.' });
      }

      // Prefer EngineMailer; fall back to legacy SMTP; else not configured.
      let cfg: EmailConfig;
      let fromLine: string;
      if (dec.engineMailer) {
        cfg = {
          engineMailer: {
            apiKey: dec.engineMailer.apiKey,
            fromEmail: dec.engineMailer.fromEmail,
            fromName: dec.engineMailer.fromName,
          },
        };
        fromLine = `${dec.engineMailer.fromName} <${dec.engineMailer.fromEmail}>`;
      } else if (dec.smtp) {
        cfg = {
          smtp: {
            host: dec.smtp.host,
            port: dec.smtp.port,
            user: dec.smtp.user,
            pass: dec.smtp.pass,
            fromEmail: dec.smtp.fromEmail,
            fromName: dec.smtp.fromName,
          },
        };
        fromLine = `${userRow.name} <${dec.smtp.fromEmail}>`;
      } else {
        return reply.send({ ok: false, error: 'Email not configured.' });
      }
      const provider = buildEmailProvider(cfg);
      const recipient = parsed.data.to ?? userRow.email;
      try {
        await provider.send({
          from: fromLine,
          to: recipient,
          replyTo: userRow.email,
          subject: 'DealFlow email test',
          text:
            'This is a test email sent from DealFlow to verify your email configuration. ' +
            'If you can read this, sending works.',
        });
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof EmailDisabledError) {
          return reply.send({ ok: false, error: 'Email provider returned disabled error.' });
        }
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: msg.slice(0, 200) });
      }
    },
  );
}
