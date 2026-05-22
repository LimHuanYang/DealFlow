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
