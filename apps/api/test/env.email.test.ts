import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://x:y@localhost:5432/z',
};

describe('Email env vars', () => {
  it('all email vars default to undefined / sensible defaults', () => {
    const env = loadEnv(BASE);
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.RESEND_FROM_EMAIL).toBeUndefined();
    expect(env.RESEND_FROM_NAME).toBe('DealFlow');
  });

  it('accepts custom values', () => {
    const env = loadEnv({
      ...BASE,
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'noreply@example.com',
      RESEND_FROM_NAME: 'Acme CRM',
    });
    expect(env.RESEND_API_KEY).toBe('re_test_key');
    expect(env.RESEND_FROM_EMAIL).toBe('noreply@example.com');
    expect(env.RESEND_FROM_NAME).toBe('Acme CRM');
  });
});
