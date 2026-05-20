import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DEPLOYMENT_MODE: z.enum(['saas', 'self-host']).default('saas'),
    DATABASE_URL: z.string().url().optional(),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    // 32+ char random secret used to sign cookies (HMAC).
    SESSION_COOKIE_SECRET: z
      .string()
      .min(32)
      .default('dev-session-secret-CHANGE-ME-in-production-please'),
    SESSION_COOKIE_NAME: z.string().default('dealflow_session'),
    SESSION_DURATION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    CSRF_SECRET: z.string().min(32).default('dev-csrf-secret-CHANGE-ME-in-production-please'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
    XAI_API_KEY: z.string().optional(),
    XAI_MODEL: z.string().default('grok-4'),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().email().optional(),
    RESEND_FROM_NAME: z.string().default('DealFlow'),
  })
  .superRefine((data, ctx) => {
    // DATABASE_URL is required outside of `test` mode where the test helper
    // generates a disposable per-file URL programmatically.
    if (data.NODE_ENV !== 'test' && !data.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required outside of test',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }
  return parsed.data;
}
