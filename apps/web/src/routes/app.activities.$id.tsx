import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useActivity } from '@/features/activities/api';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';
import { apiFetch } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/app/activities/$id')({
  component: ActivityDetailPage,
});

function ActivityDetailPage() {
  const { id } = Route.useParams();
  const q = useActivity(id);
  const qc = useQueryClient();
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (q.data?.customFields) setCustomFields(q.data.customFields);
  }, [q.data?.customFields]);

  if (q.isPending) return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  if (q.isError || !q.data) return <main className="p-8 text-sm text-red-600">Activity not found.</main>;

  const a = q.data;
  const entityType = a.kind === 'task' ? 'task' : 'note';

  async function onCustomFieldChange(fieldId: string, value: unknown) {
    setCustomFields((prev) => ({ ...prev, [fieldId]: value }));
    await apiFetch(`/api/v1/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ customFields: { [fieldId]: value } }),
    });
    qc.invalidateQueries({ queryKey: queryKeys.activities.detail(id) });
  }

  async function onMarkDone() {
    await apiFetch(`/api/v1/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    });
    qc.invalidateQueries({ queryKey: queryKeys.activities.detail(id) });
  }

  return (
    <main className="space-y-6 p-8">
      <header>
        <Link to="/app/tasks" className="text-sm text-neutral-500 hover:underline">← Back</Link>
        <h1 className="mt-2 flex items-center justify-between text-2xl font-semibold tracking-tight">
          <span>
            {a.kind === 'task' ? 'Task' : 'Note'}
            {a.dueAt && <span className="ml-2 text-sm font-normal text-neutral-500">· Due {a.dueAt.slice(0, 10)}</span>}
          </span>
          {a.kind === 'task' && a.status !== 'done' && (
            <Button size="sm" onClick={onMarkDone}>Mark done</Button>
          )}
        </h1>
        <pre className="mt-3 whitespace-pre-wrap rounded-md border border-neutral-200 bg-white p-3 text-sm">
          {a.body}
        </pre>
      </header>

      <section>
        <CustomFieldsBlock
          entityType={entityType}
          values={customFields}
          onChange={onCustomFieldChange}
        />
      </section>

      <section className="text-xs text-neutral-400">
        Created {new Date(a.createdAt).toLocaleString()}
        {a.completedAt && <> · Completed {new Date(a.completedAt).toLocaleString()}</>}
      </section>
    </main>
  );
}
