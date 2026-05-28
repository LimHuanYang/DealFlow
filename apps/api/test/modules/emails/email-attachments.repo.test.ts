import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { EmailAttachmentsRepo } from '../../../src/modules/emails/email-attachments.repo.js';

describe('EmailAttachmentsRepo', () => {
  let testDb: TestDatabase;
  let repo: EmailAttachmentsRepo;
  let orgId: string;
  let activityId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    repo = new EmailAttachmentsRepo(testDb.db);
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Org', slug: `o-${Date.now()}`, defaultCurrency: 'USD' })
      .returning();
    orgId = org!.id;
    const [user] = await testDb.db
      .insert(schema.users)
      .values({ email: 'u@u.com', name: 'U', passwordHash: 'x' })
      .returning();
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: orgId,
        ownerUserId: user!.id,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();
    activityId = activity!.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('createMany inserts attachment rows and returns them', async () => {
    const rows = await repo.createMany(orgId, activityId, [
      {
        filename: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        cacheExpiresAt: null,
        cachePath: null,
      },
      {
        filename: 'b.png',
        mimeType: 'image/png',
        sizeBytes: 200,
        cacheExpiresAt: new Date(Date.now() + 86_400_000),
        cachePath: `${orgId}/x`,
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.filename).toBe('a.pdf');
    expect(rows[1]!.cachePath).toBe(`${orgId}/x`);
  });

  it('listForActivity returns rows in createdAt order', async () => {
    const rows = await repo.listForActivity(orgId, activityId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.find((r) => r.filename === 'a.pdf')).toBeDefined();
  });

  it('findById is tenant-scoped (orgB cannot read orgA row)', async () => {
    const [orgB] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'B', slug: `b-${Date.now()}`, defaultCurrency: 'USD' })
      .returning();
    const row = (await repo.listForActivity(orgId, activityId))[0]!;
    const found = await repo.findById(orgB!.id, row.id);
    expect(found).toBeNull();
  });

  it('clearCachePath nulls out cache columns for an id', async () => {
    const row = (await repo.listForActivity(orgId, activityId)).find(
      (r) => r.filename === 'b.png',
    )!;
    await repo.clearCachePath(row.id);
    const after = await repo.findById(orgId, row.id);
    expect(after!.cachePath).toBeNull();
    expect(after!.cacheExpiresAt).toBeNull();
  });

  it('findExpiredForEviction returns only rows past expiry with non-null cache_path', async () => {
    const [actExpired] = await testDb.db
      .insert(schema.emailAttachments)
      .values({
        organizationId: orgId,
        activityId,
        filename: 'exp.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 50,
        cachePath: `${orgId}/exp`,
        cacheExpiresAt: new Date(Date.now() - 86_400_000),
      })
      .returning();
    const expired = await repo.findExpiredForEviction(100);
    expect(expired.some((r) => r.id === actExpired!.id)).toBe(true);
  });
});
