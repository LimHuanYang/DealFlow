import { buildApp } from '../../src/server.js';
import type { Env } from '../../src/env.js';
import type { Database } from '@dealflow/db';

export async function buildTestApp(opts: { envOverrides?: Partial<Env>; db?: Database } = {}) {
  const env: Env = {
    NODE_ENV: 'test',
    PORT: 0,
    DEPLOYMENT_MODE: 'saas',
    CORS_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: undefined,
    SESSION_COOKIE_SECRET: 'test-session-secret-32-chars-minimum-x',
    SESSION_COOKIE_NAME: 'dealflow_session',
    SESSION_DURATION_DAYS: 30,
    CSRF_SECRET: 'test-csrf-secret-32-chars-minimum-xxxxx',
    ANTHROPIC_MODEL: 'claude-haiku-4-5',
    GEMINI_MODEL: 'gemini-2.5-flash',
    XAI_MODEL: 'grok-4',
    ...opts.envOverrides,
  };
  const app = await buildApp({ env, logger: false, db: opts.db });
  return app;
}
