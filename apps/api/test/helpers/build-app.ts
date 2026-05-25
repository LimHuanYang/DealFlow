import type { AIProvider } from '@dealflow/ai';
import type { EmailProvider } from '@dealflow/email';
import { buildApp } from '../../src/server.js';
import type { Env } from '../../src/env.js';
import type { Database } from '@dealflow/db';

export interface BuildTestAppOptions {
  envOverrides?: Partial<Env>;
  /** Alias for envOverrides — accepted for convenience. */
  env?: Partial<Env>;
  db?: Database;
  /** Test-only injection — bypasses the org-integrations DB lookup. */
  aiProviderForOrg?: (orgId: string) => Promise<{
    provider: AIProvider;
    chain: Array<{ name: string; model: string }>;
  }>;
  /** Test-only injection — bypasses the org-integrations DB lookup. */
  emailProviderForOrg?: (orgId: string) => Promise<{
    provider: EmailProvider;
    fromAddress: string | null;
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
    PUBLIC_API_URL: 'http://localhost:3000',
    ...opts.envOverrides,
    ...opts.env,
  };
  const app = await buildApp({
    env,
    logger: false,
    db: opts.db,
    aiProviderForOrg: opts.aiProviderForOrg,
    emailProviderForOrg: opts.emailProviderForOrg,
  });
  return app;
}
