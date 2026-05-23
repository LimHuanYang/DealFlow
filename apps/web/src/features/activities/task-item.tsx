import { Link } from '@tanstack/react-router';
import type { PublicActivity, UpdateActivityInput } from '@dealflow/shared';

interface TaskItemProps {
  task: PublicActivity;
  onToggleDone: (id: string, patch: UpdateActivityInput) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
  /** Optional context label rendered after the body (e.g. contact name). */
  contextLabel?: React.ReactNode;
  /** When provided, wraps the task body text in a link to the detail page. */
  detailId?: string;
}

/**
 * A single task row. Used inside the activity feed (per entity) and on the
 * `/app/tasks` page. The checkbox toggles status='done'/'open'; the row also
 * highlights overdue tasks in red.
 */
export function TaskItem({ task, onToggleDone, onDelete, contextLabel, detailId }: TaskItemProps) {
  const done = task.status === 'done';
  const overdue = !done && task.dueAt !== null && new Date(task.dueAt).getTime() < startOfToday();

  return (
    <div className="flex items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={done}
        onChange={async (e) => {
          await onToggleDone(task.id, { status: e.target.checked ? 'done' : 'open' });
        }}
        className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-300"
        data-testid={`task-checkbox-${task.id}`}
      />
      <div className="min-w-0 flex-1">
        <p className={done ? 'text-sm text-neutral-400 line-through' : 'text-sm text-neutral-900'}>
          {detailId ? (
            <Link
              to="/app/activities/$id"
              params={{ id: detailId }}
              className="font-medium hover:underline"
            >
              {task.body}
            </Link>
          ) : (
            task.body
          )}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
          {task.dueAt && (
            <span className={overdue ? 'text-red-600' : ''}>Due {formatDate(task.dueAt)}</span>
          )}
          {contextLabel && <span>· {contextLabel}</span>}
        </div>
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={() => void onDelete(task.id)}
          className="text-xs text-neutral-400 hover:text-red-600"
          aria-label="Delete task"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
