import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { PipelinesRepo } from '../../../src/modules/pipelines/pipelines.repo.js';

describe('PipelinesRepo', () => {
  let testDb: TestDatabase;
  let repo: PipelinesRepo;
  let orgId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
    repo = new PipelinesRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('create + listForOrg', async () => {
    const created = await repo.create(orgId, { name: 'Sales', isDefault: true });
    expect(created.name).toBe('Sales');
    expect(created.organizationId).toBe(orgId);
    const list = await repo.listForOrg(orgId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((p) => p.organizationId === orgId)).toBe(true);
  });

  it('findById is org-scoped', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    const foreign = await repo.create(otherOrg!.id, { name: 'Foreign', isDefault: false });
    expect(await repo.findById(orgId, foreign.id)).toBeNull();
  });
});
