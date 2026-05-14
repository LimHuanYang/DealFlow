import { buildApp } from '../../src/server.js';
import type { Env } from '../../src/env.js';

export async function buildTestApp(envOverrides: Partial<Env> = {}) {
  const env: Env = {
    NODE_ENV: 'test',
    PORT: 0,
    DEPLOYMENT_MODE: 'saas',
    CORS_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: undefined,
    ...envOverrides,
  };
  const app = await buildApp({ env, logger: false });
  return app;
}
