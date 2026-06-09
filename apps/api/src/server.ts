import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import type { AIProvider } from '@dealflow/ai';
import type { EmailProvider } from '@dealflow/email';
import type { Database } from '@dealflow/db';
import { loadEnv, type Env } from './env.js';
import { loadEncryptionKey } from './lib/crypto.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerCors } from './plugins/cors.js';
import { registerCookie } from './plugins/cookie.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  env?: Env;
  logger?: boolean;
  /** Optional injected db. In tests, the disposable DB is passed in here. */
  db?: Database;
  /** Test-only override for the AI provider resolver. Bypasses org-integrations lookup. */
  aiProviderForOrg?: (orgId: string) => Promise<{
    provider: AIProvider;
    chain: Array<{ name: string; model: string }>;
  }>;
  /** Test-only override for the email provider resolver. Bypasses org-integrations lookup. */
  emailProviderForOrg?: (orgId: string) => Promise<{
    provider: EmailProvider;
    fromAddress: string | null;
  }>;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();
  const app = Fastify({ logger: opts.logger ?? env.NODE_ENV !== 'test' });

  // Encryption key for per-org integration secrets (AI API keys, SMTP password).
  // In tests INTEGRATION_ENCRYPTION_KEY may be absent — fall back to a deterministic
  // 32-zero-byte key. Tests never persist anything cross-run, so this is safe.
  const encryptionKey = loadEncryptionKey(
    env.INTEGRATION_ENCRYPTION_KEY ?? Buffer.alloc(32).toString('base64'),
  );

  await app.register(helmet, { contentSecurityPolicy: false });
  await registerCors(app, env);
  await registerCookie(app, env);
  // CSRF deferred to Sub-Plan 2b — for 2a, baseline protection comes from
  // HttpOnly + SameSite=Lax cookies and CORS credentials policy.
  // void registerCsrf;
  await app.register(sensible);

  const multipart = await import('@fastify/multipart');
  await app.register(multipart.default, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB per file
      files: 10,
      fields: 10,
    },
    attachFieldsToBody: false,
  });

  registerErrorHandler(app);
  registerHealthRoutes(app);

  // Auth context (req.user / req.session) only when a db is provided.
  // Health-only tests pass no db and skip this; auth tests pass a disposable
  // db and get full auth wiring.
  if (opts.db) {
    const { registerAuthContext } = await import('./plugins/auth-context.js');
    await registerAuthContext(app, { db: opts.db, env });

    const { registerAuthRoutes } = await import('./modules/auth/routes.js');
    await registerAuthRoutes(app, { db: opts.db, env });

    const { registerCompaniesRoutes } = await import('./modules/companies/routes.js');
    await registerCompaniesRoutes(app, { db: opts.db });

    const { registerContactsRoutes } = await import('./modules/contacts/routes.js');
    await registerContactsRoutes(app, { db: opts.db });

    const { registerPipelinesRoutes } = await import('./modules/pipelines/routes.js');
    await registerPipelinesRoutes(app, { db: opts.db });

    const { registerDealsRoutes } = await import('./modules/deals/routes.js');
    await registerDealsRoutes(app, { db: opts.db });

    const { registerOrganizationsRoutes } = await import('./modules/organizations/routes.js');
    await registerOrganizationsRoutes(app, { db: opts.db });

    const { registerActivitiesRoutes } = await import('./modules/activities/routes.js');
    await registerActivitiesRoutes(app, { db: opts.db });

    const { registerAIRoutes } = await import('./modules/ai/routes.js');
    await registerAIRoutes(app, {
      db: opts.db,
      encryptionKey,
      aiProviderForOrg: opts.aiProviderForOrg,
    });

    const { registerEmailRoutes } = await import('./modules/emails/routes.js');
    await registerEmailRoutes(app, {
      db: opts.db,
      encryptionKey,
      env,
      emailProviderForOrg: opts.emailProviderForOrg,
    });

    const { registerEngineMailerWebhook } = await import(
      './modules/emails/engine-mailer-webhook.js'
    );
    await registerEngineMailerWebhook(app, {
      db: opts.db,
      webhookSecret: env.ENGINE_MAILER_WEBHOOK_SECRET,
    });

    const { registerIntegrationsRoutes } = await import('./modules/integrations/routes.js');
    await registerIntegrationsRoutes(app, { db: opts.db, encryptionKey });

    const { registerReportsRoutes } = await import('./modules/reports/routes.js');
    await registerReportsRoutes(app, { db: opts.db });

    const { registerCustomFieldsRoutes } = await import('./modules/custom-fields/routes.js');
    await registerCustomFieldsRoutes(app, { db: opts.db });

    const { registerMembersRoutes } = await import('./modules/members/routes.js');
    await registerMembersRoutes(app, { db: opts.db });

    const { registerInvitationsRoutes } = await import(
      './modules/members/invitations.routes.js'
    );
    await registerInvitationsRoutes(app, {
      db: opts.db,
      encryptionKey,
      env,
      emailProviderForOrg: opts.emailProviderForOrg,
    });

    const evict = async () => {
      try {
        const { runAttachmentEvictionSweep } = await import('./jobs/attachments-eviction.js');
        const result = await runAttachmentEvictionSweep({
          db: opts.db!,
          cacheDir: env.ATTACHMENTS_CACHE_DIR,
        });
        if (result.processed > 0) {
          app.log.info(
            { processed: result.processed, errors: result.errors },
            'attachment eviction sweep complete',
          );
        }
      } catch (err) {
        app.log.error({ err }, 'attachment eviction sweep failed');
      }
    };
    void evict();
    const evictInterval = setInterval(() => void evict(), 24 * 60 * 60 * 1000);
    app.addHook('onClose', async () => {
      clearInterval(evictInterval);
    });
  }

  return app;
}
