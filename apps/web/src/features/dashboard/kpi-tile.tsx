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
