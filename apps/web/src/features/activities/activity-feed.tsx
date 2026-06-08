import { useState } from 'react';
import type { PublicActivity } from '@dealflow/shared';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useAIStatus, useSummarizeActivity } from '@/features/ai/api';
import { useActivitiesFor, useDeleteActivity, useUpdateActivity } from './api';
import { AddNoteForm } from './add-note-form';
import { AddTaskForm } from './add-task-form';
import { TaskItem } from './task-item';
import { EmailTrackingBadge } from '@/features/emails/email-tracking-badge';

type ParentFilter = { contactId: string } | { companyId: string } | { dealId: string };

interface ActivityFeedProps {
  parent: ParentFilter;
}

type Composer = 'none' | 'note' | 'task';

export function ActivityFeed({ parent }: ActivityFeedProps) {
  const list = useActivitiesFor(parent);
  const update = useUpdateActivity(parent);
  const del = useDeleteActivity(parent);
  const [composer, setComposer] = useState<Composer>('none');
  const aiStatus = useAIStatus();
  const summarize = useSummarizeActivity();
  const summary = summarize.data?.summary ?? null;

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
          {aiStatus.data?.enabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => summarize.mutate(parent)}
              disabled={summarize.isPending}
              data-testid="summarize-activity"
            >
              {summarize.isPending ? 'Summarizing…' : '✨ Summarize'}
            </Button>
          )}
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

      {summary && (
        <div
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="activity-summary"
        >
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-700">
            AI summary
          </p>
          <p className="whitespace-pre-wrap">{summary}</p>
        </div>
      )}
      {summarize.isError && (
        <p className="mb-4 text-sm text-red-600">Couldn't summarize — please try again.</p>
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
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <TaskItem
            task={activity}
            onToggleDone={(id, patch) => onToggleDone(id, patch as { status: 'open' | 'done' })}
            onDelete={onDelete}
          />
        </div>
        <Link
          to="/app/activities/$id"
          params={{ id: activity.id }}
          className="shrink-0 text-xs text-neutral-400 hover:text-neutral-700"
        >
          Open ↗
        </Link>
      </div>
    );
  }
  if (activity.kind === 'email') {
    return (
      <div className="-mx-2 -my-1 flex items-start justify-between gap-3 rounded-md px-2 py-1 transition-colors hover:bg-neutral-50">
        <Link
          to="/app/activities/$id"
          params={{ id: activity.id }}
          className="block min-w-0 flex-1"
          aria-label="Open email detail"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700">✉️ Email sent</p>
          {activity.subject && (
            <p className="mt-0.5 text-sm font-medium text-neutral-900">{activity.subject}</p>
          )}
          <EmailTrackingBadge activity={activity} />
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{activity.body}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {new Date(activity.createdAt).toLocaleString()}
          </p>
        </Link>
        <ConfirmDialog
          trigger={
            <button
              type="button"
              className="shrink-0 text-xs text-neutral-400 hover:text-red-600"
              aria-label="Delete email"
            >
              ✕
            </button>
          }
          title="Delete this email?"
          description="This logged email will be permanently removed from the activity feed. This can't be undone."
          confirmLabel="Delete email"
          destructive
          onConfirm={() => onDelete(activity.id)}
        />
      </div>
    );
  }
  // Default: note
  return (
    <div className="-mx-2 -my-1 flex items-start justify-between gap-3 rounded-md px-2 py-1 transition-colors hover:bg-neutral-50">
      <Link
        to="/app/activities/$id"
        params={{ id: activity.id }}
        className="block min-w-0 flex-1"
        aria-label="Open note detail"
      >
        <p className="whitespace-pre-wrap text-sm text-neutral-800">{activity.body}</p>
        <p className="mt-1 text-xs text-neutral-500">
          Note · {new Date(activity.createdAt).toLocaleString()}
        </p>
      </Link>
      <ConfirmDialog
        trigger={
          <button
            type="button"
            className="shrink-0 text-xs text-neutral-400 hover:text-red-600"
            aria-label="Delete note"
          >
            ✕
          </button>
        }
        title="Delete this note?"
        description="This note will be permanently removed. This can't be undone."
        confirmLabel="Delete note"
        destructive
        onConfirm={() => onDelete(activity.id)}
      />
    </div>
  );
}
