import type { AIProvider } from '@dealflow/ai';
import { buildApp } from '../../src/server.js';
import type { Env } from '../../src/env.js';
import type { Database } from '@dealflow/db';

export interface BuildTestAppOptions {
  envOverrides?: Partial<Env>;
  db?: Database;
  /** Test-only injection — bypasses the org-integrations DB lookup. */
  aiProviderForOrg?: (orgId: string) => Promise<{
    provider: AIProvider;
    chain: Array<{ name: string; model: string }>;
  }>;
}

// 32 zero bytes encoded as base64 — deterministic, test-only encryption key.
// Tests never persist anything cross-run so the all-zero key is safe.
const TEST_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');

export async function buildTestApp(opts: BuildTestAppOptions = {}) {
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
    INTEGRATION_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ...opts.envOverrides,
  };
  const app = await buildApp({
    env,
    logger: false,
    db: opts.db,
    aiProviderForOrg: opts.aiProviderForOrg,
  });
  return app;
}
