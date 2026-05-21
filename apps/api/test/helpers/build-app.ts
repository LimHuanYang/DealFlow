import { buildApp } from '../../src/server.js';
import type { Env } from '../../src/env.js';
import type { Database } from '@dealflow/db';
import type { AIProvider } from '@dealflow/ai';
import type { EmailProvider } from '@dealflow/email';

export interface BuildTestAppOptions {
  envOverrides?: Partial<Env>;
  db?: Database;
  /** Optional override of the AI chain — used by AI route tests. */
  aiProvider?: AIProvider;
  /** Optional description shown by GET /api/v1/ai/status. */
  aiChainDescription?: Array<{ name: string; model: string }>;
  /** Optional override of the email provider — used by email route tests. */
  emailProvider?: EmailProvider;
  /** Pre-formatted "Name <email>" From line shown by GET /api/v1/email/status. */
  emailFrom?: string;
  /** Whether RESEND_API_KEY + RESEND_FROM_EMAIL are both set. */
  emailEnabled?: boolean;
}

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
    ANTHROPIC_MODEL: 'claude-haiku-4-5',
    GEMINI_MODEL: 'gemini-2.5-flash',
    XAI_MODEL: 'grok-4',
    RESEND_FROM_NAME: 'DealFlow',
    SMTP_PORT: 587,
    SMTP_FROM_NAME: 'DealFlow',
    ...opts.envOverrides,
  };
  const app = await buildApp({
    env,
    logger: false,
    db: opts.db,
    aiProvider: opts.aiProvider,
    aiChainDescription: opts.aiChainDescription,
    emailProvider: opts.emailProvider,
    emailFrom: opts.emailFrom,
    emailEnabled: opts.emailEnabled,
  });
  return app;
}
