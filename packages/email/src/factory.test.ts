import { describe, expect, it } from 'vitest';
import { buildEmailProvider, isEmailEnabled, describeEmail } from './factory.js';
import { NoopEmailProvider } from './providers/noop.js';
import { SmtpEmailProvider } from './providers/smtp.js';

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
