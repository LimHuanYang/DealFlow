import { randomBytes } from 'node:crypto';

/**
 * 256-bit hex token for opaque session ids stored both in the DB and the cookie.
 * 64 hex chars = 32 bytes = 256 bits of entropy.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * URL-safe 32-byte token for invitation / password-reset / verification links.
 * 43 base64url chars; can be put directly into a URL without encoding.
 */
export function generateUrlToken(): string {
  return randomBytes(32).toString('base64url');
}
