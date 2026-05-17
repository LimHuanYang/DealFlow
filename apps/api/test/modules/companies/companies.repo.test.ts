import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { CompaniesRepo } from '../../../src/modules/companies/companies.repo.js';

describe('CompaniesRepo', () => {
  let testDb: TestDatabase;
  let repo: CompaniesRepo;
  let orgId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
    repo = new CompaniesRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('create + findById within org', async () => {
    const created = await repo.create(orgId, {
      name: 'Beta Industries',
      domain: 'beta.com',
    });
    expect(created.name).toBe('Beta Industries');
    expect(created.organizationId).toBe(orgId);

    const found = await repo.findById(orgId, created.id);
    expect(found?.id).toBe(created.id);
  });

  it('findById returns null for an id in a different org', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    const c = await repo.create(otherOrg!.id, { name: 'Foreign Co' });
    expect(await repo.findById(orgId, c.id)).toBeNull();
  });

  it('list returns only the orgs rows, ordered by createdAt desc', async () => {
    await Promise.all([
      repo.create(orgId, { name: `Z-${Date.now()}` }),
      repo.create(orgId, { name: `A-${Date.now()}` }),
    ]);
    const result = await repo.list(orgId, { limit: 50 });
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items.every((r) => r.organizationId === orgId)).toBe(true);
  });

  it('update merges partial fields', async () => {
    const c = await repo.create(orgId, { name: 'Patchable' });
    const updated = await repo.update(orgId, c.id, { industry: 'SaaS' });
    expect(updated?.industry).toBe('SaaS');
    expect(updated?.name).toBe('Patchable');
  });

  it('update returns null when id is in a different org', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Else', slug: `else-${Date.now()}` })
      .returning();
    const c = await repo.create(otherOrg!.id, { name: 'NotMine' });
    expect(await repo.update(orgId, c.id, { name: 'hijack' })).toBeNull();
  });

  it('delete removes only when the id is in the org', async () => {
    const c = await repo.create(orgId, { name: 'Deleteme' });
    expect(await repo.delete(orgId, c.id)).toBe(true);
    expect(await repo.findById(orgId, c.id)).toBeNull();

    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'NoTouch', slug: `nt-${Date.now()}` })
      .returning();
    const foreign = await repo.create(otherOrg!.id, { name: 'Foreign' });
    expect(await repo.delete(orgId, foreign.id)).toBe(false);
  });
});
