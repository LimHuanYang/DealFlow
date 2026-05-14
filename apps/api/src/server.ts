import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { loadEnv, type Env } from './env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerCors } from './plugins/cors.js';
import { registerCookie } from './plugins/cookie.js';
import { registerCsrf } from './plugins/csrf.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  env?: Env;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();
  const app = Fastify({ logger: opts.logger ?? env.NODE_ENV !== 'test' });

  await app.register(helmet, { contentSecurityPolicy: false });
  await registerCors(app, env);
  await registerCookie(app, env);
  await registerCsrf(app, env);
  await app.register(sensible);

  registerErrorHandler(app);
  registerHealthRoutes(app);

  return app;
}
