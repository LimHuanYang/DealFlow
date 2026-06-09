import { describe, expect, it } from 'vitest';
import { buildEmailProvider, isEmailEnabled, describeEmail } from './factory.js';
import { NoopEmailProvider } from './providers/noop.js';
import { SmtpEmailProvider } from './providers/smtp.js';
import { EngineMailerEmailProvider } from './providers/engine-mailer.js';

const EM = { apiKey: 'k', fromEmail: 'crm@acme.com', fromName: 'Acme' };

describe('buildEmailProvider — EngineMailer (preferred)', () => {
  it('returns EngineMailerEmailProvider when configured', () => {
    expect(buildEmailProvider({ engineMailer: EM })).toBeInstanceOf(EngineMailerEmailProvider);
  });

  it('prefers EngineMailer over SMTP when both are set', () => {
    expect(
      buildEmailProvider({
        engineMailer: EM,
        smtp: { host: 'h', user: 'u', pass: 'p', fromEmail: 'f@x.com' },
      }),
    ).toBeInstanceOf(EngineMailerEmailProvider);
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

  it('returns NoopEmailProvider when SMTP host present but user/pass missing', () => {
    expect(
      buildEmailProvider({ smtp: { host: 'smtp.gmail.com', fromEmail: 'a@b' } }),
    ).toBeInstanceOf(NoopEmailProvider);
  });

  it('returns SmtpEmailProvider when all required SMTP fields are set', () => {
    expect(
      buildEmailProvider({
        smtp: {
          host: 'smtp.gmail.com',
          port: 587,
          user: 'alice@gmail.com',
          pass: 'app-pw',
          fromEmail: 'alice@gmail.com',
        },
      }),
    ).toBeInstanceOf(SmtpEmailProvider);
  });
});

describe('isEmailEnabled', () => {
  it('true iff SMTP has all required fields', () => {
    expect(isEmailEnabled({})).toBe(false);
    expect(
      isEmailEnabled({
        smtp: { host: 'h', user: 'u', pass: 'p', fromEmail: 'f@x.com' },
      }),
    ).toBe(true);
    expect(isEmailEnabled({ smtp: { host: 'h' } })).toBe(false);
  });
});

describe('describeEmail', () => {
  it('returns smtp + fromAddress when configured', () => {
    expect(
      describeEmail({
        smtp: {
          host: 'smtp.gmail.com',
          user: 'alice@gmail.com',
          pass: 'pw',
          fromEmail: 'alice@gmail.com',
        },
      }),
    ).toEqual({ provider: 'smtp', fromAddress: 'alice@gmail.com' });
  });

  it('returns none + null when nothing configured', () => {
    expect(describeEmail({})).toEqual({ provider: 'none', fromAddress: null });
  });
});
