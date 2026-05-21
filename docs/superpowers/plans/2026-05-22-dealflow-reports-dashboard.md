# Reports & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the placeholder `/app` home page into a real CEO-facing dashboard that surfaces pipeline value, deal trends, activity volume, top open deals, and KPI tiles — using a single aggregate endpoint backed by SQL group-by queries on existing tables.

**Architecture:** New `reports` module on the API (`apps/api/src/modules/reports/`) exposes one endpoint, `GET /api/v1/reports/dashboard`, that returns every widget's data in a single round trip. A `ReportsRepo` does the aggregate work in pure Drizzle/SQL — no new tables, no new infra. On the web, a new `/app/dashboard` route renders KPI tiles + recharts-powered charts using a single TanStack Query call; the old `/app/` index redirects to it and the sidebar gets a "Dashboard" entry at the top.

**Tech Stack:** Fastify 5, Drizzle ORM (Postgres aggregates: `count`, `sum`, `date_trunc`, `filter`), Zod schemas in `@dealflow/shared`, React 19 + TanStack Router + TanStack Query, **recharts** (new dep — bar / line / area / sparkline), Tailwind v4, shadcn primitives.

---

## File Structure

**Backend (`apps/api`):**
- Create `src/modules/reports/reports.repo.ts` — aggregate queries, one method per widget
- Create `src/modules/reports/routes.ts` — registers `GET /api/v1/reports/dashboard`
- Create `test/modules/reports/routes.test.ts` — endpoint + repo integration tests
- Modify `src/server.ts` — register reports routes alongside other modules

**Shared (`packages/shared`):**
- Create `src/reports.ts` — `DashboardResponse` Zod schema + types
- Create `src/reports.test.ts` — schema parse tests
- Modify `src/index.ts` — re-export reports

**Frontend (`apps/web`):**
- Create `src/features/dashboard/api.ts` — `useDashboard()` hook
- Create `src/features/dashboard/kpi-tile.tsx` — small card primitive
- Create `src/features/dashboard/pipeline-value-chart.tsx` — bar chart
- Create `src/features/dashboard/deals-trend-chart.tsx` — won/lost line chart
- Create `src/features/dashboard/activity-sparkline.tsx` — area sparkline
- Create `src/features/dashboard/top-deals-list.tsx` — top-5 list
- Create `src/routes/app.dashboard.tsx` — page that composes the widgets
- Modify `src/routes/app.index.tsx` — redirect `/app/` → `/app/dashboard`
- Modify `src/routes/app.tsx` — add "Dashboard" link to sidebar (top)
- Modify `src/lib/query-keys.ts` — add `reports.dashboard` key
- Modify `package.json` — add `recharts` dependency

Files split by widget so each chart is small and self-contained. The page composes them. The repo holds *all* aggregate SQL because the queries share table joins and it keeps the endpoint authoritative.

---

## Task 1: Shared schemas for the dashboard response

**Files:**
- Create: `packages/shared/src/reports.ts`
- Create: `packages/shared/src/reports.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing schema tests**

Create `packages/shared/src/reports.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { dashboardResponseSchema } from './reports.js';

describe('dashboardResponseSchema', () => {
  const valid = {
    kpis: {
      totalContacts: 12,
      totalCompanies: 3,
      openDeals: 7,
      openPipelineValue: '125000.00',
      overdueTasks: 2,
      currency: 'USD',
    },
    pipelineByStage: [
      { stageId: '11111111-1111-1111-1111-111111111111', stageName: 'Lead', value: '40000.00', dealCount: 4 },
    ],
    dealsTrend: [
      { month: '2026-01-01', won: 2, lost: 1, wonValue: '50000.00', lostValue: '12000.00' },
    ],
    activityVolume: [{ weekStart: '2026-01-06', count: 8 }],
    topOpenDeals: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Acme renewal',
        value: '80000.00',
        currency: 'USD',
        stageName: 'Negotiation',
        companyName: 'Acme',
      },
    ],
  };

  it('accepts a valid dashboard payload', () => {
    expect(() => dashboardResponseSchema.parse(valid)).not.toThrow();
  });

  it('rejects negative KPI counts', () => {
    expect(() =>
      dashboardResponseSchema.parse({ ...valid, kpis: { ...valid.kpis, totalContacts: -1 } }),
    ).toThrow();
  });

  it('allows companyName to be null on top-deal rows', () => {
    const v = { ...valid, topOpenDeals: [{ ...valid.topOpenDeals[0]!, companyName: null }] };
    expect(() => dashboardResponseSchema.parse(v)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test — expect MODULE NOT FOUND**

Run: `pnpm --filter @dealflow/shared test -- reports`
Expected: FAIL with "Cannot find module './reports.js'"

- [ ] **Step 3: Implement the schemas**

Create `packages/shared/src/reports.ts`:

```typescript
import { z } from 'zod';

/**
 * `value` fields are numeric strings (Postgres numeric → string in Drizzle).
 * Keeping them as strings on the wire means no float drift; the UI formats
 * them with the org currency. Counts are plain ints.
 */
export const dashboardKpisSchema = z.object({
  totalContacts: z.number().int().nonnegative(),
  totalCompanies: z.number().int().nonnegative(),
  openDeals: z.number().int().nonnegative(),
  openPipelineValue: z.string(),
  overdueTasks: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3),
});

export const pipelineByStageRowSchema = z.object({
  stageId: z.string().uuid(),
  stageName: z.string(),
  value: z.string(),
  dealCount: z.number().int().nonnegative(),
});

export const dealsTrendRowSchema = z.object({
  /** ISO date string for the first day of the month, e.g. '2026-01-01'. */
  month: z.string(),
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  wonValue: z.string(),
  lostValue: z.string(),
});

export const activityVolumeRowSchema = z.object({
  /** ISO date string for the Monday of the week. */
  weekStart: z.string(),
  count: z.number().int().nonnegative(),
});

export const topOpenDealRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  value: z.string(),
  currency: z.string().min(3).max(3),
  stageName: z.string(),
  companyName: z.string().nullable(),
});

export const dashboardResponseSchema = z.object({
  kpis: dashboardKpisSchema,
  pipelineByStage: z.array(pipelineByStageRowSchema),
  dealsTrend: z.array(dealsTrendRowSchema),
  activityVolume: z.array(activityVolumeRowSchema),
  topOpenDeals: z.array(topOpenDealRowSchema),
});

export type DashboardKpis = z.infer<typeof dashboardKpisSchema>;
export type PipelineByStageRow = z.infer<typeof pipelineByStageRowSchema>;
export type DealsTrendRow = z.infer<typeof dealsTrendRowSchema>;
export type ActivityVolumeRow = z.infer<typeof activityVolumeRowSchema>;
export type TopOpenDealRow = z.infer<typeof topOpenDealRowSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
```

- [ ] **Step 4: Re-export from shared index**

Edit `packages/shared/src/index.ts` — add as the last line:

```typescript
export * from './reports.js';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @dealflow/shared test -- reports`
Expected: PASS — 3/3.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/reports.ts packages/shared/src/reports.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add reports dashboard response schemas"
```

---

## Task 2: ReportsRepo + KPI tile queries (TDD)

**Files:**
- Create: `apps/api/src/modules/reports/reports.repo.ts`
- Create: `apps/api/test/modules/reports/reports.repo.test.ts`

- [ ] **Step 1: Write failing tests for the KPI tile aggregate**

Create `apps/api/test/modules/reports/reports.repo.test.ts`:

```typescript
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
```

> **Note on fixtures:** `organizations` requires a unique `slug` (NOT NULL UNIQUE). The `slug()` helper above generates one per test. Currency lives on `defaultCurrency`. The contacts table uses `firstName` (the legacy CRM "first/last" split), not `name`.

- [ ] **Step 2: Run — expect MODULE NOT FOUND**

Run: `pnpm --filter @dealflow/api test -- reports`
Expected: FAIL ("Cannot find module './reports.repo.js'").

- [ ] **Step 3: Implement getKpis**

Create `apps/api/src/modules/reports/reports.repo.ts`:

```typescript
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { DashboardKpis } from '@dealflow/shared';

export class ReportsRepo {
  constructor(private readonly db: Database) {}

  /**
   * Returns the five KPI numbers for the dashboard top strip.
   * All counts are scoped to `organizationId`. `openPipelineValue` is the
   * sum of `deals.value` where `status = 'open'` — Postgres returns NULL
   * for an empty sum, which we coerce to '0.00' so the UI never sees null.
   */
  async getKpis(organizationId: string): Promise<DashboardKpis> {
    // Pull the org's default currency so the dashboard can render values
    // without a second round-trip.
    const [org] = await this.db
      .select({ defaultCurrency: schema.organizations.defaultCurrency })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);
    const currency = org?.defaultCurrency ?? 'USD';

    const [contactsRow] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.contacts)
      .where(eq(schema.contacts.organizationId, organizationId));

    const [companiesRow] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.companies)
      .where(eq(schema.companies.organizationId, organizationId));

    const [dealsRow] = await this.db
      .select({
        c: sql<number>`count(*)::int`,
        v: sql<string>`coalesce(sum(${schema.deals.value}), 0)::text`,
      })
      .from(schema.deals)
      .where(
        and(eq(schema.deals.organizationId, organizationId), eq(schema.deals.status, 'open')),
      );

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [tasksRow] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.organizationId, organizationId),
          eq(schema.activities.kind, 'task'),
          eq(schema.activities.status, 'open'),
          isNotNull(schema.activities.dueAt),
          lt(schema.activities.dueAt, startOfToday),
        ),
      );

    return {
      totalContacts: contactsRow?.c ?? 0,
      totalCompanies: companiesRow?.c ?? 0,
      openDeals: dealsRow?.c ?? 0,
      openPipelineValue: normalizeMoney(dealsRow?.v ?? '0'),
      overdueTasks: tasksRow?.c ?? 0,
      currency,
    };
  }
}

/**
 * Postgres returns sums as plain '0' or '12345.6'. Normalize to
 * fixed-2 string ('0.00', '12345.60') so the UI sees one consistent shape.
 */
function normalizeMoney(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter @dealflow/api test -- reports.repo`
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports/reports.repo.ts apps/api/test/modules/reports/reports.repo.test.ts
git commit -m "feat(api): ReportsRepo.getKpis with org-scoped aggregates"
```

---

## Task 3: Pipeline value grouped by stage

**Files:**
- Modify: `apps/api/src/modules/reports/reports.repo.ts`
- Modify: `apps/api/test/modules/reports/reports.repo.test.ts`

- [ ] **Step 1: Append a failing test**

Add to `reports.repo.test.ts`:

```typescript
describe('ReportsRepo.getPipelineByStage', () => {
  let pg: TestPostgres;
  beforeEach(async () => { pg = await startTestPostgres(); });
  afterEach(async () => { await pg.stop(); });

  const slug = () => `org-${Math.random().toString(36).slice(2, 8)}`;

  it('groups open deals by stage and sums value', async () => {
    const [org] = await pg.db.insert(schema.organizations).values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' }).returning();
    const [pl] = await pg.db.insert(schema.pipelines).values({ organizationId: org!.id, name: 'Sales' }).returning();
    const [s1] = await pg.db.insert(schema.pipelineStages).values({ organizationId: org!.id, pipelineId: pl!.id, name: 'Lead', orderIndex: 0 }).returning();
    const [s2] = await pg.db.insert(schema.pipelineStages).values({ organizationId: org!.id, pipelineId: pl!.id, name: 'Negotiation', orderIndex: 1 }).returning();

    await pg.db.insert(schema.deals).values([
      { organizationId: org!.id, pipelineId: pl!.id, stageId: s1!.id, name: 'D1', value: '10000', status: 'open' },
      { organizationId: org!.id, pipelineId: pl!.id, stageId: s1!.id, name: 'D2', value: '5000', status: 'open' },
      { organizationId: org!.id, pipelineId: pl!.id, stageId: s2!.id, name: 'D3', value: '40000', status: 'open' },
      { organizationId: org!.id, pipelineId: pl!.id, stageId: s2!.id, name: 'D4-won', value: '99999', status: 'won' }, // excluded
    ]);

    const repo = new ReportsRepo(pg.db);
    const rows = await repo.getPipelineByStage(org!.id);

    // Sorted by stage orderIndex
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ stageName: 'Lead', value: '15000.00', dealCount: 2 });
    expect(rows[1]).toMatchObject({ stageName: 'Negotiation', value: '40000.00', dealCount: 1 });
  });

  it('omits stages with no open deals', async () => {
    const [org] = await pg.db.insert(schema.organizations).values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' }).returning();
    const [pl] = await pg.db.insert(schema.pipelines).values({ organizationId: org!.id, name: 'P' }).returning();
    await pg.db.insert(schema.pipelineStages).values({ organizationId: org!.id, pipelineId: pl!.id, name: 'Empty', orderIndex: 0 });

    const repo = new ReportsRepo(pg.db);
    expect(await repo.getPipelineByStage(org!.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL ("getPipelineByStage is not a function")**

Run: `pnpm --filter @dealflow/api test -- reports.repo`

- [ ] **Step 3: Implement the method**

In `reports.repo.ts`, add the import `import type { PipelineByStageRow } from '@dealflow/shared';` at the top (alongside `DashboardKpis`), and append inside the class:

```typescript
  /**
   * Returns one row per stage that has at least one open deal in this org,
   * with the stage name, total open-deal value, and deal count. Sorted by
   * the stage's pipeline `orderIndex` so the UI can render left-to-right.
   */
  async getPipelineByStage(organizationId: string): Promise<PipelineByStageRow[]> {
    const rows = await this.db
      .select({
        stageId: schema.pipelineStages.id,
        stageName: schema.pipelineStages.name,
        orderIndex: schema.pipelineStages.orderIndex,
        value: sql<string>`coalesce(sum(${schema.deals.value}), 0)::text`,
        dealCount: sql<number>`count(${schema.deals.id})::int`,
      })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.deals.stageId))
      .where(
        and(eq(schema.deals.organizationId, organizationId), eq(schema.deals.status, 'open')),
      )
      .groupBy(schema.pipelineStages.id, schema.pipelineStages.name, schema.pipelineStages.orderIndex)
      .orderBy(schema.pipelineStages.orderIndex);

    return rows.map((r) => ({
      stageId: r.stageId,
      stageName: r.stageName,
      value: normalizeMoney(r.value),
      dealCount: r.dealCount,
    }));
  }
```

- [ ] **Step 4: Run — verify all reports tests pass**

Run: `pnpm --filter @dealflow/api test -- reports.repo`
Expected: PASS — 4/4 across both describe blocks.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports/reports.repo.ts apps/api/test/modules/reports/reports.repo.test.ts
git commit -m "feat(api): ReportsRepo.getPipelineByStage"
```

---

## Task 4: Deals won/lost trend per month (last 6 months)

**Files:**
- Modify: `apps/api/src/modules/reports/reports.repo.ts`
- Modify: `apps/api/test/modules/reports/reports.repo.test.ts`

- [ ] **Step 1: Append a failing test**

Add to `reports.repo.test.ts`:

```typescript
describe('ReportsRepo.getDealsTrend', () => {
  let pg: TestPostgres;
  beforeEach(async () => { pg = await startTestPostgres(); });
  afterEach(async () => { await pg.stop(); });

  const slug = () => `org-${Math.random().toString(36).slice(2, 8)}`;

  it('groups won/lost deals by closedAt month, last 6 months', async () => {
    const [org] = await pg.db.insert(schema.organizations).values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' }).returning();
    const [pl] = await pg.db.insert(schema.pipelines).values({ organizationId: org!.id, name: 'P' }).returning();
    const [stage] = await pg.db.insert(schema.pipelineStages).values({ organizationId: org!.id, pipelineId: pl!.id, name: 'S', orderIndex: 0 }).returning();

    const thisMonth = new Date();
    thisMonth.setDate(15);
    const lastMonth = new Date(thisMonth);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const sevenMonthsAgo = new Date(thisMonth);
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);

    await pg.db.insert(schema.deals).values([
      { organizationId: org!.id, pipelineId: pl!.id, stageId: stage!.id, name: 'W1', value: '1000', status: 'won', closedAt: thisMonth },
      { organizationId: org!.id, pipelineId: pl!.id, stageId: stage!.id, name: 'W2', value: '2000', status: 'won', closedAt: thisMonth },
      { organizationId: org!.id, pipelineId: pl!.id, stageId: stage!.id, name: 'L1', value: '500', status: 'lost', closedAt: lastMonth },
      { organizationId: org!.id, pipelineId: pl!.id, stageId: stage!.id, name: 'OldW', value: '9999', status: 'won', closedAt: sevenMonthsAgo }, // excluded
      { organizationId: org!.id, pipelineId: pl!.id, stageId: stage!.id, name: 'OpenSkip', value: '8888', status: 'open' }, // excluded
    ]);

    const repo = new ReportsRepo(pg.db);
    const trend = await repo.getDealsTrend(org!.id);

    // Always 6 buckets (oldest → newest), zero-filled.
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
```

- [ ] **Step 2: Run — expect FAIL ("getDealsTrend is not a function")**

Run: `pnpm --filter @dealflow/api test -- reports.repo`

- [ ] **Step 3: Implement the method**

In `reports.repo.ts`, add `DealsTrendRow` to the shared imports and `gte` to drizzle imports, then append inside the class:

```typescript
  /**
   * Returns 6 rows — one per month, oldest first — with won/lost counts
   * and value sums. Months with no closes still appear (zero-filled) so the
   * line chart has a continuous x-axis. Buckets are computed in JS rather
   * than `generate_series` to stay portable across DB versions.
   */
  async getDealsTrend(organizationId: string): Promise<DealsTrendRow[]> {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1); // first day of bucket 0

    const rows = await this.db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${schema.deals.closedAt}), 'YYYY-MM-DD')`,
        status: schema.deals.status,
        count: sql<number>`count(*)::int`,
        value: sql<string>`coalesce(sum(${schema.deals.value}), 0)::text`,
      })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.organizationId, organizationId),
          isNotNull(schema.deals.closedAt),
          gte(schema.deals.closedAt, sixMonthsAgo),
          // status is 'won' or 'lost' — open deals filtered out by isNotNull(closedAt)
        ),
      )
      .groupBy(
        sql`date_trunc('month', ${schema.deals.closedAt})`,
        schema.deals.status,
      );

    // Zero-fill into a 6-bucket array indexed oldest → newest.
    const buckets: DealsTrendRow[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      buckets.push({
        month: d.toISOString().slice(0, 10),
        won: 0,
        lost: 0,
        wonValue: '0.00',
        lostValue: '0.00',
      });
    }
    const byMonth = new Map(buckets.map((b) => [b.month, b]));

    for (const r of rows) {
      const b = byMonth.get(r.month);
      if (!b) continue; // dropped: outside the 6-month window
      if (r.status === 'won') {
        b.won = r.count;
        b.wonValue = normalizeMoney(r.value);
      } else if (r.status === 'lost') {
        b.lost = r.count;
        b.lostValue = normalizeMoney(r.value);
      }
    }
    return buckets;
  }
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- reports.repo`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports/reports.repo.ts apps/api/test/modules/reports/reports.repo.test.ts
git commit -m "feat(api): ReportsRepo.getDealsTrend last 6 months, zero-filled"
```

---

## Task 5: Activity volume per week (last 8 weeks)

**Files:**
- Modify: `apps/api/src/modules/reports/reports.repo.ts`
- Modify: `apps/api/test/modules/reports/reports.repo.test.ts`

- [ ] **Step 1: Append a failing test**

Add to `reports.repo.test.ts`:

```typescript
describe('ReportsRepo.getActivityVolume', () => {
  let pg: TestPostgres;
  beforeEach(async () => { pg = await startTestPostgres(); });
  afterEach(async () => { await pg.stop(); });

  const slug = () => `org-${Math.random().toString(36).slice(2, 8)}`;

  it('returns 8 weekly buckets, oldest → newest, zero-filled', async () => {
    const [org] = await pg.db.insert(schema.organizations).values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' }).returning();
    const [user] = await pg.db.insert(schema.users).values({ email: `u${Date.now()}@x.com`, name: 'U', passwordHash: 'x' }).returning();

    const now = new Date();
    const lastWeek = new Date(now); lastWeek.setDate(now.getDate() - 4);
    const tenWeeksAgo = new Date(now); tenWeeksAgo.setDate(now.getDate() - 70);

    await pg.db.insert(schema.activities).values([
      { organizationId: org!.id, ownerUserId: user!.id, kind: 'note', body: 'a', createdAt: now },
      { organizationId: org!.id, ownerUserId: user!.id, kind: 'note', body: 'b', createdAt: now },
      { organizationId: org!.id, ownerUserId: user!.id, kind: 'note', body: 'c', createdAt: lastWeek },
      { organizationId: org!.id, ownerUserId: user!.id, kind: 'note', body: 'd', createdAt: tenWeeksAgo }, // excluded
    ]);

    const repo = new ReportsRepo(pg.db);
    const buckets = await repo.getActivityVolume(org!.id);
    expect(buckets).toHaveLength(8);
    const total = buckets.reduce((acc, b) => acc + b.count, 0);
    expect(total).toBe(3); // ten-weeks-ago dropped
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @dealflow/api test -- reports.repo`

- [ ] **Step 3: Implement the method**

Add `ActivityVolumeRow` to the shared imports, then append inside the class:

```typescript
  /**
   * Returns 8 weekly buckets (Monday-aligned), oldest first, zero-filled.
   * `weekStart` is the ISO date string of that bucket's Monday so the
   * sparkline can use it as both key and x-axis label.
   */
  async getActivityVolume(organizationId: string): Promise<ActivityVolumeRow[]> {
    // Monday of "this week" — Postgres `date_trunc('week', ...)` is
    // Monday-aligned, so we mirror that in JS.
    const now = new Date();
    const day = now.getDay(); // 0=Sun..6=Sat
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
    const oldestMonday = new Date(thisMonday); oldestMonday.setDate(oldestMonday.getDate() - 7 * 7); // 7 weeks back = 8 buckets

    const rows = await this.db
      .select({
        weekStart: sql<string>`to_char(date_trunc('week', ${schema.activities.createdAt}), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.organizationId, organizationId),
          gte(schema.activities.createdAt, oldestMonday),
        ),
      )
      .groupBy(sql`date_trunc('week', ${schema.activities.createdAt})`);

    const buckets: ActivityVolumeRow[] = [];
    for (let i = 0; i < 8; i++) {
      const d = new Date(oldestMonday); d.setDate(d.getDate() + 7 * i);
      buckets.push({ weekStart: d.toISOString().slice(0, 10), count: 0 });
    }
    const byWeek = new Map(buckets.map((b) => [b.weekStart, b]));
    for (const r of rows) {
      const b = byWeek.get(r.weekStart);
      if (b) b.count = r.count;
    }
    return buckets;
  }
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- reports.repo`
Expected: PASS — 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports/reports.repo.ts apps/api/test/modules/reports/reports.repo.test.ts
git commit -m "feat(api): ReportsRepo.getActivityVolume 8-week sparkline data"
```

---

## Task 6: Top 5 open deals by value

**Files:**
- Modify: `apps/api/src/modules/reports/reports.repo.ts`
- Modify: `apps/api/test/modules/reports/reports.repo.test.ts`

- [ ] **Step 1: Append a failing test**

Add to `reports.repo.test.ts`:

```typescript
describe('ReportsRepo.getTopOpenDeals', () => {
  let pg: TestPostgres;
  beforeEach(async () => { pg = await startTestPostgres(); });
  afterEach(async () => { await pg.stop(); });

  const slug = () => `org-${Math.random().toString(36).slice(2, 8)}`;

  it('returns up to 5 open deals sorted by value desc with stage and company joined', async () => {
    const [org] = await pg.db.insert(schema.organizations).values({ name: 'Co', slug: slug(), defaultCurrency: 'USD' }).returning();
    const [pl] = await pg.db.insert(schema.pipelines).values({ organizationId: org!.id, name: 'P' }).returning();
    const [stage] = await pg.db.insert(schema.pipelineStages).values({ organizationId: org!.id, pipelineId: pl!.id, name: 'Negotiation', orderIndex: 0 }).returning();
    const [company] = await pg.db.insert(schema.companies).values({ organizationId: org!.id, name: 'Acme' }).returning();

    const baseDeal = { organizationId: org!.id, pipelineId: pl!.id, stageId: stage!.id, status: 'open' as const };
    await pg.db.insert(schema.deals).values([
      { ...baseDeal, name: 'Top', value: '100000', companyId: company!.id },
      { ...baseDeal, name: 'Mid1', value: '50000' },
      { ...baseDeal, name: 'Mid2', value: '40000' },
      { ...baseDeal, name: 'Mid3', value: '30000' },
      { ...baseDeal, name: 'Mid4', value: '20000' },
      { ...baseDeal, name: 'Skip', value: '10000' }, // 6th — should be cut
      { ...baseDeal, name: 'Won', value: '99999', status: 'won' }, // excluded
    ]);

    const repo = new ReportsRepo(pg.db);
    const rows = await repo.getTopOpenDeals(org!.id);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ name: 'Top', value: '100000.00', stageName: 'Negotiation', companyName: 'Acme' });
    expect(rows[1]!.name).toBe('Mid1');
    expect(rows[4]!.name).toBe('Mid4');
    expect(rows.find((r) => r.name === 'Skip')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @dealflow/api test -- reports.repo`

- [ ] **Step 3: Implement the method**

Add `TopOpenDealRow` to the shared imports plus `desc` and `leftJoin` capability (drizzle's `leftJoin` is a method on the query, not an import). Add `desc` to the drizzle imports. Then append inside the class:

```typescript
  /**
   * Top 5 open deals by value, descending. Includes stage name and (optional)
   * company name for the UI list. `companyName` is null when the deal isn't
   * attached to a company.
   */
  async getTopOpenDeals(organizationId: string): Promise<TopOpenDealRow[]> {
    const rows = await this.db
      .select({
        id: schema.deals.id,
        name: schema.deals.name,
        value: schema.deals.value,
        currency: schema.deals.currency,
        stageName: schema.pipelineStages.name,
        companyName: schema.companies.name,
      })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.deals.stageId))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.deals.companyId))
      .where(
        and(eq(schema.deals.organizationId, organizationId), eq(schema.deals.status, 'open')),
      )
      .orderBy(desc(schema.deals.value))
      .limit(5);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      value: normalizeMoney(r.value ?? '0'),
      currency: r.currency,
      stageName: r.stageName,
      companyName: r.companyName,
    }));
  }
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- reports.repo`
Expected: PASS — 7/7.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports/reports.repo.ts apps/api/test/modules/reports/reports.repo.test.ts
git commit -m "feat(api): ReportsRepo.getTopOpenDeals with stage + company joins"
```

---

## Task 7: GET /api/v1/reports/dashboard route + server wiring

**Files:**
- Create: `apps/api/src/modules/reports/routes.ts`
- Create: `apps/api/test/modules/reports/routes.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write a failing endpoint test**

Create `apps/api/test/modules/reports/routes.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestPostgres } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import { dashboardResponseSchema } from '@dealflow/shared';

describe('GET /api/v1/reports/dashboard', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  beforeEach(async () => {
    pg = await startTestPostgres();
    app = await buildTestApp({ db: pg.db });
  });
  afterEach(async () => {
    await app.close();
    await pg.stop();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/dashboard' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a schema-valid payload for an authed empty org', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/dashboard',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Schema parse asserts shape — counts will all be zero/empty.
    expect(() => dashboardResponseSchema.parse(body)).not.toThrow();
    expect(body.kpis.totalContacts).toBe(0);
    expect(body.pipelineByStage).toEqual([]);
    expect(body.dealsTrend).toHaveLength(6);
    expect(body.activityVolume).toHaveLength(8);
    expect(body.topOpenDeals).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (404, route not registered)**

Run: `pnpm --filter @dealflow/api test -- reports/routes`

- [ ] **Step 3: Implement the route module**

Create `apps/api/src/modules/reports/routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import type { Database } from '@dealflow/db';
import type { DashboardResponse } from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ReportsRepo } from './reports.repo.js';

export interface ReportsRoutesDeps {
  db: Database;
}

export async function registerReportsRoutes(
  app: FastifyInstance,
  deps: ReportsRoutesDeps,
): Promise<void> {
  const repo = new ReportsRepo(deps.db);

  app.get('/api/v1/reports/dashboard', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    // Run all aggregates concurrently — they're independent reads, and the
    // dashboard wants them all before paint anyway.
    const [kpis, pipelineByStage, dealsTrend, activityVolume, topOpenDeals] = await Promise.all([
      repo.getKpis(orgId),
      repo.getPipelineByStage(orgId),
      repo.getDealsTrend(orgId),
      repo.getActivityVolume(orgId),
      repo.getTopOpenDeals(orgId),
    ]);
    const payload: DashboardResponse = {
      kpis,
      pipelineByStage,
      dealsTrend,
      activityVolume,
      topOpenDeals,
    };
    return reply.send(payload);
  });
}
```

- [ ] **Step 4: Register the route in server.ts**

Edit `apps/api/src/server.ts`. Find the block that ends with `registerIntegrationsRoutes` (around line 96) and add immediately after:

```typescript
    const { registerReportsRoutes } = await import('./modules/reports/routes.js');
    await registerReportsRoutes(app, { db: opts.db });
```

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- reports/routes`
Expected: PASS — 2/2.

- [ ] **Step 6: Run the full API suite as a regression check**

Run: `pnpm --filter @dealflow/api test`
Expected: All previously-passing tests still pass; reports tests pass. (If `tasks.routes.test.ts` shows known date-boundary flakiness, log it but don't block — it's pre-existing.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/reports/routes.ts apps/api/test/modules/reports/routes.test.ts apps/api/src/server.ts
git commit -m "feat(api): GET /api/v1/reports/dashboard endpoint"
```

---

## Task 8: Frontend — recharts dep + dashboard API hook + KPI tile

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/features/dashboard/api.ts`
- Create: `apps/web/src/features/dashboard/kpi-tile.tsx`

- [ ] **Step 1: Add recharts**

Run: `pnpm --filter @dealflow/web add recharts@^2.13.0`
Expected: package.json updated, lockfile updated.

- [ ] **Step 2: Add the query key**

Edit `apps/web/src/lib/query-keys.ts`. Append a `reports` entry to the exported object before the closing brace:

```typescript
  reports: {
    dashboard: ['reports', 'dashboard'] as const,
  },
```

- [ ] **Step 3: Add the API hook**

Create `apps/web/src/features/dashboard/api.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import type { DashboardResponse } from '@dealflow/shared';
import { queryKeys } from '@/lib/query-keys';

async function fetchDashboard(): Promise<DashboardResponse> {
  const res = await fetch('/api/v1/reports/dashboard', { credentials: 'include' });
  if (!res.ok) throw new Error(`Dashboard request failed: ${res.status}`);
  return (await res.json()) as DashboardResponse;
}

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.reports.dashboard,
    queryFn: fetchDashboard,
    // The page is the home — let it re-fetch when the tab regains focus, but
    // don't hammer the API on every navigation. 30s stale is plenty for a
    // CEO dashboard.
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: Add the KPI tile primitive**

Create `apps/web/src/features/dashboard/kpi-tile.tsx`:

```tsx
interface KpiTileProps {
  label: string;
  value: string | number;
  hint?: string;
  /** Visually de-emphasise zero values so an empty org doesn't shout. */
  dim?: boolean;
}

export function KpiTile({ label, value, hint, dim }: KpiTileProps) {
  return (
    <div
      className="rounded-md border border-neutral-200 bg-white p-4"
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          dim ? 'text-neutral-400' : 'text-neutral-900'
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: PASS — no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/query-keys.ts apps/web/src/features/dashboard/api.ts apps/web/src/features/dashboard/kpi-tile.tsx
git commit -m "feat(web): dashboard query hook + KPI tile + recharts dep"
```

---

## Task 9: Frontend — chart components and top-deals list

**Files:**
- Create: `apps/web/src/features/dashboard/pipeline-value-chart.tsx`
- Create: `apps/web/src/features/dashboard/deals-trend-chart.tsx`
- Create: `apps/web/src/features/dashboard/activity-sparkline.tsx`
- Create: `apps/web/src/features/dashboard/top-deals-list.tsx`

- [ ] **Step 1: Pipeline value bar chart**

Create `apps/web/src/features/dashboard/pipeline-value-chart.tsx`:

```tsx
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PipelineByStageRow } from '@dealflow/shared';

interface Props {
  rows: PipelineByStageRow[];
  currency: string;
}

export function PipelineValueChart({ rows, currency }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-neutral-200 text-sm text-neutral-400">
        No open deals yet
      </div>
    );
  }
  const data = rows.map((r) => ({ stage: r.stageName, value: Number(r.value), count: r.dealCount }));
  return (
    <div className="h-56 w-full" data-testid="pipeline-value-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="stage" tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => formatCompact(v, currency)} />
          <Tooltip
            formatter={(v: number) => formatMoney(v, currency)}
            labelClassName="text-xs"
            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
          />
          <Bar dataKey="value" fill="#0f172a" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatMoney(v: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}
function formatCompact(v: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(v);
}
```

- [ ] **Step 2: Deals trend line chart**

Create `apps/web/src/features/dashboard/deals-trend-chart.tsx`:

```tsx
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DealsTrendRow } from '@dealflow/shared';

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'short' });

export function DealsTrendChart({ rows }: { rows: DealsTrendRow[] }) {
  const data = rows.map((r) => ({
    month: MONTH_FMT.format(new Date(r.month)),
    won: r.won,
    lost: r.lost,
  }));
  return (
    <div className="h-56 w-full" data-testid="deals-trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="won" stroke="#16a34a" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="lost" stroke="#dc2626" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Activity sparkline**

Create `apps/web/src/features/dashboard/activity-sparkline.tsx`:

```tsx
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ActivityVolumeRow } from '@dealflow/shared';

export function ActivitySparkline({ rows }: { rows: ActivityVolumeRow[] }) {
  const data = rows.map((r) => ({ week: r.weekStart, count: r.count }));
  return (
    <div className="h-20 w-full" data-testid="activity-sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <Tooltip
            formatter={(v: number) => [`${v} activities`, '']}
            labelFormatter={(l: string) => `Week of ${l}`}
            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
          />
          <Area type="monotone" dataKey="count" stroke="#0f172a" fill="#0f172a" fillOpacity={0.15} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Top deals list**

Create `apps/web/src/features/dashboard/top-deals-list.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import type { TopOpenDealRow } from '@dealflow/shared';

export function TopDealsList({ rows }: { rows: TopOpenDealRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-400">No open deals yet.</p>;
  }
  return (
    <ul className="divide-y divide-neutral-100" data-testid="top-deals-list">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="min-w-0">
            <Link
              to="/app/deals/$id"
              params={{ id: r.id }}
              className="block truncate font-medium text-neutral-900 hover:underline"
            >
              {r.name}
            </Link>
            <div className="truncate text-xs text-neutral-500">
              {r.stageName}
              {r.companyName ? ` · ${r.companyName}` : ''}
            </div>
          </div>
          <div className="shrink-0 text-sm tabular-nums text-neutral-900">
            {formatMoney(Number(r.value), r.currency)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatMoney(v: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/dashboard/pipeline-value-chart.tsx apps/web/src/features/dashboard/deals-trend-chart.tsx apps/web/src/features/dashboard/activity-sparkline.tsx apps/web/src/features/dashboard/top-deals-list.tsx
git commit -m "feat(web): dashboard chart components + top deals list"
```

---

## Task 10: `/app/dashboard` route + sidebar link + `/app` redirect

**Files:**
- Create: `apps/web/src/routes/app.dashboard.tsx`
- Modify: `apps/web/src/routes/app.index.tsx`
- Modify: `apps/web/src/routes/app.tsx`

- [ ] **Step 1: Build the dashboard page**

Create `apps/web/src/routes/app.dashboard.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useDashboard } from '@/features/dashboard/api';
import { KpiTile } from '@/features/dashboard/kpi-tile';
import { PipelineValueChart } from '@/features/dashboard/pipeline-value-chart';
import { DealsTrendChart } from '@/features/dashboard/deals-trend-chart';
import { ActivitySparkline } from '@/features/dashboard/activity-sparkline';
import { TopDealsList } from '@/features/dashboard/top-deals-list';

export const Route = createFileRoute('/app/dashboard')({
  component: DashboardPage,
});

function DashboardPage() {
  const q = useDashboard();

  if (q.isPending) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-sm text-neutral-500">Loading…</p>
      </main>
    );
  }
  if (q.isError || !q.data) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-sm text-red-600">Could not load dashboard.</p>
      </main>
    );
  }
  const { kpis, pipelineByStage, dealsTrend, activityVolume, topOpenDeals } = q.data;
  const money = (raw: string) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: kpis.currency,
      maximumFractionDigits: 0,
    }).format(Number(raw));

  return (
    <main className="space-y-6 p-8" data-testid="dashboard">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-neutral-500">
          A snapshot of your pipeline, deals, and activity.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile label="Contacts" value={kpis.totalContacts} dim={kpis.totalContacts === 0} />
        <KpiTile label="Companies" value={kpis.totalCompanies} dim={kpis.totalCompanies === 0} />
        <KpiTile label="Open deals" value={kpis.openDeals} dim={kpis.openDeals === 0} />
        <KpiTile label="Pipeline value" value={money(kpis.openPipelineValue)} dim={kpis.openDeals === 0} />
        <KpiTile
          label="Overdue tasks"
          value={kpis.overdueTasks}
          dim={kpis.overdueTasks === 0}
          hint={kpis.overdueTasks > 0 ? 'Past due' : undefined}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-md border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium">Pipeline value by stage</h2>
          <PipelineValueChart rows={pipelineByStage} currency={kpis.currency} />
        </div>
        <div className="rounded-md border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium">Deals won vs. lost (last 6 months)</h2>
          <DealsTrendChart rows={dealsTrend} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-md border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium">Activity (last 8 weeks)</h2>
          <ActivitySparkline rows={activityVolume} />
        </div>
        <div className="rounded-md border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium">Top open deals</h2>
          <TopDealsList rows={topOpenDeals} />
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Redirect `/app/` → `/app/dashboard`**

Replace the contents of `apps/web/src/routes/app.index.tsx` with:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/')({
  // The dashboard is the new home. Pre-load redirect keeps the Welcome
  // placeholder from flashing.
  beforeLoad: () => {
    throw redirect({ to: '/app/dashboard' });
  },
  component: () => null,
});
```

- [ ] **Step 3: Add Dashboard link to sidebar (top position)**

Edit `apps/web/src/routes/app.tsx`. Inside the `<nav>` block (currently starts with the "Contacts" Link around line 42), insert this Link as the FIRST nav child, immediately after `<nav className="flex flex-col gap-1 text-sm">`:

```tsx
          <Link
            to="/app/dashboard"
            className="rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
            activeProps={{
              className: 'rounded px-2 py-1.5 bg-neutral-100 font-medium text-neutral-900',
            }}
          >
            Dashboard
          </Link>
```

- [ ] **Step 4: Regenerate routes + typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: PASS — generated `routeTree.gen.ts` now includes `/app/dashboard`.

- [ ] **Step 5: Smoke-build the web app**

Run: `pnpm --filter @dealflow/web build`
Expected: clean build, no warnings about missing exports from recharts.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/app.dashboard.tsx apps/web/src/routes/app.index.tsx apps/web/src/routes/app.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /app/dashboard route, sidebar link, redirect /app -> /app/dashboard"
```

---

## Task 11: Cross-package validation + tag

**Files:** none new — checks across the monorepo.

- [ ] **Step 1: Run the full test matrix from the repo root**

Run: `pnpm -r test`
Expected: every package passes. Known pre-existing flakes (`tasks.routes.test.ts` date-boundary cases) may surface — re-run once; if they still fail, log and proceed (unrelated to this work).

- [ ] **Step 2: Typecheck everything**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 3: Lint + format**

Run: `pnpm -r lint && pnpm -r format`
Expected: zero errors. Stage any formatter changes.

- [ ] **Step 4: Manual smoke test (write findings into a short note)**

Start the stack (`pnpm dev` if there's a root script, otherwise `pnpm --filter @dealflow/api dev` + `pnpm --filter @dealflow/web dev` in two shells). Sign up a fresh user, then:

1. Land on `/app` — verify it redirects to `/app/dashboard`.
2. The KPI strip shows five tiles, all zero (dimmed).
3. All four lower panels render their empty states without console errors.
4. Create one company, one contact, one deal with `value=10000`, one note, and one overdue task (yesterday). Refresh.
5. KPI counts move to 1/1/1/$10,000/1.
6. Pipeline chart shows one bar; trend chart shows a flat 0 line; sparkline shows a small bump in this week; top-deals list shows the new deal.

If anything is off, fix it before tagging.

- [ ] **Step 5: Stage any pending formatter / typegen output and commit**

```bash
git add -A
git diff --cached --stat   # sanity check: nothing surprising
git commit -m "chore: lint + format after reports & dashboard" || echo "nothing to commit"
```

- [ ] **Step 6: Tag the milestone**

```bash
git tag -a v0.1-reports-dashboard -m "Reports & Dashboard sub-plan complete"
git push origin main
git push origin v0.1-reports-dashboard
```

---

## Notes for the implementer

- **No new tables, no migrations.** Every aggregate uses existing columns. If a query fails because a referenced column doesn't exist (e.g. `deals.closedAt`), that's a real bug in the assumption — surface it; don't add the column quietly.
- **Tenant isolation is non-negotiable.** Every repo method must filter by `organizationId` in the outermost `where`. The tests already verify this; do not weaken them.
- **`numeric` is a string in Drizzle.** Don't `Number(...)` it on the API side — let the wire format stay string, format on the UI. The `normalizeMoney` helper exists to give the UI a consistent `'12345.67'` shape.
- **Dates and TZ.** All bucket math (`date_trunc`, JS month math) runs in server local time, which in production is UTC. Tests run in whatever the host TZ is; the assertions are bucket-count-based rather than calendar-date-based to stay TZ-robust.
- **Per-org currency.** The KPI strip uses the org's `organizations.currency` (single value). Multi-currency dashboards are out of scope here — call it out if the codebase actually stores per-deal currency mixes you'd need to reconcile.
- **Don't add a "compare to last period" affordance** in this plan. It's tempting but doubles the query surface; defer to a follow-up.
