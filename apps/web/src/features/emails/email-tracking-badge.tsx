import type { PublicActivity } from '@dealflow/shared';

interface Props {
  activity: PublicActivity;
}

/** Renders a tracking summary for an email activity. Returns null for non-emails or untracked sends. */
export function EmailTrackingBadge({ activity }: Props) {
  if (activity.kind !== 'email') return null;
  if (activity.deliveryStatus === 'failed') {
    return (
      <div className="mt-1 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
          ⚠ Send failed
        </span>
      </div>
    );
  }
  if (!activity.trackingEnabled) return null;

  const opened = activity.openCount > 0;
  const clicked = activity.clickCount > 0;

  if (!opened && !clicked) {
    return (
      <div className="mt-1 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
          📤 Sent · awaiting open
        </span>
      </div>
    );
  }

  const lastAt =
    activity.lastClickedAt && activity.lastOpenedAt
      ? activity.lastClickedAt > activity.lastOpenedAt
        ? activity.lastClickedAt
        : activity.lastOpenedAt
      : (activity.lastClickedAt ?? activity.lastOpenedAt);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {opened && (
        <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800">
          👁 Opened {activity.openCount}×
        </span>
      )}
      {clicked && (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800">
          🖱 Clicked {activity.clickCount}×
        </span>
      )}
      {lastAt && (
        <span className="text-[11px] text-neutral-400">· last {timeAgo(lastAt)}</span>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
