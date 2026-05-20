import { describe, expect, it } from 'vitest';
import { buildEmailProvider, isEmailEnabled, describeEmail } from './factory.js';
import { NoopEmailProvider } from './providers/noop.js';
import { ResendEmailProvider } from './providers/resend.js';

describe('buildEmailProvider', () => {
  it('returns NoopEmailProvider when no apiKey is set', () => {
    const p = buildEmailProvider({ from: 'x@y' });
    expect(p).toBeInstanceOf(NoopEmailProvider);
  });

  it('returns ResendEmailProvider when apiKey is set', () => {
    const p = buildEmailProvider({ apiKey: 're_test', from: 'x@y' });
    expect(p).toBeInstanceOf(ResendEmailProvider);
  });
});

describe('isEmailEnabled', () => {
  it('true iff apiKey + from are both set', () => {
    expect(isEmailEnabled({ apiKey: 'k', from: 'x@y' })).toBe(true);
    expect(isEmailEnabled({ apiKey: 'k' })).toBe(false);
    expect(isEmailEnabled({ from: 'x@y' })).toBe(false);
    expect(isEmailEnabled({})).toBe(false);
  });
});

describe('describeEmail', () => {
  it('returns provider+from when enabled', () => {
    expect(describeEmail({ apiKey: 'k', from: 'x@y', name: 'X' })).toEqual({
      provider: 'resend',
      from: 'X <x@y>',
    });
  });

  it('returns provider:none + null when disabled', () => {
    expect(describeEmail({})).toEqual({ provider: 'none', from: null });
  });
});
