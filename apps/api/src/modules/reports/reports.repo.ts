import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { DashboardKpis, DealsTrendRow, PipelineByStageRow } from '@dealflow/shared';

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
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = '01';
      const yyyy = d.getFullYear();
      buckets.push({
        month: `${yyyy}-${mm}-${dd}`,
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
