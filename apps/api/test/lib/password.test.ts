import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';

describe('password (argon2id)', () => {
  it('hashes a password to a non-reversible string', async () => {
    const hash = await hashPassword('s3cret-Pa$$word');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('s3cret');
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('s3cret-Pa$$word');
    await expect(verifyPassword(hash, 's3cret-Pa$$word')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-Pa$$word');
    await expect(verifyPassword(hash, 'wrong-Pa$$word')).resolves.toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});
