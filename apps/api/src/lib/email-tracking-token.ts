import { createHmac, timingSafeEqual } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Buffer {
  // Pad to a multiple of 4
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * Sign a tracking token for the given activity id. Format:
 *   <base64url(activityId-bytes)>.<base64url(HMAC-SHA256(secret, activityId-bytes))>
 *
 * `activityId` is a UUID v4 string; we hash its raw 16-byte form for compactness.
 * Anyone with the secret can forge; HMAC ensures tampering is detectable.
 */
export function signTrackingToken(activityId: string, secret: string): string {
  const idBytes = uuidToBytes(activityId);
  const sig = createHmac('sha256', secret).update(idBytes).digest();
  return `${base64url(idBytes)}.${base64url(sig)}`;
}

export type TokenResult = { ok: true; activityId: string } | { ok: false; error: string };

/** Constant-time verify. Returns the decoded activity id on success. */
export function verifyTrackingToken(token: string, secret: string): TokenResult {
  if (!token || typeof token !== 'string') return { ok: false, error: 'empty' };
  const dot = token.indexOf('.');
  if (dot < 0) return { ok: false, error: 'malformed' };
  const idPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let idBytes: Buffer;
  let providedSig: Buffer;
  try {
    idBytes = fromBase64url(idPart);
    providedSig = fromBase64url(sigPart);
  } catch {
    return { ok: false, error: 'decode' };
  }
  if (idBytes.length !== 16) return { ok: false, error: 'bad_id_length' };
  const expected = createHmac('sha256', secret).update(idBytes).digest();
  if (providedSig.length !== expected.length) return { ok: false, error: 'bad_sig_length' };
  if (!timingSafeEqual(providedSig, expected)) return { ok: false, error: 'bad_sig' };
  return { ok: true, activityId: bytesToUuid(idBytes) };
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error('Invalid UUID');
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(buf: Buffer): string {
  const h = buf.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
