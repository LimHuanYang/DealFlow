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
    <section className="mt-4 rounded-md border border-neutral-200 bg-white p-3 text-sm">
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Email engagement</div>
      <div className="flex flex-wrap gap-4">
        <div>
          📤 <strong>{r.sent}</strong> sent
        </div>
        <div>
          👁 <strong>{r.opened}</strong> opened{' '}
          <span className="text-neutral-400">({Math.round(r.openedPct * 100)}%)</span>
        </div>
        <div>
          🖱 <strong>{r.clickedWith}</strong> with clicks{' '}
          <span className="text-neutral-400">({Math.round(r.clickedWithPct * 100)}%)</span>
        </div>
        {r.lastActivityAt && (
          <div className="ml-auto text-neutral-400">
            Last activity: {new Date(r.lastActivityAt).toLocaleString()}
          </div>
        )}
      </div>
    </section>
  );
}
