import { describe, it, expect } from 'vitest';
import { engineMailerConfigSchema } from './email-integration.js';

describe('engineMailerConfigSchema', () => {
  it('accepts a sender identity (fromName + fromEmail)', () => {
    const r = engineMailerConfigSchema.parse({ fromName: 'Acme Sales', fromEmail: 'crm@acme.com' });
    expect(r.fromEmail).toBe('crm@acme.com');
    expect(r.fromName).toBe('Acme Sales');
  });

  it('rejects an invalid fromEmail', () => {
    expect(
      engineMailerConfigSchema.safeParse({ fromName: 'Acme', fromEmail: 'not-an-email' }).success,
    ).toBe(false);
  });

  it('rejects an empty fromName', () => {
    expect(
      engineMailerConfigSchema.safeParse({ fromName: '', fromEmail: 'crm@acme.com' }).success,
    ).toBe(false);
  });

  it('does not accept an apiKey (the API key is app-wide, not per-org)', () => {
    const r = engineMailerConfigSchema.parse({
      fromName: 'Acme',
      fromEmail: 'crm@acme.com',
      apiKey: 'should-be-stripped',
    } as Record<string, unknown>);
    expect('apiKey' in r).toBe(false);
  });
});
