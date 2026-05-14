import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with sensible defaults for interactive web auth.
 * 64 MB memory, 3 passes, 4 lanes — comfortably above OWASP minimums.
 *
 * Algorithm value `2` corresponds to `Algorithm.Argon2id` in @node-rs/argon2.
 * We use the numeric literal because the package declares Algorithm as an
 * ambient `const enum`, which TypeScript forbids accessing under
 * `verbatimModuleSyntax`.
 */
const PARAMS = {
  algorithm: 2,
  memoryCost: 64 * 1024, // KiB
  timeCost: 3,
  parallelism: 4,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    // verify throws on malformed hashes; treat as a failed comparison.
    return false;
  }
}
