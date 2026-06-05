import { describe, expect, it } from 'vitest';
import { createContactBodySchema, updateContactBodySchema } from './contacts.js';

const UUID = '11111111-1111-1111-1111-111111111111';

describe('createContactBodySchema', () => {
  it('accepts a minimal contact and an optional companyId', () => {
    expect(createContactBodySchema.safeParse({ firstName: 'Ada' }).success).toBe(true);
    expect(createContactBodySchema.safeParse({ firstName: 'Ada', companyId: UUID }).success).toBe(
      true,
    );
  });

  it('rejects a non-uuid companyId', () => {
    expect(createContactBodySchema.safeParse({ firstName: 'Ada', companyId: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('updateContactBodySchema', () => {
  it('accepts setting companyId to a uuid', () => {
    expect(updateContactBodySchema.safeParse({ companyId: UUID }).success).toBe(true);
  });

  it('accepts clearing companyId with null (unassign)', () => {
    // Clearing the link must be expressible — the UI sends null for "No company".
    expect(updateContactBodySchema.safeParse({ companyId: null }).success).toBe(true);
  });

  it('rejects a non-uuid companyId', () => {
    expect(updateContactBodySchema.safeParse({ companyId: 'nope' }).success).toBe(false);
  });
});
