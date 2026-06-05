import { z } from 'zod';

/**
 * Form text inputs submit "" (empty string) for blank optional fields, which
 * would otherwise fail `.min(1)`/`.email()`/`.url()` and silently block form
 * submission. Wrap an optional string schema so a blank/whitespace-only value
 * is treated as "not provided" (undefined) before validation.
 */
export const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);
