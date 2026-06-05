import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useActivity } from '@/features/activities/api';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';
import { apiFetch } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { EmailEngagementTimeline } from '@/features/emails/email-engagement-timeline';
import { EmailAttachmentsList } from '@/features/emails/email-attachments-list';

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

  if (q.isPending) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (q.isError || !q.data)
    return <main className="p-8 text-sm text-red-600">Activity not found.</main>;

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

  const backTarget =
    a.kind === 'email' ? '/app/emails' : a.kind === 'task' ? '/app/tasks' : '/app/tasks';
  const titleLabel = a.kind === 'task' ? 'Task' : a.kind === 'email' ? 'Email' : 'Note';

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <Link
        to={backTarget}
        className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        ← Back
      </Link>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {titleLabel}
            {a.dueAt && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                · Due {a.dueAt.slice(0, 10)}
              </span>
            )}
          </h1>
          {a.kind === 'task' && a.status !== 'done' && (
            <Button size="sm" onClick={onMarkDone}>
              Mark done
            </Button>
          )}
        </div>
        {a.kind === 'email' && a.subject && (
          <p className="mt-2 text-sm">
            <span className="text-slate-500">Subject: </span>
            <span className="font-medium text-slate-900">{a.subject}</span>
          </p>
        )}
        <pre className="mt-4 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {a.body}
        </pre>
      </section>

      {a.kind === 'email' && <EmailEngagementTimeline activity={a} />}

      {a.kind === 'email' && a.attachments.length > 0 && (
        <EmailAttachmentsList attachments={a.attachments} />
      )}

      <CustomFieldsBlock
        entityType={entityType}
        values={customFields}
        onChange={onCustomFieldChange}
        card
      />

      <p className="text-xs text-slate-400">
        Created {new Date(a.createdAt).toLocaleString()}
        {a.completedAt && <> · Completed {new Date(a.completedAt).toLocaleString()}</>}
      </p>
    </main>
  );
}
