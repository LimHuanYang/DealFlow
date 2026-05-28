import type { Database } from '@dealflow/db';
import { EmailAttachmentsRepo } from '../modules/emails/email-attachments.repo.js';
import { evictAttachment } from '../lib/email-attachments-store.js';

export interface EvictionSweepArgs {
  db: Database;
  cacheDir: string;
  /** Maximum rows to process per sweep. Default 1000. */
  batchSize?: number;
}

export interface EvictionSweepResult {
  processed: number;
  errors: number;
}

/**
 * One pass of attachment-cache eviction. Finds rows whose cache_expires_at is
 * in the past AND that still have a cache_path set, deletes the file from
 * disk, then nulls out the DB columns. Idempotent — unlinking a missing file
 * is a no-op.
 */
export async function runAttachmentEvictionSweep(
  args: EvictionSweepArgs,
): Promise<EvictionSweepResult> {
  const repo = new EmailAttachmentsRepo(args.db);
  const batchSize = args.batchSize ?? 1000;
  const rows = await repo.findExpiredForEviction(batchSize);
  let processed = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      await evictAttachment({
        cacheDir: args.cacheDir,
        orgId: r.organizationId,
        attachmentId: r.id,
      });
      await repo.clearCachePath(r.id);
      processed += 1;
    } catch {
      errors += 1;
    }
  }
  return { processed, errors };
}
