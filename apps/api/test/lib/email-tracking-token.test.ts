import { describe, expect, it } from 'vitest';
import { signTrackingToken, verifyTrackingToken } from '../../src/lib/email-tracking-token.js';

const SECRET = 'a'.repeat(64);
const ACTIVITY_ID = '11111111-1111-1111-1111-111111111111';

describe('email-tracking-token', () => {
  it('signs and verifies a round-trip', () => {
    const token = signTrackingToken(ACTIVITY_ID, SECRET);
    const result = verifyTrackingToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.activityId).toBe(ACTIVITY_ID);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signTrackingToken(ACTIVITY_ID, SECRET);
    const result = verifyTrackingToken(token, 'b'.repeat(64));
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed token (no dot)', () => {
    expect(verifyTrackingToken('garbage', SECRET).ok).toBe(false);
    expect(verifyTrackingToken('', SECRET).ok).toBe(false);
  });

  it('rejects a token with tampered activity id', () => {
    const token = signTrackingToken(ACTIVITY_ID, SECRET);
    const [, sig] = token.split('.');
    const tampered = 'AAAAAAAAAAAAAAAAAAAAAAAAAA.' + sig;
    expect(verifyTrackingToken(tampered, SECRET).ok).toBe(false);
  });

  it('produces URL-safe output (no +, /, =)', () => {
    const token = signTrackingToken(ACTIVITY_ID, SECRET);
    expect(token).not.toMatch(/[+/=]/);
  });
});
