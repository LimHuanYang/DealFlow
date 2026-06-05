import { useEmailEngagement } from './api';

interface Props {
  entityType: 'contact' | 'company' | 'deal';
  entityId: string;
}

export function EmailEngagementRollup({ entityType, entityId }: Props) {
  const q = useEmailEngagement(entityType, entityId);
  if (!q.data || q.data.sent === 0) return null;
  const r = q.data;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm shadow-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Email engagement
      </div>
      <div className="flex flex-wrap gap-4 text-slate-700">
        <div>
          📤 <strong className="text-slate-900">{r.sent}</strong> sent
        </div>
        <div>
          👁 <strong className="text-slate-900">{r.opened}</strong> opened{' '}
          <span className="text-slate-400">({Math.round(r.openedPct * 100)}%)</span>
        </div>
        <div>
          🖱 <strong className="text-slate-900">{r.clickedWith}</strong> with clicks{' '}
          <span className="text-slate-400">({Math.round(r.clickedWithPct * 100)}%)</span>
        </div>
        {r.lastActivityAt && (
          <div className="ml-auto text-slate-400">
            Last activity: {new Date(r.lastActivityAt).toLocaleString()}
          </div>
        )}
      </div>
    </section>
  );
}
