import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
