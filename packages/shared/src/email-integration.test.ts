import { describe, it, expect } from 'vitest';
import { engineMailerConfigSchema } from './email-integration.js';

describe('engineMailerConfigSchema', () => {
  it('accepts a full config', () => {
    const r = engineMailerConfigSchema.parse({
      apiKey: 'k',
      fromName: 'Acme Sales',
      fromEmail: 'crm@acme.com',
    });
    expect(r.fromEmail).toBe('crm@acme.com');
    expect(r.fromName).toBe('Acme Sales');
  });

  it('allows omitting apiKey on update (unchanged-when-blank)', () => {
    const r = engineMailerConfigSchema.safeParse({ fromName: 'Acme', fromEmail: 'crm@acme.com' });
    expect(r.success).toBe(true);
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
});
