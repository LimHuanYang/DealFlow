import { createFileRoute } from '@tanstack/react-router';
import { InlineEdit } from '@/components/inline-edit';
import { useDeal, useUpdateDeal } from '@/features/deals/api';
import { formatCurrency } from '@/lib/format';

export const Route = createFileRoute('/app/deals/$id')({
  component: DealDetailPage,
});

function DealDetailPage() {
  const { id } = Route.useParams();
  const { data, isPending, error } = useDeal(id);
  const update = useUpdateDeal(id);

  if (isPending) return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  if (error || !data) {
    return <main className="p-6 text-sm text-red-600">Could not load deal.</main>;
  }

  const d = data.deal;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight" data-testid="deal-name">
        {d.name}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Deal · {d.status} · {formatCurrency(d.value, d.currency)}
      </p>

      <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
        <dt className="text-neutral-500">Name</dt>
        <dd>
          <InlineEdit
            value={d.name}
            onSave={async (v) => {
              await update.mutateAsync({ name: v });
            }}
          />
        </dd>
        <dt className="text-neutral-500">Value</dt>
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
        <dt className="text-neutral-500">Currency</dt>
        <dd>
          <InlineEdit
            value={d.currency}
            onSave={async (v) => {
              await update.mutateAsync({ currency: v.toUpperCase() });
            }}
          />
        </dd>
        <dt className="text-neutral-500">Expected close</dt>
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
    </main>
  );
}
