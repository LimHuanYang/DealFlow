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
