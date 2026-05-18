/**
 * Curated ISO 4217 currencies supported by the Settings dropdown.
 *
 * Why curated, not "all 180": a scannable list beats a complete one. Add a
 * code here when a user requests it. The shape (code + human label) is shared
 * verbatim between web (select options) and api (server-side validation).
 */
export const CURRENCY_OPTIONS = [
  { code: 'USD', label: 'US Dollar (USD)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'GBP', label: 'British Pound (GBP)' },
  { code: 'JPY', label: 'Japanese Yen (JPY)' },
  { code: 'CNY', label: 'Chinese Yuan (CNY)' },
  { code: 'CAD', label: 'Canadian Dollar (CAD)' },
  { code: 'AUD', label: 'Australian Dollar (AUD)' },
  { code: 'NZD', label: 'New Zealand Dollar (NZD)' },
  { code: 'CHF', label: 'Swiss Franc (CHF)' },
  { code: 'SEK', label: 'Swedish Krona (SEK)' },
  { code: 'NOK', label: 'Norwegian Krone (NOK)' },
  { code: 'DKK', label: 'Danish Krone (DKK)' },
  { code: 'PLN', label: 'Polish Złoty (PLN)' },
  { code: 'CZK', label: 'Czech Koruna (CZK)' },
  { code: 'HUF', label: 'Hungarian Forint (HUF)' },
  { code: 'INR', label: 'Indian Rupee (INR)' },
  { code: 'SGD', label: 'Singapore Dollar (SGD)' },
  { code: 'HKD', label: 'Hong Kong Dollar (HKD)' },
  { code: 'TWD', label: 'Taiwan Dollar (TWD)' },
  { code: 'KRW', label: 'South Korean Won (KRW)' },
  { code: 'MYR', label: 'Malaysian Ringgit (MYR)' },
  { code: 'THB', label: 'Thai Baht (THB)' },
  { code: 'IDR', label: 'Indonesian Rupiah (IDR)' },
  { code: 'PHP', label: 'Philippine Peso (PHP)' },
  { code: 'VND', label: 'Vietnamese Dong (VND)' },
  { code: 'MXN', label: 'Mexican Peso (MXN)' },
  { code: 'BRL', label: 'Brazilian Real (BRL)' },
  { code: 'ARS', label: 'Argentine Peso (ARS)' },
  { code: 'ZAR', label: 'South African Rand (ZAR)' },
  { code: 'AED', label: 'UAE Dirham (AED)' },
  { code: 'SAR', label: 'Saudi Riyal (SAR)' },
  { code: 'ILS', label: 'Israeli Shekel (ILS)' },
  { code: 'TRY', label: 'Turkish Lira (TRY)' },
  { code: 'RUB', label: 'Russian Ruble (RUB)' },
] as const;

export type CurrencyCode = (typeof CURRENCY_OPTIONS)[number]['code'];

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

const CURRENCY_CODE_SET: ReadonlySet<string> = new Set(CURRENCY_OPTIONS.map((c) => c.code));

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return CURRENCY_CODE_SET.has(code);
}

/**
 * Maps an ISO 3166-1 alpha-2 region code to the local CRM currency. Returns
 * `null` for unknown regions so callers can decide their own fallback (signup
 * falls back to `DEFAULT_CURRENCY`). Eurozone members all map to EUR.
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
