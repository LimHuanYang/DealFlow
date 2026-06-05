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
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          dim ? 'text-slate-300' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
