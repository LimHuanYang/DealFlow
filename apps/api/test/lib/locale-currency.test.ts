import { describe, expect, it } from 'vitest';
import { pickCurrencyFromAcceptLanguage } from '../../src/lib/locale-currency.js';

describe('pickCurrencyFromAcceptLanguage', () => {
  it('returns USD when header is null or empty', () => {
    expect(pickCurrencyFromAcceptLanguage(null)).toBe('USD');
    expect(pickCurrencyFromAcceptLanguage(undefined)).toBe('USD');
    expect(pickCurrencyFromAcceptLanguage('')).toBe('USD');
    expect(pickCurrencyFromAcceptLanguage('   ')).toBe('USD');
  });

  it('parses simple region tags', () => {
    expect(pickCurrencyFromAcceptLanguage('en-US')).toBe('USD');
    expect(pickCurrencyFromAcceptLanguage('en-GB')).toBe('GBP');
    expect(pickCurrencyFromAcceptLanguage('ms-MY')).toBe('MYR');
    expect(pickCurrencyFromAcceptLanguage('ja-JP')).toBe('JPY');
    expect(pickCurrencyFromAcceptLanguage('de-DE')).toBe('EUR');
  });

  it('uses the first listed locale, ignoring q-weights', () => {
    expect(pickCurrencyFromAcceptLanguage('en-US,en;q=0.9,fr;q=0.8')).toBe('USD');
    expect(pickCurrencyFromAcceptLanguage('ms-MY,en-US;q=0.5')).toBe('MYR');
  });

  it('falls back to USD for language-only tags (no region)', () => {
    // "en" alone is ambiguous (US? UK? AU?) — pick the safe default.
    expect(pickCurrencyFromAcceptLanguage('en')).toBe('USD');
    expect(pickCurrencyFromAcceptLanguage('fr;q=0.9')).toBe('USD');
  });

  it('falls back to USD for unknown regions', () => {
    expect(pickCurrencyFromAcceptLanguage('xx-ZZ')).toBe('USD');
  });

  it('handles whitespace around tokens', () => {
    expect(pickCurrencyFromAcceptLanguage('  en-US  ,  fr  ')).toBe('USD');
  });

  it('is case-insensitive on the region subtag', () => {
    expect(pickCurrencyFromAcceptLanguage('en-us')).toBe('USD');
    expect(pickCurrencyFromAcceptLanguage('MS-my')).toBe('MYR');
  });

  it('extracts region from BCP 47 script-subtagged tags', () => {
    // Traditional Chinese in Taiwan — Safari/Chrome send this for users
    // with the OS configured for Traditional Chinese.
    expect(pickCurrencyFromAcceptLanguage('zh-Hant-TW')).toBe('TWD');
    // Simplified Chinese in mainland China.
    expect(pickCurrencyFromAcceptLanguage('zh-Hans-CN')).toBe('CNY');
    // Serbian Latin script in Serbia (no region in our map → USD fallback).
    expect(pickCurrencyFromAcceptLanguage('sr-Latn-RS')).toBe('USD');
  });

  it('handles BCP 47 variant subtags after region (de-CH-1996)', () => {
    // Swiss German with the 1996 orthography variant — region "CH" comes
    // before the variant subtag, so CHF wins.
    expect(pickCurrencyFromAcceptLanguage('de-CH-1996')).toBe('CHF');
  });

  it('returns USD when no subtag is a 2-letter region (zh-Hant alone)', () => {
    // Script only, no region — fall back to USD per the documented heuristic.
    expect(pickCurrencyFromAcceptLanguage('zh-Hant')).toBe('USD');
  });
});
