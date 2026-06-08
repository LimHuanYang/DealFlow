import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CircleDollarSign, Trash2 } from 'lucide-react';
import { CURRENCY_OPTIONS, isSupportedCurrency } from '@dealflow/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { InlineEdit } from '@/components/inline-edit';
import { DetailPageHeader } from '@/components/detail-page-header';
import { ActivityFeed } from '@/features/activities/activity-feed';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';
import { useDeal, useUpdateDeal, useDeleteDeal } from '@/features/deals/api';
import { EmailEngagementRollup } from '@/features/emails/email-engagement-rollup';
import { formatCurrency } from '@/lib/format';

const DEAL_STATUS_STYLES: Record<string, string> = {
  open: 'bg-slate-100 text-slate-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};

export const Route = createFileRoute('/app/deals/$id')({
  component: DealDetailPage,
});

function DealDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data, isPending, error } = useDeal(id);
  const update = useUpdateDeal(id);
  const del = useDeleteDeal();

  if (isPending) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (error || !data) {
    return <main className="p-8 text-sm text-red-600">Could not load deal.</main>;
  }

  const d = data.deal;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <DetailPageHeader
        icon={<CircleDollarSign className="h-6 w-6" strokeWidth={2} />}
        title={d.name}
        subtitle={`Deal · ${formatCurrency(d.value, d.currency)}`}
        titleTestId="deal-name"
        action={
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                DEAL_STATUS_STYLES[d.status] ?? 'bg-slate-100 text-slate-700'
              }`}
            >
              {d.status}
            </span>
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="default" data-testid="delete-deal">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              }
              title="Delete this deal?"
              description={`"${d.name}" will be permanently removed. This can't be undone.`}
              confirmLabel="Delete deal"
              destructive
              onConfirm={() =>
                del.mutate(d.id, { onSuccess: () => void navigate({ to: '/app/deals' }) })
              }
            />
          </div>
        }
      />

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Details
        </h2>
        <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-4 text-sm">
          <dt className="pt-1 font-medium text-slate-500">Name</dt>
          <dd>
            <InlineEdit
              value={d.name}
              onSave={async (v) => {
                await update.mutateAsync({ name: v });
              }}
            />
          </dd>
          <dt className="pt-1 font-medium text-slate-500">Value</dt>
          <dd>
            <InlineEdit
              value={d.value == null ? null : String(d.value)}
              placeholder="0"
              onSave={async (v) => {
                const num = v ? Number(v) : undefined;
                await update.mutateAsync({ value: num });
              }}
              muted
            />
          </dd>
          <dt className="pt-2 font-medium text-slate-500">Currency</dt>
          <dd>
            <select
              value={d.currency}
              onChange={async (e) => {
                const next = e.target.value;
                if (!isSupportedCurrency(next) || next === d.currency) return;
                await update.mutateAsync({ currency: next });
              }}
              className="h-9 w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm"
              data-testid="deal-currency-select"
            >
              {CURRENCY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </dd>
          <dt className="pt-1 font-medium text-slate-500">Expected close</dt>
          <dd>
            <InlineEdit
              value={d.expectedCloseDate}
              placeholder="YYYY-MM-DD"
              onSave={async (v) => {
                await update.mutateAsync({ expectedCloseDate: v || undefined });
              }}
              muted
            />
          </dd>
        </dl>
      </section>

      <EmailEngagementRollup entityType="deal" entityId={d.id} />

      <CustomFieldsBlock
        entityType="deal"
        values={d.customFields ?? {}}
        onChange={(fieldId, value) => {
          void update.mutateAsync({ customFields: { [fieldId]: value } });
        }}
        card
      />

      <ActivityFeed parent={{ dealId: d.id }} />
    </main>
  );
}
