import { describe, expect, it } from 'vitest';
import { generateSessionToken, generateUrlToken } from '../../src/lib/tokens.js';

describe('tokens', () => {
  it('generateSessionToken returns 64 hex chars (256 bits)', () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generateSessionToken is unique across calls', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateSessionToken()));
    expect(set.size).toBe(100);
  });

  it('generateUrlToken returns 43 base64url chars (32 bytes)', () => {
    const t = generateUrlToken();
    // base64url: A-Z a-z 0-9 - _   (no padding, 43 chars for 32 bytes)
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
