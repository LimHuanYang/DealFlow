import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cacheAttachment,
  readCachedAttachment,
  evictAttachment,
  attachmentCachePath,
} from '../../src/lib/email-attachments-store.js';

describe('email-attachments-store', () => {
  let cacheDir: string;
  const ORG_ID = 'org-1111-1111-1111-111111111111';
  const ATT_ID = 'att-1111-1111-1111-111111111111';

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'dealflow-attach-test-'));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('writes a file at the org+attachment scoped path', async () => {
    const buf = Buffer.from('hello world');
    const rel = await cacheAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID, buffer: buf });
    expect(rel).toBe(`${ORG_ID}/${ATT_ID}`);
    const stat1 = await stat(join(cacheDir, ORG_ID, ATT_ID));
    expect(stat1.size).toBe(buf.length);
  });

  it('reads bytes back identical to what was written', async () => {
    const buf = Buffer.from('the quick brown fox\n');
    await cacheAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID, buffer: buf });
    const got = await readCachedAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID });
    expect(got).not.toBeNull();
    expect(got!.equals(buf)).toBe(true);
  });

  it('returns null on read when file is missing', async () => {
    const got = await readCachedAttachment({
      cacheDir,
      orgId: ORG_ID,
      attachmentId: 'missing-id-0000-0000-000000000000',
    });
    expect(got).toBeNull();
  });

  it('evictAttachment removes the file', async () => {
    await cacheAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID, buffer: Buffer.from('x') });
    await evictAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID });
    const got = await readCachedAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID });
    expect(got).toBeNull();
  });

  it('evictAttachment is idempotent (no error when file already gone)', async () => {
    await expect(
      evictAttachment({
        cacheDir,
        orgId: ORG_ID,
        attachmentId: 'never-existed-0000-000000000000',
      }),
    ).resolves.toBeUndefined();
  });

  it('attachmentCachePath builds the correct absolute path', () => {
    const p = attachmentCachePath({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID });
    expect(p).toBe(join(cacheDir, ORG_ID, ATT_ID));
  });
});
