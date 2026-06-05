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

  const tabClass = (active: boolean) =>
    active
      ? 'rounded-md px-3 py-1.5 text-sm font-medium bg-accent text-accent-foreground'
      : 'rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900';

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tasks</h1>
      <p className="mt-0.5 text-sm text-slate-500">
        Open follow-ups across all your contacts, companies, and deals.
      </p>

      <div className="mb-4 mt-6 flex flex-wrap items-center gap-4 border-b border-slate-200 pb-3">
        <div className="flex gap-1" role="tablist" aria-label="Task status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => setStatus(t.key)}
              className={tabClass(status === t.key)}
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
              className={tabClass(due === d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {tasks.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {tasks.error && <p className="text-sm text-red-600">Couldn't load tasks.</p>}
      {tasks.data?.items.length === 0 && !tasks.isPending && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No tasks match this filter.
        </div>
      )}

      {tasks.data && tasks.data.items.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {tasks.data.items.map((task) => (
            <li key={task.id} className="px-4">
              <TaskItem
                task={task}
                onToggleDone={(id, patch) => update.mutateAsync({ id, patch })}
                detailId={task.id}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
