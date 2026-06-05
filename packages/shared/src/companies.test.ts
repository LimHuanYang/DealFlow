import { describe, expect, it } from 'vitest';
import { createCompanyBodySchema } from './companies.js';

describe('createCompanyBodySchema', () => {
  it('accepts a name-only company', () => {
    expect(createCompanyBodySchema.safeParse({ name: 'Acme' }).success).toBe(true);
  });

  it('treats blank optional fields as absent (form sends "" for empty inputs)', () => {
    const r = createCompanyBodySchema.safeParse({
      name: 'Acme',
      domain: '',
      industry: '',
      size: '',
      website: '',
      description: '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.domain).toBeUndefined();
      expect(r.data.industry).toBeUndefined();
      expect(r.data.size).toBeUndefined();
      expect(r.data.website).toBeUndefined();
      expect(r.data.description).toBeUndefined();
    }
  });

  it('still rejects a malformed (non-blank) website', () => {
    expect(createCompanyBodySchema.safeParse({ name: 'Acme', website: 'not-a-url' }).success).toBe(
      false,
    );
  });
});
