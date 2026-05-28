import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface StoreArgs {
  cacheDir: string;
  orgId: string;
  attachmentId: string;
}

export interface WriteArgs extends StoreArgs {
  buffer: Buffer;
}

/**
 * Build the absolute filesystem path where a given attachment should live
 * inside the cache. Files are named by attachment id only; the original
 * filename lives in the DB. This keeps user-controlled strings off the
 * filesystem (no path-traversal surface, no collisions on duplicate names).
 */
export function attachmentCachePath({ cacheDir, orgId, attachmentId }: StoreArgs): string {
  return join(cacheDir, orgId, attachmentId);
}

/**
 * Persist an attachment's bytes to the cache directory.
 * Returns the path RELATIVE to cacheDir (suitable for storing in the DB
 * `cache_path` column).
 */
export async function cacheAttachment(args: WriteArgs): Promise<string> {
  const target = attachmentCachePath(args);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, args.buffer);
  return `${args.orgId}/${args.attachmentId}`;
}

/**
 * Read a cached attachment's bytes. Returns null if the file doesn't exist.
 * Other errors propagate.
 */
export async function readCachedAttachment(args: StoreArgs): Promise<Buffer | null> {
  try {
    return await readFile(attachmentCachePath(args));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Delete a cached attachment. Idempotent — no-op if the file is already gone.
 * Other errors propagate.
 */
export async function evictAttachment(args: StoreArgs): Promise<void> {
  await rm(attachmentCachePath(args), { force: true });
}
