import { useState } from 'react';
import type { PublicActivity } from '@dealflow/shared';
import { Button } from '@/components/ui/button';
import {
  useActivitiesFor,
  useDeleteActivity,
  useUpdateActivity,
} from './api';
import { AddNoteForm } from './add-note-form';
import { AddTaskForm } from './add-task-form';
import { TaskItem } from './task-item';

type ParentFilter =
  | { contactId: string }
  | { companyId: string }
  | { dealId: string };

interface ActivityFeedProps {
  parent: ParentFilter;
}

type Composer = 'none' | 'note' | 'task';

export function ActivityFeed({ parent }: ActivityFeedProps) {
  const list = useActivitiesFor(parent);
  const update = useUpdateActivity(parent);
  const del = useDeleteActivity(parent);
  const [composer, setComposer] = useState<Composer>('none');

  return (
    <section className="mt-8" data-testid="activity-feed">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium">Activity</h2>
        <div className="flex items-center gap-2">
          <Button
            variant={composer === 'note' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setComposer(composer === 'note' ? 'none' : 'note')}
          >
            Note
          </Button>
          <Button
            variant={composer === 'task' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setComposer(composer === 'task' ? 'none' : 'task')}
          >
            Task
          </Button>
        </div>
      </div>

      {composer === 'note' && (
        <div className="mb-4 rounded-md border border-neutral-200 p-3">
          <AddNoteForm parent={parent} />
        </div>
      )}
      {composer === 'task' && (
        <div className="mb-4 rounded-md border border-neutral-200 p-3">
          <AddTaskForm parent={parent} />
        </div>
      )}

      {list.isPending && <p className="text-sm text-neutral-500">Loading activity…</p>}
      {list.error && <p className="text-sm text-red-600">Couldn't load activity.</p>}
      {list.data?.items.length === 0 && !list.isPending && (
        <p className="text-sm italic text-neutral-400">No activity yet.</p>
      )}

      <ul className="divide-y divide-neutral-200">
        {list.data?.items.map((a) => (
          <li key={a.id} className="py-3">
            <ActivityRow
              activity={a}
              onToggleDone={(id, patch) => update.mutateAsync({ id, patch })}
              onDelete={(id) => del.mutateAsync(id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ActivityRowProps {
  activity: PublicActivity;
  onToggleDone: (id: string, patch: { status: 'open' | 'done' }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

function ActivityRow({ activity, onToggleDone, onDelete }: ActivityRowProps) {
  if (activity.kind === 'task') {
    return (
      <TaskItem
        task={activity}
        onToggleDone={(id, patch) =>
          onToggleDone(id, patch as { status: 'open' | 'done' })
        }
        onDelete={onDelete}
      />
    );
  }
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm text-neutral-800">{activity.body}</p>
        <p className="mt-1 text-xs text-neutral-500">
          Note · {new Date(activity.createdAt).toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void onDelete(activity.id)}
        className="text-xs text-neutral-400 hover:text-red-600"
        aria-label="Delete note"
      >
        ✕
      </button>
    </div>
  );
}
