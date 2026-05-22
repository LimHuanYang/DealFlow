import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { ReportsRepo } from '../../../src/modules/reports/reports.repo.js';
import { schema } from '@dealflow/db';

describe('ReportsRepo', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestPostgres();
  }, 30_000);

  afterAll(() => testDb.stop());

  // Each org row needs a unique slug — generate one per fixture.
  const slug = () => `org-${Math.random().toString(36).slice(2, 8)}`;

  describe('getKpis', () => {
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
        {
          organizationId: orgA!.id,
          pipelineId: plA!.id,
          stageId: stageA!.id,
          name: 'Deal A Open',
          value: '5000',
          status: 'open',
        },
        {
          organizationId: orgA!.id,
          pipelineId: plA!.id,
          stageId: stageA!.id,
          name: 'Deal A Won',
          value: '9999',
          status: 'won',
        },
        {
          organizationId: orgB!.id,
          pipelineId: plB!.id,
          stageId: stageB!.id,
          name: 'Deal B Open',
          value: '7000',
          status: 'open',
        },
      ]);

      // Owner user for activities (unique email to avoid cross-test collisions)
      const [owner] = await testDb.db
        .insert(schema.users)
        .values({
          email: `u${Date.now()}.${Math.random().toString(36).slice(2, 4)}@x.com`,
          name: 'Owner',
        })
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
        {
          organizationId: orgA!.id,
          ownerUserId: owner!.id,
          contactId: contactForTaskA!.id,
          kind: 'task',
          body: 'Overdue A',
          status: 'open',
          dueAt: yesterday,
        },
        {
          organizationId: orgB!.id,
          ownerUserId: owner!.id,
          contactId: contactForTaskB!.id,
          kind: 'task',
          body: 'Overdue B',
          status: 'open',
          dueAt: yesterday,
        },
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

  describe('getDealsTrend', () => {
    it('groups won/lost deals by closedAt month, last 6 months', async () => {
      const [org] = await testDb.db
        .insert(schema.organizations)
        .values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' })
        .returning();
      const [pl] = await testDb.db
        .insert(schema.pipelines)
        .values({ organizationId: org!.id, name: 'P' })
        .returning();
      const [stage] = await testDb.db
        .insert(schema.pipelineStages)
        .values({ organizationId: org!.id, pipelineId: pl!.id, name: 'S', orderIndex: 0 })
        .returning();

      const thisMonth = new Date();
      thisMonth.setDate(15);
      const lastMonth = new Date(thisMonth);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const sevenMonthsAgo = new Date(thisMonth);
      sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);

      await testDb.db.insert(schema.deals).values([
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: stage!.id,
          name: 'W1',
          value: '1000',
          status: 'won',
          closedAt: thisMonth,
        },
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: stage!.id,
          name: 'W2',
          value: '2000',
          status: 'won',
          closedAt: thisMonth,
        },
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: stage!.id,
          name: 'L1',
          value: '500',
          status: 'lost',
          closedAt: lastMonth,
        },
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: stage!.id,
          name: 'OldW',
          value: '9999',
          status: 'won',
          closedAt: sevenMonthsAgo,
        }, // excluded
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: stage!.id,
          name: 'OpenSkip',
          value: '8888',
          status: 'open',
        }, // excluded
      ]);

      const repo = new ReportsRepo(testDb.db);
      const trend = await repo.getDealsTrend(org!.id);

      expect(trend).toHaveLength(6);
      const last = trend[5]!;
      expect(last.won).toBe(2);
      expect(last.wonValue).toBe('3000.00');
      const second = trend[4]!;
      expect(second.lost).toBe(1);
      expect(second.lostValue).toBe('500.00');
      // Older than 6 months should NOT appear — total wonValue across the 6
      // buckets equals 3000.00 from this month only.
      const totalWonValue = trend.reduce((acc, r) => acc + Number(r.wonValue), 0);
      expect(totalWonValue).toBe(3000);
    });
  });

  describe('getActivityVolume', () => {
    it('returns 8 weekly buckets, oldest → newest, zero-filled', async () => {
      const [org] = await testDb.db
        .insert(schema.organizations)
        .values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' })
        .returning();
      const [user] = await testDb.db
        .insert(schema.users)
        .values({
          email: `u${Date.now()}.${Math.random().toString(36).slice(2, 4)}@x.com`,
          name: 'U',
        })
        .returning();
      const [contact] = await testDb.db
        .insert(schema.contacts)
        .values({ organizationId: org!.id, firstName: 'Anchor' })
        .returning();

      const now = new Date();
      const lastWeek = new Date(now);
      lastWeek.setDate(now.getDate() - 4);
      const tenWeeksAgo = new Date(now);
      tenWeeksAgo.setDate(now.getDate() - 70);

      await testDb.db.insert(schema.activities).values([
        {
          organizationId: org!.id,
          ownerUserId: user!.id,
          contactId: contact!.id,
          kind: 'note',
          body: 'a',
          createdAt: now,
        },
        {
          organizationId: org!.id,
          ownerUserId: user!.id,
          contactId: contact!.id,
          kind: 'note',
          body: 'b',
          createdAt: now,
        },
        {
          organizationId: org!.id,
          ownerUserId: user!.id,
          contactId: contact!.id,
          kind: 'note',
          body: 'c',
          createdAt: lastWeek,
        },
        {
          organizationId: org!.id,
          ownerUserId: user!.id,
          contactId: contact!.id,
          kind: 'note',
          body: 'd',
          createdAt: tenWeeksAgo,
        }, // excluded
      ]);

      const repo = new ReportsRepo(testDb.db);
      const buckets = await repo.getActivityVolume(org!.id);
      expect(buckets).toHaveLength(8);
      const total = buckets.reduce((acc, b) => acc + b.count, 0);
      expect(total).toBe(3); // ten-weeks-ago dropped
    });
  });

  describe('getPipelineByStage', () => {
    it('groups open deals by stage and sums value', async () => {
      const [org] = await testDb.db
        .insert(schema.organizations)
        .values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' })
        .returning();
      const [pl] = await testDb.db
        .insert(schema.pipelines)
        .values({ organizationId: org!.id, name: 'Sales' })
        .returning();
      const [s1] = await testDb.db
        .insert(schema.pipelineStages)
        .values({ organizationId: org!.id, pipelineId: pl!.id, name: 'Lead', orderIndex: 0 })
        .returning();
      const [s2] = await testDb.db
        .insert(schema.pipelineStages)
        .values({ organizationId: org!.id, pipelineId: pl!.id, name: 'Negotiation', orderIndex: 1 })
        .returning();

      await testDb.db.insert(schema.deals).values([
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: s1!.id,
          name: 'D1',
          value: '10000',
          status: 'open',
        },
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: s1!.id,
          name: 'D2',
          value: '5000',
          status: 'open',
        },
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: s2!.id,
          name: 'D3',
          value: '40000',
          status: 'open',
        },
        {
          organizationId: org!.id,
          pipelineId: pl!.id,
          stageId: s2!.id,
          name: 'D4-won',
          value: '99999',
          status: 'won',
        }, // excluded
      ]);

      const repo = new ReportsRepo(testDb.db);
      const rows = await repo.getPipelineByStage(org!.id);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ stageName: 'Lead', value: '15000.00', dealCount: 2 });
      expect(rows[1]).toMatchObject({ stageName: 'Negotiation', value: '40000.00', dealCount: 1 });
    });

    it('omits stages with no open deals', async () => {
      const [org] = await testDb.db
        .insert(schema.organizations)
        .values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' })
        .returning();
      const [pl] = await testDb.db
        .insert(schema.pipelines)
        .values({ organizationId: org!.id, name: 'P' })
        .returning();
      await testDb.db
        .insert(schema.pipelineStages)
        .values({ organizationId: org!.id, pipelineId: pl!.id, name: 'Empty', orderIndex: 0 });

      const repo = new ReportsRepo(testDb.db);
      expect(await repo.getPipelineByStage(org!.id)).toEqual([]);
    });
  });

  describe('getTopOpenDeals', () => {
    it('returns up to 5 open deals sorted by value desc with stage and company joined', async () => {
      const [org] = await testDb.db
        .insert(schema.organizations)
        .values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' })
        .returning();
      const [pl] = await testDb.db
        .insert(schema.pipelines)
        .values({ organizationId: org!.id, name: 'P' })
        .returning();
      const [stage] = await testDb.db
        .insert(schema.pipelineStages)
        .values({ organizationId: org!.id, pipelineId: pl!.id, name: 'Negotiation', orderIndex: 0 })
        .returning();
      const [company] = await testDb.db
        .insert(schema.companies)
        .values({ organizationId: org!.id, name: 'Acme' })
        .returning();

      const baseDeal = {
        organizationId: org!.id,
        pipelineId: pl!.id,
        stageId: stage!.id,
        status: 'open' as const,
      };
      await testDb.db.insert(schema.deals).values([
        { ...baseDeal, name: 'Top', value: '100000', companyId: company!.id },
        { ...baseDeal, name: 'Mid1', value: '50000' },
        { ...baseDeal, name: 'Mid2', value: '40000' },
        { ...baseDeal, name: 'Mid3', value: '30000' },
        { ...baseDeal, name: 'Mid4', value: '20000' },
        { ...baseDeal, name: 'Skip', value: '10000' }, // 6th — should be cut
        { ...baseDeal, name: 'Won', value: '99999', status: 'won' }, // excluded
      ]);

      const repo = new ReportsRepo(testDb.db);
      const rows = await repo.getTopOpenDeals(org!.id);
      expect(rows).toHaveLength(5);
      expect(rows[0]).toMatchObject({
        name: 'Top',
        value: '100000.00',
        stageName: 'Negotiation',
        companyName: 'Acme',
      });
      expect(rows[1]!.name).toBe('Mid1');
      expect(rows[4]!.name).toBe('Mid4');
      expect(rows.find((r) => r.name === 'Skip')).toBeUndefined();
    });
  });
});
