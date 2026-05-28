import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('GET /api/v1/attachments/:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cacheDir: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    cacheDir = await mkdtemp(join(tmpdir(), 'dealflow-att-dl-'));
    app = await buildTestApp({ db: testDb.db, env: { ATTACHMENTS_CACHE_DIR: cacheDir } });
  }, 30_000);
  afterAll(async () => {
    await app.close();
    await testDb.stop();
    await rm(cacheDir, { recursive: true, force: true });
  });

  async function seedAttachment(opts: {
    orgId: string;
    userId: string;
    cached: boolean;
    expired?: boolean;
  }): Promise<string> {
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: opts.orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: opts.orgId,
        ownerUserId: opts.userId,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();
    const cacheExpiresAt = opts.expired
      ? new Date(Date.now() - 86_400_000)
      : new Date(Date.now() + 86_400_000);
    const [att] = await testDb.db
      .insert(schema.emailAttachments)
      .values({
        organizationId: opts.orgId,
        activityId: activity!.id,
        filename: 'note.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        cachePath: null,
        cacheExpiresAt: opts.cached ? cacheExpiresAt : null,
      })
      .returning();
    if (opts.cached) {
      await mkdir(join(cacheDir, opts.orgId), { recursive: true });
      await writeFile(join(cacheDir, opts.orgId, att!.id), 'hello');
      await testDb.db
        .update(schema.emailAttachments)
        .set({ cachePath: `${opts.orgId}/${att!.id}` })
        .where(eq(schema.emailAttachments.id, att!.id));
    }
    return att!.id;
  }

  it('returns 200 + file bytes for a cache hit', async () => {
    const { cookie, orgId, userId } = await signupTestUser(app);
    const attId = await seedAttachment({ orgId, userId, cached: true });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-disposition']).toContain('note.txt');
    expect(res.body).toBe('hello');
  });

  it('returns 404 ATTACHMENT_NOT_CACHED when cache_path is null', async () => {
    const { cookie, orgId, userId } = await signupTestUser(app);
    const attId = await seedAttachment({ orgId, userId, cached: false });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ATTACHMENT_NOT_CACHED');
  });

  it('returns 404 ATTACHMENT_NOT_CACHED when expired AND lazily clears cache_path', async () => {
    const { cookie, orgId, userId } = await signupTestUser(app);
    const attId = await seedAttachment({ orgId, userId, cached: true, expired: true });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ATTACHMENT_NOT_CACHED');
    const [row] = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.id, attId));
    expect(row!.cachePath).toBeNull();
  });

  it('enforces tenant isolation (orgB cannot see orgA attachment)', async () => {
    const a = await signupTestUser(app);
    const b = await signupTestUser(app);
    const attId = await seedAttachment({ orgId: a.orgId, userId: a.userId, cached: true });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attId}`,
      headers: { cookie: b.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ATTACHMENT_NOT_CACHED');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attachments/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(401);
  });
});
