import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { SessionsRepo } from '../../../src/modules/auth/sessions.repo.js';

describe('SessionsRepo', () => {
  let testDb: TestDatabase;
  let db: Database;
  let repo: SessionsRepo;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    db = testDb.db;
    repo = new SessionsRepo(db);
  }, 30_000);

  afterAll(async () => {
    await testDb.stop();
  });

  /** Insert a user (and optionally an org) to satisfy session FKs. */
  async function makeUserAndOrg(suffix: string) {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${suffix}` })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: `u-${suffix}@example.com`, name: 'U' })
      .returning();
    return { org: org!, user: user! };
  }

  it('create + findById round-trip', async () => {
    const { org, user } = await makeUserAndOrg(`rt-${Date.now()}`);
    const created = await repo.create({
      userId: user.id,
      currentOrgId: org.id,
      expiresInDays: 30,
      userAgent: 'test',
      ip: '127.0.0.1',
    });

    expect(created.id).toMatch(/^[a-f0-9]{64}$/);
    const fetched = await repo.findById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.userId).toBe(user.id);
  });

  it('findById returns null for unknown ids', async () => {
    expect(await repo.findById('0'.repeat(64))).toBeNull();
  });

  it('findById returns null for expired sessions', async () => {
    const { user } = await makeUserAndOrg(`exp-${Date.now()}`);
    const created = await repo.create({
      userId: user.id,
      currentOrgId: null,
      expiresInDays: -1, // already expired
      userAgent: null,
      ip: null,
    });
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('touch() pushes expiry forward', async () => {
    const { user } = await makeUserAndOrg(`touch-${Date.now()}`);
    const created = await repo.create({
      userId: user.id,
      currentOrgId: null,
      expiresInDays: 30,
      userAgent: null,
      ip: null,
    });
    const before = created.expiresAt.getTime();
    await new Promise((r) => setTimeout(r, 50));
    await repo.touch(created.id, 30);
    const after = await repo.findById(created.id);
    expect(after!.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it('delete() removes the session', async () => {
    const { user } = await makeUserAndOrg(`del-${Date.now()}`);
    const created = await repo.create({
      userId: user.id,
      currentOrgId: null,
      expiresInDays: 30,
      userAgent: null,
      ip: null,
    });
    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });
});
