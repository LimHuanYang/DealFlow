import { describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret, loadEncryptionKey } from '../../src/lib/crypto.js';
import { randomBytes } from 'node:crypto';

const TEST_KEY = randomBytes(32);

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a simple string', () => {
    const ciphertext = encryptSecret('hello world', TEST_KEY);
    expect(ciphertext).not.toBe('hello world');
    expect(decryptSecret(ciphertext, TEST_KEY)).toBe('hello world');
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encryptSecret('same plaintext', TEST_KEY);
    const b = encryptSecret('same plaintext', TEST_KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, TEST_KEY)).toBe('same plaintext');
    expect(decryptSecret(b, TEST_KEY)).toBe('same plaintext');
  });

  it('produces a 3-part colon-separated string (iv:ciphertext:tag)', () => {
    const ct = encryptSecret('x', TEST_KEY);
    expect(ct.split(':')).toHaveLength(3);
  });

  it('throws when decrypting with a different key', () => {
    const ciphertext = encryptSecret('secret', TEST_KEY);
    const wrongKey = randomBytes(32);
    expect(() => decryptSecret(ciphertext, wrongKey)).toThrow();
  });

  it('throws when ciphertext is tampered (auth tag fails)', () => {
    const ciphertext = encryptSecret('secret', TEST_KEY);
    const [iv, , tag] = ciphertext.split(':');
    const tampered = `${iv}:${Buffer.from('ZZZZZZZZZZZZ', 'utf8').toString('base64')}:${tag}`;
    expect(() => decryptSecret(tampered, TEST_KEY)).toThrow();
  });

  it('round-trips unicode + long strings', () => {
    const long = 'sk-ant-' + 'x'.repeat(500) + '✨🔑';
    const ct = encryptSecret(long, TEST_KEY);
    expect(decryptSecret(ct, TEST_KEY)).toBe(long);
  });
});

describe('loadEncryptionKey', () => {
  it('decodes a base64-encoded 32-byte key', () => {
    const raw = randomBytes(32);
    const b64 = raw.toString('base64');
    const loaded = loadEncryptionKey(b64);
    expect(loaded.equals(raw)).toBe(true);
  });

  it('throws on a key that is not 32 bytes', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => loadEncryptionKey(shortKey)).toThrow(/32 bytes/);
  });

  it('throws on garbage input', () => {
    expect(() => loadEncryptionKey('not-base64-and-not-32-bytes')).toThrow();
  });
});
