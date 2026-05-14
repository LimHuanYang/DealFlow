import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { OrgsRepo } from '../../../src/modules/auth/orgs.repo.js';
import { UsersRepo } from '../../../src/modules/auth/users.repo.js';

describe('OrgsRepo', () => {
  let testDb: TestDatabase;
  let orgs: OrgsRepo;
  let users: UsersRepo;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    orgs = new OrgsRepo(testDb.db);
    users = new UsersRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('create + findById', async () => {
    const created = await orgs.create({ name: 'Acme', slug: 'acme-test' });
    const found = await orgs.findById(created.id);
    expect(found?.slug).toBe('acme-test');
  });

  it('countAll reflects inserts', async () => {
    const before = await orgs.countAll();
    await orgs.create({ name: 'Two', slug: 'two-test' });
    expect(await orgs.countAll()).toBe(before + 1);
  });

  it('addMember links user to org with role', async () => {
    const org = await orgs.create({ name: 'WithMember', slug: 'wm-test' });
    const user = await users.create({
      email: 'm@example.com',
      name: 'M',
      passwordHash: null,
    });
    await orgs.addMember(org.id, user.id, 'owner');
    const result = await testDb.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM org_members WHERE organization_id = ${org.id}`,
    );
    expect(result[0]?.count).toBe(1);
  });
});
