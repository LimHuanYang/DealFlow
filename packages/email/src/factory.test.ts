import { describe, expect, it } from 'vitest';
import { buildEmailProvider, isEmailEnabled, describeEmail } from './factory.js';
import { NoopEmailProvider } from './providers/noop.js';
import { ResendEmailProvider } from './providers/resend.js';
import { SmtpEmailProvider } from './providers/smtp.js';

describe('buildEmailProvider — Resend path', () => {
  it('returns NoopEmailProvider when no provider configured', () => {
    expect(buildEmailProvider({})).toBeInstanceOf(NoopEmailProvider);
  });

  it('returns NoopEmailProvider when Resend has key but no from', () => {
    expect(
      buildEmailProvider({ resend: { apiKey: 'k' } }),
    ).toBeInstanceOf(NoopEmailProvider);
  });

  it('returns ResendEmailProvider when both apiKey + from set', () => {
    expect(
      buildEmailProvider({ resend: { apiKey: 'k', from: 'x@y' } }),
    ).toBeInstanceOf(ResendEmailProvider);
  });
});

describe('buildEmailProvider — SMTP path', () => {
  it('returns SmtpEmailProvider when all required SMTP fields are set', () => {
    expect(
      buildEmailProvider({
        smtp: {
          host: 'smtp.gmail.com',
          port: 587,
          user: 'alice@gmail.com',
          pass: 'app-pw',
          from: 'alice@gmail.com',
        },
      }),
    ).toBeInstanceOf(SmtpEmailProvider);
  });

  it('returns NoopEmailProvider when SMTP host present but user/pass missing', () => {
    expect(
      buildEmailProvider({ smtp: { host: 'smtp.gmail.com', from: 'a@b' } }),
    ).toBeInstanceOf(NoopEmailProvider);
  });
});

describe('buildEmailProvider — preference order', () => {
  it('prefers Resend over SMTP when both are configured', () => {
    expect(
      buildEmailProvider({
        resend: { apiKey: 'k', from: 'r@y' },
        smtp: {
          host: 'smtp.gmail.com',
          port: 587,
          user: 's@y',
          pass: 'pw',
          from: 's@y',
        },
      }),
    ).toBeInstanceOf(ResendEmailProvider);
  });
});

describe('isEmailEnabled', () => {
  it('true iff at least one provider has the minimum config', () => {
    expect(isEmailEnabled({})).toBe(false);
    expect(isEmailEnabled({ resend: { apiKey: 'k', from: 'x@y' } })).toBe(true);
    expect(
      isEmailEnabled({
        smtp: { host: 'h', user: 'u', pass: 'p', from: 'f@x' },
      }),
    ).toBe(true);
    expect(isEmailEnabled({ resend: { apiKey: 'k' } })).toBe(false);
    expect(isEmailEnabled({ smtp: { host: 'h' } })).toBe(false);
  });
});

describe('describeEmail', () => {
  it('returns resend + from when Resend is configured', () => {
    expect(
      describeEmail({ resend: { apiKey: 'k', from: 'x@y', name: 'X' } }),
    ).toEqual({ provider: 'resend', from: 'X <x@y>' });
  });

  it('returns smtp + from when only SMTP is configured', () => {
    expect(
      describeEmail({
        smtp: {
          host: 'smtp.gmail.com',
          user: 'alice@gmail.com',
          pass: 'pw',
          from: 'alice@gmail.com',
          name: 'Alice',
        },
      }),
    ).toEqual({ provider: 'smtp', from: 'Alice <alice@gmail.com>' });
  });

  it('returns none + null when nothing configured', () => {
    expect(describeEmail({})).toEqual({ provider: 'none', from: null });
  });

  it('prefers resend over smtp in the description', () => {
    expect(
      describeEmail({
        resend: { apiKey: 'k', from: 'r@y', name: 'R' },
        smtp: { host: 'h', user: 'u', pass: 'p', from: 's@y' },
      }),
    ).toEqual({ provider: 'resend', from: 'R <r@y>' });
  });
});
