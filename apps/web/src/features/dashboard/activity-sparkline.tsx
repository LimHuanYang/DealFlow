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
