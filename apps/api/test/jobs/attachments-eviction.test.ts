import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../helpers/postgres.js';
import { runAttachmentEvictionSweep } from '../../src/jobs/attachments-eviction.js';

describe('runAttachmentEvictionSweep', () => {
  let testDb: TestDatabase;
  let cacheDir: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    cacheDir = await mkdtemp(join(tmpdir(), 'dealflow-evict-'));
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'O', slug: `o-${Date.now()}`, defaultCurrency: 'USD' })
      .returning();
    orgId = org!.id;
    const [user] = await testDb.db
      .insert(schema.users)
      .values({ email: 'u@u.com', name: 'U', passwordHash: 'x' })
      .returning();
    userId = user!.id;
  }, 60_000);
  afterAll(async () => {
    await testDb.stop();
    await rm(cacheDir, { recursive: true, force: true });
  }, 60_000);

  async function seed(opts: { expired: boolean; cached: boolean }) {
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();
    const [att] = await testDb.db
      .insert(schema.emailAttachments)
      .values({
        organizationId: orgId,
        activityId: activity!.id,
        filename: 'x.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        cachePath: opts.cached ? `${orgId}/PLACEHOLDER` : null,
        cacheExpiresAt: opts.expired
          ? new Date(Date.now() - 86_400_000)
          : new Date(Date.now() + 86_400_000),
      })
      .returning();
    if (opts.cached) {
      await mkdir(join(cacheDir, orgId), { recursive: true });
      await writeFile(join(cacheDir, orgId, att!.id), 'hello');
      await testDb.db
        .update(schema.emailAttachments)
        .set({ cachePath: `${orgId}/${att!.id}` })
        .where(eq(schema.emailAttachments.id, att!.id));
    }
    return att!.id;
  }

  it('deletes expired files and clears cache_path on DB rows', async () => {
    const expiredId = await seed({ expired: true, cached: true });
    const freshId = await seed({ expired: false, cached: true });
    const neverCachedId = await seed({ expired: false, cached: false });

    const result = await runAttachmentEvictionSweep({ db: testDb.db, cacheDir });
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const [expiredRow] = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.id, expiredId));
    expect(expiredRow!.cachePath).toBeNull();

    const [freshRow] = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.id, freshId));
    expect(freshRow!.cachePath).not.toBeNull();

    let exists = true;
    try {
      await stat(join(cacheDir, orgId, expiredId));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);

    void neverCachedId;
  });

  it('is idempotent when file was already deleted from disk', async () => {
    const id = await seed({ expired: true, cached: true });
    await rm(join(cacheDir, orgId, id), { force: true });
    await expect(runAttachmentEvictionSweep({ db: testDb.db, cacheDir })).resolves.toBeDefined();
    const [row] = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.id, id));
    expect(row!.cachePath).toBeNull();
  });
});
