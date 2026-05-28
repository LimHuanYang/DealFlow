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
    INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    EMAIL_TRACKING_SECRET: z.string().min(32).optional(),
    ATTACHMENTS_CACHE_DIR: z.string().default('apps/api/.data/cache/attachments'),
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
    if (data.NODE_ENV !== 'test' && !data.INTEGRATION_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTEGRATION_ENCRYPTION_KEY'],
        message:
          'INTEGRATION_ENCRYPTION_KEY is required outside of test. ' +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
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
