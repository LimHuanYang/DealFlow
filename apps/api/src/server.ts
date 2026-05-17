import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import type { Database } from '@dealflow/db';
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
  }

  return app;
}
