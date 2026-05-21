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

describe('SMTP env vars', () => {
  it('all SMTP vars default to undefined / sensible defaults', () => {
    const env = loadEnv(BASE);
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.SMTP_PASS).toBeUndefined();
    expect(env.SMTP_FROM_EMAIL).toBeUndefined();
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_FROM_NAME).toBe('DealFlow');
  });

  it('accepts custom SMTP config', () => {
    const env = loadEnv({
      ...BASE,
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_USER: 'alice@gmail.com',
      SMTP_PASS: 'app-pw-1234',
      SMTP_FROM_EMAIL: 'alice@gmail.com',
      SMTP_FROM_NAME: 'Alice CRM',
    });
    expect(env.SMTP_HOST).toBe('smtp.gmail.com');
    expect(env.SMTP_PORT).toBe(465);
    expect(env.SMTP_USER).toBe('alice@gmail.com');
    expect(env.SMTP_PASS).toBe('app-pw-1234');
    expect(env.SMTP_FROM_EMAIL).toBe('alice@gmail.com');
    expect(env.SMTP_FROM_NAME).toBe('Alice CRM');
  });
});
