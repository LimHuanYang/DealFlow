import { describe, expect, it } from 'vitest';
import {
  customFieldDefinitionSchema,
  customFieldEntityTypeSchema,
  customFieldTypeSchema,
  validateCustomFieldValue,
} from './custom-fields.js';

describe('customFieldEntityTypeSchema', () => {
  it.each(['contact', 'company', 'deal', 'note', 'task'])('accepts %s', (v) => {
    expect(() => customFieldEntityTypeSchema.parse(v)).not.toThrow();
  });
  it('rejects activity (split into note/task)', () => {
    expect(() => customFieldEntityTypeSchema.parse('activity')).toThrow();
  });
});

describe('customFieldTypeSchema', () => {
  const TYPES = ['text','long_text','number','date','boolean','select','multi_select','url','email','phone'];
  it.each(TYPES)('accepts %s', (t) => {
    expect(() => customFieldTypeSchema.parse(t)).not.toThrow();
  });
  it('rejects unknown type', () => {
    expect(() => customFieldTypeSchema.parse('file')).toThrow();
  });
});

describe('customFieldDefinitionSchema', () => {
  const base = {
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: '22222222-2222-2222-2222-222222222222',
    entityType: 'contact' as const,
    name: 'Lead Source',
    type: 'select' as const,
    options: { values: [{ key: 'referral', label: 'Referral' }] },
    required: false,
    position: 0,
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
  };
  it('accepts a select with options', () => {
    expect(() => customFieldDefinitionSchema.parse(base)).not.toThrow();
  });
  it('accepts text with no options', () => {
    expect(() =>
      customFieldDefinitionSchema.parse({ ...base, type: 'text', options: null }),
    ).not.toThrow();
  });
});

describe('validateCustomFieldValue', () => {
  const textDef = { type: 'text', options: null } as const;
  it('accepts a short string for text', () => {
    expect(validateCustomFieldValue(textDef, 'hello').ok).toBe(true);
  });
  it('rejects text > 500 chars', () => {
    const long = 'x'.repeat(501);
    expect(validateCustomFieldValue(textDef, long).ok).toBe(false);
  });
  it('rejects wrong type (number when text expected)', () => {
    expect(validateCustomFieldValue(textDef, 42).ok).toBe(false);
  });

  it('accepts a finite number', () => {
    expect(validateCustomFieldValue({ type: 'number', options: null }, 42.5).ok).toBe(true);
  });
  it('rejects NaN / Infinity for number', () => {
    expect(validateCustomFieldValue({ type: 'number', options: null }, NaN).ok).toBe(false);
    expect(validateCustomFieldValue({ type: 'number', options: null }, Infinity).ok).toBe(false);
  });

  it('accepts YYYY-MM-DD for date', () => {
    expect(validateCustomFieldValue({ type: 'date', options: null }, '2026-05-22').ok).toBe(true);
  });
  it('rejects bad date format', () => {
    expect(validateCustomFieldValue({ type: 'date', options: null }, '22-05-2026').ok).toBe(false);
  });

  it('accepts a valid option key for select', () => {
    const def = { type: 'select', options: { values: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] } } as const;
    expect(validateCustomFieldValue(def, 'a').ok).toBe(true);
  });
  it('rejects unknown option key for select', () => {
    const def = { type: 'select', options: { values: [{ key: 'a', label: 'A' }] } } as const;
    expect(validateCustomFieldValue(def, 'c').ok).toBe(false);
  });

  it('accepts array of valid option keys for multi_select', () => {
    const def = { type: 'multi_select', options: { values: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] } } as const;
    expect(validateCustomFieldValue(def, ['a', 'b']).ok).toBe(true);
  });
  it('rejects multi_select with unknown key', () => {
    const def = { type: 'multi_select', options: { values: [{ key: 'a', label: 'A' }] } } as const;
    expect(validateCustomFieldValue(def, ['a', 'z']).ok).toBe(false);
  });

  it('accepts email format', () => {
    expect(validateCustomFieldValue({ type: 'email', options: null }, 'a@b.com').ok).toBe(true);
  });
  it('rejects bad email', () => {
    expect(validateCustomFieldValue({ type: 'email', options: null }, 'a@b,com').ok).toBe(false);
  });

  it('null is always accepted (cleared field)', () => {
    expect(validateCustomFieldValue(textDef, null).ok).toBe(true);
    expect(validateCustomFieldValue({ type: 'number', options: null }, null).ok).toBe(true);
  });
});
