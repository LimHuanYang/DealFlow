import { describe, expect, it } from 'vitest';
import { summarizeActivityBodySchema, extractContactBodySchema } from './ai.js';

const UUID = '00000000-0000-0000-0000-000000000001';

describe('summarizeActivityBodySchema', () => {
  it('accepts exactly one parent id', () => {
    expect(summarizeActivityBodySchema.safeParse({ contactId: UUID }).success).toBe(true);
    expect(summarizeActivityBodySchema.safeParse({ companyId: UUID }).success).toBe(true);
    expect(summarizeActivityBodySchema.safeParse({ dealId: UUID }).success).toBe(true);
  });
  it('rejects empty payload', () => {
    expect(summarizeActivityBodySchema.safeParse({}).success).toBe(false);
  });
  it('rejects two parents', () => {
    expect(
      summarizeActivityBodySchema.safeParse({ contactId: UUID, dealId: UUID }).success,
    ).toBe(false);
  });
  it('rejects bad uuid', () => {
    expect(summarizeActivityBodySchema.safeParse({ contactId: 'nope' }).success).toBe(false);
  });
});

describe('extractContactBodySchema', () => {
  it('accepts normal text', () => {
    expect(extractContactBodySchema.safeParse({ text: 'Alice' }).success).toBe(true);
  });
  it('rejects empty text', () => {
    expect(extractContactBodySchema.safeParse({ text: '' }).success).toBe(false);
  });
  it('rejects text > 10000 chars', () => {
    expect(extractContactBodySchema.safeParse({ text: 'a'.repeat(10001) }).success).toBe(false);
  });
});
