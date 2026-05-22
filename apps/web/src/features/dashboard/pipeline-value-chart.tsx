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
