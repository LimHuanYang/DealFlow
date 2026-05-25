import type { PublicActivity } from '@dealflow/shared';
import { useEmailEvents } from './api';

interface Props {
  activity: PublicActivity;
}

export function EmailEngagementTimeline({ activity }: Props) {
  const q = useEmailEvents(activity.id);

  if (activity.kind !== 'email') return null;
  if (activity.deliveryStatus === 'failed') {
    return (
      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-400">Engagement</h2>
        <p className="mt-2 text-sm text-red-600">
          ⚠ This email failed to send. No engagement events recorded.
        </p>
      </section>
    );
  }
  if (!activity.trackingEnabled) {
    return (
      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-400">Engagement</h2>
        <p className="mt-2 text-sm text-neutral-500">Tracking was disabled for this send.</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-neutral-400">Engagement</h2>
      <div className="mt-2 flex gap-4 text-sm">
        <div>
          👁 <strong>{activity.openCount}</strong> opens
        </div>
        <div>
          🖱 <strong>{activity.clickCount}</strong> clicks
        </div>
      </div>
      {q.isPending && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}
      {q.data && q.data.items.length === 0 && (
        <p className="mt-3 text-sm text-neutral-400">No engagement yet.</p>
      )}
      {q.data && q.data.items.length > 0 && (
        <ol className="mt-3 space-y-2 border-l border-neutral-200 pl-4">
          {q.data.items.map((e) => (
            <li key={e.id} className="relative -ml-[7px] flex items-start gap-3 text-sm">
              <span
                className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white ring-1 ring-neutral-300 ${
                  e.eventType === 'open'
                    ? 'bg-green-500'
                    : e.eventType === 'click'
                      ? 'bg-blue-500'
                      : 'bg-neutral-400'
                }`}
              />
              <div>
                <div>
                  {e.eventType === 'click' ? (
                    <>
                      Clicked → <span className="text-neutral-600">{e.url ?? ''}</span>
                    </>
                  ) : e.eventType === 'open' ? (
                    'Opened'
                  ) : (
                    'Sent'
                  )}
                </div>
                <div className="text-xs text-neutral-400">
                  {new Date(e.occurredAt).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-neutral-400">
        Note: some opens may be auto-fetches by privacy-protecting email clients (Apple Mail
        Privacy, corporate scanners).
      </p>
    </section>
  );
}
