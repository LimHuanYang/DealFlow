import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { buildAIProvider, type AIConfig, AIDisabledError } from '@dealflow/ai';
import { buildEmailProvider, type EmailConfig, EmailDisabledError } from '@dealflow/email';
import {
  ERROR_CODES,
  testAIBodySchema,
  updateIntegrationsBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { OrgIntegrationsRepo } from './repo.js';

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

  app.patch('/api/v1/integrations', { preHandler: requireOrg }, async (req, reply) => {
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
  });

  app.post('/api/v1/integrations/test-ai', { preHandler: requireOrg }, async (req, reply) => {
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
      gemini: 'gemini-2.5-flash',
      grok: 'grok-4',
    };
    const cfg: AIConfig = {
      [parsed.data.provider]: {
        apiKey: providerConfig.apiKey,
        model: providerConfig.model ?? defaultModel[parsed.data.provider],
      },
    } as AIConfig;
    const { providers } = buildAIProvider(cfg);
    try {
      await providers.summarizeNote({ text: 'Hello, this is a connection test from DealFlow.' });
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof AIDisabledError) {
        return reply.send({ ok: false, error: 'Provider returned disabled error.' });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return reply.send({ ok: false, error: msg.slice(0, 200) });
    }
  });

  app.post('/api/v1/integrations/test-email', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    const userId = req.user!.id;
    const dec = await repo.getDecrypted(orgId);
    if (!dec.smtp) {
      return reply.send({ ok: false, error: 'SMTP not configured.' });
    }
    const cfg: EmailConfig = {
      smtp: {
        host: dec.smtp.host,
        port: dec.smtp.port,
        user: dec.smtp.user,
        pass: dec.smtp.pass,
        fromEmail: dec.smtp.fromEmail,
        fromName: dec.smtp.fromName,
      },
    };
    const provider = buildEmailProvider(cfg);

    // Send the test to the logged-in user's own email.
    const [userRow] = await deps.db
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!userRow) {
      return reply.send({ ok: false, error: 'Sender not found.' });
    }
    try {
      await provider.send({
        from: `${userRow.name} <${dec.smtp.fromEmail}>`,
        to: userRow.email,
        replyTo: userRow.email,
        subject: 'DealFlow SMTP test',
        text:
          'This is a test email sent from DealFlow to verify your SMTP configuration. ' +
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
  });
}
