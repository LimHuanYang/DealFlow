import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import type { Database } from '@dealflow/db';
import { buildAIProvider, describeChain, type AIProvider } from '@dealflow/ai';
import { buildEmailProvider, describeEmail, type EmailProvider } from '@dealflow/email';
import { loadEnv, type Env } from './env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerCors } from './plugins/cors.js';
import { registerCookie } from './plugins/cookie.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  env?: Env;
  logger?: boolean;
  /** Optional injected db. In tests, the disposable DB is passed in here. */
  db?: Database;
  /** Optional override of the AI provider chain. Used by AI route tests. */
  aiProvider?: AIProvider;
  /** Optional override of the chain description (name + model per provider). */
  aiChainDescription?: Array<{ name: string; model: string }>;
  /** Optional override of the email provider. Used by email route tests. */
  emailProvider?: EmailProvider;
  /** Optional pre-formatted "Name <email>" From line. Used by email route tests. */
  emailFrom?: string;
  /** Optional override of the email enabled flag. Used by email route tests. */
  emailEnabled?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();
  const app = Fastify({ logger: opts.logger ?? env.NODE_ENV !== 'test' });

  await app.register(helmet, { contentSecurityPolicy: false });
  await registerCors(app, env);
  await registerCookie(app, env);
  // CSRF deferred to Sub-Plan 2b — for 2a, baseline protection comes from
  // HttpOnly + SameSite=Lax cookies and CORS credentials policy.
  // void registerCsrf;
  await app.register(sensible);

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

    // AI: tests may override either or both (provider chain and the public
    // description). In production both are derived from env.
    const aiConfig = {
      anthropic: {
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL,
      },
      gemini: {
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
      },
      grok: {
        apiKey: env.XAI_API_KEY,
        model: env.XAI_MODEL,
      },
    };
    const aiProvider =
      opts.aiProvider ??
      buildAIProvider(aiConfig, {
        onAttempt: (a) => {
          if (!a.ok) {
            app.log.warn(
              { provider: a.name, method: a.method, err: a.error?.message },
              'AI fallback',
            );
          }
        },
      }).providers;
    const aiChainDescription = opts.aiChainDescription ?? describeChain(aiConfig);

    const { registerAIRoutes } = await import('./modules/ai/routes.js');
    await registerAIRoutes(app, {
      db: opts.db,
      aiProvider,
      aiChainDescription,
    });

    // Email: tests may override provider + status fields. In production both
    // are derived from env (RESEND_API_KEY + RESEND_FROM_EMAIL + RESEND_FROM_NAME).
    const emailConfig = {
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM_EMAIL,
      name: env.RESEND_FROM_NAME,
    };
    const emailProvider = opts.emailProvider ?? buildEmailProvider(emailConfig);
    const emailDescription = describeEmail(emailConfig);
    const emailEnabled = opts.emailEnabled ?? emailDescription.provider !== 'none';
    const emailFrom = opts.emailFrom ?? emailDescription.from;

    const { registerEmailRoutes } = await import('./modules/emails/routes.js');
    await registerEmailRoutes(app, {
      db: opts.db,
      emailProvider,
      emailFrom,
      emailEnabled,
    });
  }

  return app;
}
