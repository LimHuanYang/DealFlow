import { createFileRoute } from '@tanstack/react-router';
import { InlineEdit } from '@/components/inline-edit';
import { ActivityFeed } from '@/features/activities/activity-feed';
import { useCompany, useUpdateCompany } from '@/features/companies/api';

export const Route = createFileRoute('/app/companies/$id')({
  component: CompanyDetailPage,
});

function CompanyDetailPage() {
  const { id } = Route.useParams();
  const { data, isPending, error } = useCompany(id);
  const update = useUpdateCompany(id);

  if (isPending) return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  if (error || !data) {
    return <main className="p-6 text-sm text-red-600">Could not load company.</main>;
  }

  const c = data.company;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight" data-testid="company-name">
        {c.name}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Company · created {new Date(c.createdAt).toLocaleDateString()}
      </p>

      <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
        <dt className="text-neutral-500">Name</dt>
        <dd>
          <InlineEdit
            value={c.name}
            onSave={async (v) => {
              await update.mutateAsync({ name: v });
            }}
          />
        </dd>
        <dt className="text-neutral-500">Domain</dt>
        <dd>
          <InlineEdit
            value={c.domain}
            placeholder="example.com"
            onSave={async (v) => {
              await update.mutateAsync({ domain: v || undefined });
            }}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Industry</dt>
        <dd>
          <InlineEdit
            value={c.industry}
            placeholder="—"
            onSave={async (v) => {
              await update.mutateAsync({ industry: v || undefined });
            }}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Website</dt>
        <dd>
          <InlineEdit
            value={c.website}
            placeholder="https://…"
            onSave={async (v) => {
              await update.mutateAsync({ website: v || undefined });
            }}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Description</dt>
        <dd>
          <InlineEdit
            value={c.description}
            placeholder="Add a note about this company"
            onSave={async (v) => {
              await update.mutateAsync({ description: v || undefined });
            }}
            muted
          />
        </dd>
      </dl>
      <ActivityFeed parent={{ companyId: c.id }} />
    </main>
  );
}
