import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../../helpers/postgres.js';
import { ReportsRepo } from '../../../src/modules/reports/reports.repo.js';
import { schema } from '@dealflow/db';

describe('ReportsRepo.getKpis', () => {
  let pg: TestPostgres;
  beforeEach(async () => { pg = await startTestPostgres(); });
  afterEach(async () => { await pg.stop(); });

  // Each org row needs a unique slug — generate one per fixture.
  const slug = () => `org-${Math.random().toString(36).slice(2, 8)}`;

  it('returns zeros for an empty org', async () => {
    const [org] = await pg.db
      .insert(schema.organizations)
      .values({ name: 'Empty Co', slug: slug(), defaultCurrency: 'USD' })
      .returning();
    const repo = new ReportsRepo(pg.db);
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
    const [orgA] = await pg.db
      .insert(schema.organizations)
      .values({ name: 'A', slug: slug(), defaultCurrency: 'USD' })
      .returning();
    const [orgB] = await pg.db
      .insert(schema.organizations)
      .values({ name: 'B', slug: slug(), defaultCurrency: 'EUR' })
      .returning();

    await pg.db.insert(schema.contacts).values([
      { organizationId: orgA!.id, firstName: 'A1' },
      { organizationId: orgA!.id, firstName: 'A2' },
      { organizationId: orgB!.id, firstName: 'B1' },
    ]);
    await pg.db.insert(schema.companies).values([
      { organizationId: orgA!.id, name: 'Co A' },
      { organizationId: orgB!.id, name: 'Co B' },
    ]);

    const repo = new ReportsRepo(pg.db);
    const kpisA = await repo.getKpis(orgA!.id);
    expect(kpisA.totalContacts).toBe(2);
    expect(kpisA.totalCompanies).toBe(1);
    expect(kpisA.currency).toBe('USD');

    const kpisB = await repo.getKpis(orgB!.id);
    expect(kpisB.totalContacts).toBe(1);
    expect(kpisB.totalCompanies).toBe(1);
    expect(kpisB.currency).toBe('EUR');
  });
});
