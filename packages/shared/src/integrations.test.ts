import { describe, expect, it } from 'vitest';
import {
  updateIntegrationsBodySchema,
  testAIBodySchema,
} from './integrations.js';

describe('updateIntegrationsBodySchema', () => {
  it('accepts empty patch (no-op)', () => {
    expect(updateIntegrationsBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts setting just an Anthropic key', () => {
    expect(
      updateIntegrationsBodySchema.safeParse({
        anthropic: { apiKey: 'sk-ant-test', model: 'claude-haiku-4-5' },
      }).success,
    ).toBe(true);
  });

  it('accepts clearing Anthropic via null', () => {
    expect(
      updateIntegrationsBodySchema.safeParse({ anthropic: null }).success,
    ).toBe(true);
  });

  it('accepts a full SMTP config', () => {
    expect(
      updateIntegrationsBodySchema.safeParse({
        smtp: {
          host: 'smtp.gmail.com',
          port: 587,
          user: 'a@b.com',
          pass: 'pw',
          fromEmail: 'a@b.com',
          fromName: 'A',
        },
      }).success,
    ).toBe(true);
  });

  it('accepts clearing SMTP via null', () => {
    expect(updateIntegrationsBodySchema.safeParse({ smtp: null }).success).toBe(true);
  });

  it('rejects bad port (out of range)', () => {
    expect(
      updateIntegrationsBodySchema.safeParse({
        smtp: {
          host: 'h',
          port: 70000,
          user: 'u',
          pass: 'p',
          fromEmail: 'a@b.com',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects invalid fromEmail', () => {
    expect(
      updateIntegrationsBodySchema.safeParse({
        smtp: {
          host: 'h',
          port: 587,
          user: 'u',
          pass: 'p',
          fromEmail: 'not-an-email',
        },
      }).success,
    ).toBe(false);
  });
});

describe('testAIBodySchema', () => {
  it('accepts a known provider', () => {
    expect(testAIBodySchema.safeParse({ provider: 'anthropic' }).success).toBe(true);
    expect(testAIBodySchema.safeParse({ provider: 'gemini' }).success).toBe(true);
    expect(testAIBodySchema.safeParse({ provider: 'grok' }).success).toBe(true);
  });

  it('rejects an unknown provider', () => {
    expect(testAIBodySchema.safeParse({ provider: 'openai' }).success).toBe(false);
  });
});
