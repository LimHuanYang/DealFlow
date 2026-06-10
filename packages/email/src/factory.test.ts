import { describe, expect, it } from 'vitest';
import { buildEmailProvider, isEmailEnabled, describeEmail } from './factory.js';
import { NoopEmailProvider } from './providers/noop.js';
import { EngineMailerEmailProvider } from './providers/engine-mailer.js';

const EM = { apiKey: 'k', fromEmail: 'crm@acme.com', fromName: 'Acme' };

describe('buildEmailProvider — EngineMailer (preferred)', () => {
  it('returns EngineMailerEmailProvider when configured', () => {
    expect(buildEmailProvider({ engineMailer: EM })).toBeInstanceOf(EngineMailerEmailProvider);
  });

  it('isEmailEnabled true when EngineMailer has all fields, false when partial', () => {
    expect(isEmailEnabled({ engineMailer: EM })).toBe(true);
    expect(isEmailEnabled({ engineMailer: { apiKey: 'k' } })).toBe(false);
  });

  it('describeEmail reports engine-mailer + fromAddress', () => {
    expect(describeEmail({ engineMailer: EM })).toEqual({
      provider: 'engine-mailer',
      fromAddress: 'crm@acme.com',
    });
  });
});

describe('buildEmailProvider', () => {
  it('returns NoopEmailProvider when no config', () => {
    expect(buildEmailProvider({})).toBeInstanceOf(NoopEmailProvider);
  });
});

describe('isEmailEnabled', () => {
  it('false when nothing configured', () => {
    expect(isEmailEnabled({})).toBe(false);
  });
});

describe('describeEmail', () => {
  it('returns none + null when nothing configured', () => {
    expect(describeEmail({})).toEqual({ provider: 'none', fromAddress: null });
  });
});
