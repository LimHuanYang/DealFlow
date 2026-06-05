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

  it('treats blank optional fields as absent (form sends "" for empty inputs)', () => {
    const r = createContactBodySchema.safeParse({
      firstName: 'Ada',
      lastName: '',
      email: '',
      phone: '',
      title: '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lastName).toBeUndefined();
      expect(r.data.email).toBeUndefined();
      expect(r.data.phone).toBeUndefined();
      expect(r.data.title).toBeUndefined();
    }
  });

  it('still rejects a malformed (non-blank) email', () => {
    expect(
      createContactBodySchema.safeParse({ firstName: 'Ada', email: 'not-an-email' }).success,
    ).toBe(false);
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
