import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import type { ListTasksQuery, TaskStatus } from '@dealflow/shared';
import { useTasks, useUpdateTask } from '@/features/activities/api';
import { TaskItem } from '@/features/activities/task-item';

export const Route = createFileRoute('/app/tasks')({
  component: TasksPage,
});

type DueFilter = ListTasksQuery['due'];

const STATUS_TABS: { key: TaskStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
];

const DUE_FILTERS: { key: DueFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
];

function TasksPage() {
  const [status, setStatus] = useState<TaskStatus>('open');
  const [due, setDue] = useState<DueFilter>('all');
  const tasks = useTasks({ status, due });
  const update = useUpdateTask();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Tasks</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Open follow-ups across all your contacts, companies, and deals.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-4 border-b border-neutral-200 pb-3">
        <div className="flex gap-1" role="tablist" aria-label="Task status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => setStatus(t.key)}
              className={
                status === t.key
                  ? 'rounded px-3 py-1 text-sm font-medium bg-neutral-100 text-neutral-900'
                  : 'rounded px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Due filter">
          {DUE_FILTERS.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={due === d.key}
              onClick={() => setDue(d.key)}
              className={
                due === d.key
                  ? 'rounded px-3 py-1 text-sm font-medium bg-neutral-100 text-neutral-900'
                  : 'rounded px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50'
              }
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {tasks.isPending && <p className="text-sm text-neutral-500">Loading…</p>}
      {tasks.error && <p className="text-sm text-red-600">Couldn't load tasks.</p>}
      {tasks.data?.items.length === 0 && !tasks.isPending && (
        <p className="text-sm italic text-neutral-400">No tasks match this filter.</p>
      )}

      <ul className="divide-y divide-neutral-200">
        {tasks.data?.items.map((task) => (
          <li key={task.id}>
            <TaskItem
              task={task}
              onToggleDone={(id, patch) => update.mutateAsync({ id, patch })}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
