import { describe, expect, it } from 'vitest';
import {
  CURRENCY_OPTIONS,
  isSupportedCurrency,
  regionToCurrency,
  DEFAULT_CURRENCY,
} from './currency.js';

describe('CURRENCY_OPTIONS', () => {
  it('includes USD, EUR, GBP, JPY, MYR', () => {
    const codes = CURRENCY_OPTIONS.map((c) => c.code);
    expect(codes).toContain('USD');
    expect(codes).toContain('EUR');
    expect(codes).toContain('GBP');
    expect(codes).toContain('JPY');
    expect(codes).toContain('MYR');
  });

  it('every option has a 3-letter ISO 4217 code and a non-empty label', () => {
    for (const opt of CURRENCY_OPTIONS) {
      expect(opt.code).toMatch(/^[A-Z]{3}$/);
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  it('codes are unique', () => {
    const codes = CURRENCY_OPTIONS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('isSupportedCurrency', () => {
  it('returns true for catalog codes', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('MYR')).toBe(true);
  });

  it('returns false for codes not in the catalog', () => {
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(isSupportedCurrency('')).toBe(false);
    expect(isSupportedCurrency('usd')).toBe(false); // case-sensitive
  });
});

describe('regionToCurrency', () => {
  it('maps common regions to expected currencies', () => {
    expect(regionToCurrency('US')).toBe('USD');
    expect(regionToCurrency('GB')).toBe('GBP');
    expect(regionToCurrency('DE')).toBe('EUR');
    expect(regionToCurrency('FR')).toBe('EUR');
    expect(regionToCurrency('JP')).toBe('JPY');
    expect(regionToCurrency('MY')).toBe('MYR');
    expect(regionToCurrency('AU')).toBe('AUD');
    expect(regionToCurrency('CA')).toBe('CAD');
  });

  it('is case-insensitive on the region tag', () => {
    expect(regionToCurrency('us')).toBe('USD');
    expect(regionToCurrency('Gb')).toBe('GBP');
  });

  it('returns null for unknown regions', () => {
    expect(regionToCurrency('ZZ')).toBeNull();
    expect(regionToCurrency('')).toBeNull();
  });
});

describe('DEFAULT_CURRENCY', () => {
  it('is USD', () => {
    expect(DEFAULT_CURRENCY).toBe('USD');
  });
});
