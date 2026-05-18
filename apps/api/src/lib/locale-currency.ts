import { regionToCurrency, DEFAULT_CURRENCY, type CurrencyCode } from '@dealflow/shared';

/**
 * Picks a sensible initial currency for a newly created org based on the
 * client's `Accept-Language` request header. Only the FIRST listed language
 * tag is considered (browsers send the user's top preference first; q-weights
 * exist but we don't need to interpret them for this heuristic).
 *
 * Falls back to USD when:
 *   - the header is missing/empty
 *   - the first tag has no region subtag (e.g. plain "en")
 *   - the region is unknown to our region→currency map
 *
 * Users can change the value later in Settings, so getting it wrong is a
 * minor papercut rather than data loss.
 */
export function pickCurrencyFromAcceptLanguage(header: string | null | undefined): CurrencyCode {
  if (!header) return DEFAULT_CURRENCY;
  const trimmed = header.trim();
  if (!trimmed) return DEFAULT_CURRENCY;

  // Split into comma-separated tags, take the first one before any q-weight.
  const firstTag = trimmed.split(',')[0]?.trim();
  if (!firstTag) return DEFAULT_CURRENCY;

  // Strip any `;q=...` suffix from the first tag.
  const tag = firstTag.split(';')[0]?.trim();
  if (!tag) return DEFAULT_CURRENCY;

  // Region subtag per BCP 47. The first subtag is the language; we scan the
  // rest for the first 2-letter ASCII subtag, which is the region under
  // ISO 3166-1 alpha-2. This handles both the common case (`en-US`) and
  // script-subtagged tags real browsers send (`zh-Hant-TW`, `zh-Hans-CN`,
  // `sr-Latn-RS`) — in those, `parts[1]` is the script (4 letters), not the
  // region. Variants like `de-CH-1996` still resolve correctly since `CH` is
  // the first 2-letter subtag we find.
  const parts = tag.split('-');
  if (parts.length < 2) return DEFAULT_CURRENCY;

  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
  if (!region) return DEFAULT_CURRENCY;

  return regionToCurrency(region) ?? DEFAULT_CURRENCY;
}
