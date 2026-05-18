/**
 * Full ISO 4217 active currency catalog (165 codes).
 *
 * We only maintain the code list here. Human labels are looked up at module
 * load via `Intl.DisplayNames('en', { type: 'currency' })` — this way locale
 * data comes from the platform (browser / Node ICU tables) and we don't
 * hand-curate ~165 names that go stale. If `Intl.DisplayNames` is unavailable
 * (very old runtimes), the label degrades to the bare code.
 *
 * The shape (`{ code, label }`) is shared verbatim between web (select
 * options) and api (server-side validation via `isSupportedCurrency`).
 */
const ALL_CURRENCY_CODES = [
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ANG',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BRL',
  'BSD',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHF',
  'CLP',
  'CNY',
  'COP',
  'CRC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLE',
  'SOS',
  'SRD',
  'SSP',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'UYU',
  'UZS',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAF',
  'XCD',
  'XOF',
  'XPF',
  'YER',
  'ZAR',
  'ZMW',
  'ZWL',
] as const;

export type CurrencyCode = (typeof ALL_CURRENCY_CODES)[number];

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

const intlCurrencyNames =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames('en', { type: 'currency' })
    : null;

function labelFor(code: CurrencyCode): string {
  if (intlCurrencyNames) {
    try {
      const name = intlCurrencyNames.of(code);
      if (name && name !== code) return `${name} (${code})`;
    } catch {
      // Intl.DisplayNames throws on malformed input; codes here are all valid
      // ISO 4217 so this branch only fires on a runtime that lacks the data.
    }
  }
  return code;
}

export const CURRENCY_OPTIONS: ReadonlyArray<{ code: CurrencyCode; label: string }> =
  ALL_CURRENCY_CODES.map((code) => ({ code, label: labelFor(code) })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

const CURRENCY_CODE_SET: ReadonlySet<string> = new Set(ALL_CURRENCY_CODES);

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return CURRENCY_CODE_SET.has(code);
}

/**
 * Maps an ISO 3166-1 alpha-2 region code to the local CRM currency. Returns
 * `null` for unknown regions so callers can decide their own fallback (signup
 * falls back to `DEFAULT_CURRENCY`). Eurozone members all map to EUR.
 *
 * Only the major-market regions are mapped — uncovered regions fall back to
 * USD at signup, and users can change it in Settings. Add a region here when
 * a user reports their signup currency was wrong.
 */
const REGION_TO_CURRENCY: ReadonlyMap<string, CurrencyCode> = new Map([
  // Americas
  ['US', 'USD'],
  ['CA', 'CAD'],
  ['MX', 'MXN'],
  ['BR', 'BRL'],
  ['AR', 'ARS'],
  // Eurozone
  ['DE', 'EUR'],
  ['FR', 'EUR'],
  ['ES', 'EUR'],
  ['IT', 'EUR'],
  ['NL', 'EUR'],
  ['BE', 'EUR'],
  ['AT', 'EUR'],
  ['IE', 'EUR'],
  ['PT', 'EUR'],
  ['FI', 'EUR'],
  ['GR', 'EUR'],
  ['LU', 'EUR'],
  ['SK', 'EUR'],
  ['SI', 'EUR'],
  ['EE', 'EUR'],
  ['LV', 'EUR'],
  ['LT', 'EUR'],
  ['CY', 'EUR'],
  ['MT', 'EUR'],
  ['HR', 'EUR'],
  // UK + non-Euro EU
  ['GB', 'GBP'],
  ['CH', 'CHF'],
  ['SE', 'SEK'],
  ['NO', 'NOK'],
  ['DK', 'DKK'],
  ['PL', 'PLN'],
  ['CZ', 'CZK'],
  ['HU', 'HUF'],
  // Asia / Pacific
  ['JP', 'JPY'],
  ['CN', 'CNY'],
  ['IN', 'INR'],
  ['SG', 'SGD'],
  ['HK', 'HKD'],
  ['TW', 'TWD'],
  ['KR', 'KRW'],
  ['MY', 'MYR'],
  ['TH', 'THB'],
  ['ID', 'IDR'],
  ['PH', 'PHP'],
  ['VN', 'VND'],
  ['AU', 'AUD'],
  ['NZ', 'NZD'],
  // Middle East / Africa
  ['AE', 'AED'],
  ['SA', 'SAR'],
  ['IL', 'ILS'],
  ['TR', 'TRY'],
  ['ZA', 'ZAR'],
  // Russia
  ['RU', 'RUB'],
]);

export function regionToCurrency(region: string): CurrencyCode | null {
  if (!region) return null;
  return REGION_TO_CURRENCY.get(region.toUpperCase()) ?? null;
}
