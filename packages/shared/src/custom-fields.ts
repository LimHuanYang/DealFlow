import { z } from 'zod';

export const CUSTOM_FIELD_ENTITY_TYPES = ['contact', 'company', 'deal', 'note', 'task'] as const;
export const customFieldEntityTypeSchema = z.enum(CUSTOM_FIELD_ENTITY_TYPES);
export type CustomFieldEntityType = z.infer<typeof customFieldEntityTypeSchema>;

export const CUSTOM_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  'url',
  'email',
  'phone',
] as const;
export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const customFieldOptionSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
});
export const customFieldOptionsSchema = z.object({
  values: z.array(customFieldOptionSchema).min(1),
});

export const customFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entityType: customFieldEntityTypeSchema,
  name: z.string().min(1).max(50),
  type: customFieldTypeSchema,
  options: customFieldOptionsSchema.nullable(),
  required: z.boolean(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export const createCustomFieldBodySchema = z.object({
  entityType: customFieldEntityTypeSchema,
  name: z.string().min(1).max(50),
  type: customFieldTypeSchema,
  options: customFieldOptionsSchema.nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldBodySchema>;

export const updateCustomFieldBodySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  options: customFieldOptionsSchema.nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldBodySchema>;

const URL_RE = /^https?:\/\/[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.,]{2,}$/;
const PHONE_RE = /^[+0-9 ()\-.]{6,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Per-type value validator. Returns `{ ok: true }` or `{ ok: false, error }`.
 * `null` is always accepted (represents "clear field"). Used both server-side
 * (in custom-fields-merge.ts) and client-side (inline form feedback).
 */
export function validateCustomFieldValue(
  def: {
    type: CustomFieldType;
    options: { values: ReadonlyArray<{ key: string; label: string }> } | null;
  },
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true };

  switch (def.type) {
    case 'text':
      if (typeof value !== 'string') return { ok: false, error: 'expected string' };
      if (value.length > 500) return { ok: false, error: 'max 500 characters' };
      return { ok: true };
    case 'long_text':
      if (typeof value !== 'string') return { ok: false, error: 'expected string' };
      if (value.length > 5000) return { ok: false, error: 'max 5000 characters' };
      return { ok: true };
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value))
        return { ok: false, error: 'expected finite number' };
      return { ok: true };
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value))
        return { ok: false, error: 'expected YYYY-MM-DD' };
      return { ok: true };
    case 'boolean':
      if (typeof value !== 'boolean') return { ok: false, error: 'expected boolean' };
      return { ok: true };
    case 'select': {
      if (typeof value !== 'string') return { ok: false, error: 'expected string' };
      const keys = def.options?.values.map((o) => o.key) ?? [];
      if (!keys.includes(value)) return { ok: false, error: 'not a valid option' };
      return { ok: true };
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return { ok: false, error: 'expected array' };
      const keys = def.options?.values.map((o) => o.key) ?? [];
      for (const v of value) {
        if (typeof v !== 'string' || !keys.includes(v))
          return { ok: false, error: 'one or more values are not valid options' };
      }
      return { ok: true };
    }
    case 'url':
      if (typeof value !== 'string' || !URL_RE.test(value))
        return { ok: false, error: 'expected http(s) URL' };
      return { ok: true };
    case 'email':
      if (typeof value !== 'string' || !EMAIL_RE.test(value))
        return { ok: false, error: 'expected an email address' };
      return { ok: true };
    case 'phone':
      if (typeof value !== 'string' || !PHONE_RE.test(value))
        return { ok: false, error: 'expected a phone number' };
      return { ok: true };
    default: {
      const _exhaustive: never = def.type;
      return { ok: false, error: `unknown type: ${_exhaustive}` };
    }
  }
}
