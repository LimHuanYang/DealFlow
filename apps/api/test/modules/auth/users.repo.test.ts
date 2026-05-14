import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { UsersRepo } from '../../../src/modules/auth/users.repo.js';

describe('UsersRepo', () => {
  let testDb: TestDatabase;
  let repo: UsersRepo;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    repo = new UsersRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('creates a user and finds by email (case-insensitive)', async () => {
    const created = await repo.create({
      email: 'Alice@Example.COM',
      name: 'Alice',
      passwordHash: 'hashed',
    });
    expect(created.email).toBe('alice@example.com');

    const found = await repo.findByEmail('ALICE@EXAMPLE.com');
    expect(found?.id).toBe(created.id);
  });

  it('findByEmail returns null for unknown', async () => {
    expect(await repo.findByEmail('nobody@nowhere.com')).toBeNull();
  });
});
