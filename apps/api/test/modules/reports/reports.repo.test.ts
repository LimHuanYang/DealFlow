import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { ReportsRepo } from '../../../src/modules/reports/reports.repo.js';
import { schema } from '@dealflow/db';

describe('ReportsRepo.getKpis', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestPostgres();
  }, 30_000);

  afterAll(() => testDb.stop());

  // Each org row needs a unique slug — generate one per fixture.
  const slug = () => `org-${Math.random().toString(36).slice(2, 8)}`;

  it('returns zeros for an empty org', async () => {
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Empty Co', slug: slug(), defaultCurrency: 'USD' })
      .returning();
    const repo = new ReportsRepo(testDb.db);
    const kpis = await repo.getKpis(org!.id);
    expect(kpis).toEqual({
      totalContacts: 0,
      totalCompanies: 0,
      openDeals: 0,
      openPipelineValue: '0.00',
      overdueTasks: 0,
      currency: 'USD',
    });
  });

  it('counts only rows in the requested org (tenant isolation)', async () => {
    const [orgA] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'A', slug: slug(), defaultCurrency: 'USD' })
      .returning();
    const [orgB] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'B', slug: slug(), defaultCurrency: 'EUR' })
      .returning();

    // Contacts + companies
    await testDb.db.insert(schema.contacts).values([
      { organizationId: orgA!.id, firstName: 'A1' },
      { organizationId: orgA!.id, firstName: 'A2' },
      { organizationId: orgB!.id, firstName: 'B1' },
    ]);
    await testDb.db.insert(schema.companies).values([
      { organizationId: orgA!.id, name: 'Co A' },
      { organizationId: orgB!.id, name: 'Co B' },
    ]);

    // Pipeline + stage in each org
    const [plA] = await testDb.db
      .insert(schema.pipelines)
      .values({ organizationId: orgA!.id, name: 'Pipeline A' })
      .returning();
    const [stageA] = await testDb.db
      .insert(schema.pipelineStages)
      .values({ organizationId: orgA!.id, pipelineId: plA!.id, name: 'Stage A', orderIndex: 0 })
      .returning();

    const [plB] = await testDb.db
      .insert(schema.pipelines)
      .values({ organizationId: orgB!.id, name: 'Pipeline B' })
      .returning();
    const [stageB] = await testDb.db
      .insert(schema.pipelineStages)
      .values({ organizationId: orgB!.id, pipelineId: plB!.id, name: 'Stage B', orderIndex: 0 })
      .returning();

    // orgA: 1 open deal (value 5000) + 1 won deal (value 9999, excluded from openPipelineValue)
    // orgB: 1 open deal (value 7000)
    await testDb.db.insert(schema.deals).values([
      { organizationId: orgA!.id, pipelineId: plA!.id, stageId: stageA!.id, name: 'Deal A Open', value: '5000', status: 'open' },
      { organizationId: orgA!.id, pipelineId: plA!.id, stageId: stageA!.id, name: 'Deal A Won',  value: '9999', status: 'won' },
      { organizationId: orgB!.id, pipelineId: plB!.id, stageId: stageB!.id, name: 'Deal B Open', value: '7000', status: 'open' },
    ]);

    // Owner user for activities (unique email to avoid cross-test collisions)
    const [owner] = await testDb.db
      .insert(schema.users)
      .values({ email: `u${Date.now()}.${Math.random().toString(36).slice(2, 4)}@x.com`, name: 'Owner' })
      .returning();

    // Activities require exactly one parent — use the existing contacts as anchors
    const [contactForTaskA] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgA!.id, firstName: 'TaskOwner A' })
      .returning();
    const [contactForTaskB] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgB!.id, firstName: 'TaskOwner B' })
      .returning();

    // 1 overdue task in each org (dueAt = yesterday)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await testDb.db.insert(schema.activities).values([
      { organizationId: orgA!.id, ownerUserId: owner!.id, contactId: contactForTaskA!.id, kind: 'task', body: 'Overdue A', status: 'open', dueAt: yesterday },
      { organizationId: orgB!.id, ownerUserId: owner!.id, contactId: contactForTaskB!.id, kind: 'task', body: 'Overdue B', status: 'open', dueAt: yesterday },
    ]);

    const repo = new ReportsRepo(testDb.db);

    const kpisA = await repo.getKpis(orgA!.id);
    expect(kpisA.totalContacts).toBe(3); // A1, A2, TaskOwner A
    expect(kpisA.totalCompanies).toBe(1);
    expect(kpisA.currency).toBe('USD');
    expect(kpisA.openDeals).toBe(1);
    expect(kpisA.openPipelineValue).toBe('5000.00');
    expect(kpisA.overdueTasks).toBe(1);

    const kpisB = await repo.getKpis(orgB!.id);
    expect(kpisB.totalContacts).toBe(2); // B1, TaskOwner B
    expect(kpisB.totalCompanies).toBe(1);
    expect(kpisB.currency).toBe('EUR');
    expect(kpisB.openDeals).toBe(1);
    expect(kpisB.openPipelineValue).toBe('7000.00');
    expect(kpisB.overdueTasks).toBe(1);
  });
});
