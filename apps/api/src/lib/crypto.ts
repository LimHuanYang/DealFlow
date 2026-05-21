import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard
const KEY_BYTES = 32; // AES-256

/**
 * Encrypts a UTF-8 string with AES-256-GCM. The output is a 3-part colon-
 * separated string `iv:ciphertext:authTag`, each base64-encoded. The IV is
 * random per-call so the same plaintext yields different ciphertexts.
 *
 * Used for at-rest encryption of per-org integration secrets (API keys,
 * SMTP passwords). The `key` arg is the 32-byte deployment encryption key
 * loaded once at boot via `loadEncryptionKey`.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryptSecret: key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), ciphertext.toString('base64'), authTag.toString('base64')].join(
    ':',
  );
}

/**
 * Decrypts a string produced by `encryptSecret`. Throws if the ciphertext was
 * tampered (the GCM auth tag won't verify) or if the wrong key is supplied.
 */
export function decryptSecret(encrypted: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`decryptSecret: key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('decryptSecret: malformed ciphertext (expected iv:ct:tag)');
  }
  const [ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64');
  const ciphertext = Buffer.from(ctB64!, 'base64');
  const authTag = Buffer.from(tagB64!, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Decode the deployment encryption key from a base64-encoded string. The
 * decoded key MUST be exactly 32 bytes (AES-256). Throws otherwise.
 *
 * Generate a fresh key:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
export function loadEncryptionKey(base64: string): Buffer {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `loadEncryptionKey: decoded key is ${buf.length} bytes, expected ${KEY_BYTES} bytes. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return buf;
}
