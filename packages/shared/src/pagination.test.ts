import { describe, expect, it } from 'vitest';
import { paginationQuerySchema } from './pagination.js';

describe('paginationQuerySchema', () => {
  it('applies default limit of 50 when omitted', () => {
    const result = paginationQuerySchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.cursor).toBeUndefined();
  });

  it('clamps limit to 200 maximum', () => {
    expect(() => paginationQuerySchema.parse({ limit: 201 })).toThrow();
  });

  it('rejects negative limit', () => {
    expect(() => paginationQuerySchema.parse({ limit: 0 })).toThrow();
  });

  it('accepts a cursor string', () => {
    const result = paginationQuerySchema.parse({ cursor: 'abc123', limit: 25 });
    expect(result.cursor).toBe('abc123');
    expect(result.limit).toBe(25);
  });
});
