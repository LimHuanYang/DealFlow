import { createFileRoute } from '@tanstack/react-router';
import { Building2 } from 'lucide-react';
import { InlineEdit } from '@/components/inline-edit';
import { DetailPageHeader } from '@/components/detail-page-header';
import { ActivityFeed } from '@/features/activities/activity-feed';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';
import { useCompany, useUpdateCompany } from '@/features/companies/api';
import { EmailEngagementRollup } from '@/features/emails/email-engagement-rollup';

export const Route = createFileRoute('/app/companies/$id')({
  component: CompanyDetailPage,
});

function CompanyDetailPage() {
  const { id } = Route.useParams();
  const { data, isPending, error } = useCompany(id);
  const update = useUpdateCompany(id);

  if (isPending) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (error || !data) {
    return <main className="p-8 text-sm text-red-600">Could not load company.</main>;
  }

  const c = data.company;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <DetailPageHeader
        icon={<Building2 className="h-6 w-6" strokeWidth={2} />}
        title={c.name}
        subtitle={`Company · created ${new Date(c.createdAt).toLocaleDateString()}`}
        titleTestId="company-name"
      />

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Details
        </h2>
        <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-4 text-sm">
          <dt className="pt-1 font-medium text-slate-500">Name</dt>
          <dd>
            <InlineEdit
              value={c.name}
              onSave={async (v) => {
                await update.mutateAsync({ name: v });
              }}
            />
          </dd>
          <dt className="pt-1 font-medium text-slate-500">Domain</dt>
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
          <dt className="pt-1 font-medium text-slate-500">Industry</dt>
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
          <dt className="pt-1 font-medium text-slate-500">Website</dt>
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
          <dt className="pt-1 font-medium text-slate-500">Description</dt>
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
      </section>

      <EmailEngagementRollup entityType="company" entityId={c.id} />

      <CustomFieldsBlock
        entityType="company"
        values={c.customFields ?? {}}
        onChange={(fieldId, value) => {
          void update.mutateAsync({ customFields: { [fieldId]: value } });
        }}
        card
      />

      <ActivityFeed parent={{ companyId: c.id }} />
    </main>
  );
}
