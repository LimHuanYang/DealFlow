import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Mail, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { InlineEdit } from '@/components/inline-edit';
import { CompanySelect } from '@/features/companies/company-select';
import { ActivityFeed } from '@/features/activities/activity-feed';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';
import { useContact, useUpdateContact, useDeleteContact } from '@/features/contacts/api';
import { useEmailStatus } from '@/features/emails/api';
import { ComposeEmailDialog } from '@/features/emails/compose-email-dialog';
import { EmailEngagementRollup } from '@/features/emails/email-engagement-rollup';

export const Route = createFileRoute('/app/contacts/$id')({
  component: ContactDetailPage,
});

function ContactDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data, isPending, error } = useContact(id);
  const update = useUpdateContact(id);
  const del = useDeleteContact();
  const emailStatus = useEmailStatus();

  if (isPending) return <main className="p-8 text-sm text-slate-500">Loading…</main>;
  if (error || !data) {
    return <main className="p-8 text-sm text-red-600">Could not load contact.</main>;
  }

  const c = data.contact;
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed contact';
  const avatar = (
    [c.firstName?.[0], c.lastName?.[0]].filter(Boolean).join('') || c.firstName.slice(0, 2)
  ).toUpperCase();

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-lg font-semibold text-accent-foreground">
            {avatar}
          </span>
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight text-slate-900"
              data-testid="contact-name"
            >
              {fullName}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Contact · created {new Date(c.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {emailStatus.data?.enabled && c.email && (
            <ComposeEmailDialog
              contactId={c.id}
              recipientName={`${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`}
              recipientEmail={c.email}
              trigger={
                <Button variant="default" size="default" data-testid="email-contact">
                  <Mail className="h-4 w-4" />
                  Email
                </Button>
              }
            />
          )}
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="default" data-testid="delete-contact">
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            }
            title="Delete this contact?"
            description={`"${fullName}" will be permanently removed. This can't be undone.`}
            confirmLabel="Delete contact"
            destructive
            onConfirm={() =>
              del.mutate(c.id, { onSuccess: () => void navigate({ to: '/app/contacts' }) })
            }
          />
        </div>
      </div>

      {/* Details card */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Details
        </h2>
        <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-4 text-sm">
          <dt className="pt-1 font-medium text-slate-500">First name</dt>
          <dd>
            <InlineEdit
              value={c.firstName}
              onSave={async (v) => {
                await update.mutateAsync({ firstName: v });
              }}
            />
          </dd>
          <dt className="pt-1 font-medium text-slate-500">Last name</dt>
          <dd>
            <InlineEdit
              value={c.lastName}
              placeholder="—"
              onSave={async (v) => {
                await update.mutateAsync({ lastName: v || undefined });
              }}
              muted
            />
          </dd>
          <dt className="pt-1 font-medium text-slate-500">Email</dt>
          <dd>
            <InlineEdit
              value={c.email}
              placeholder="user@example.com"
              onSave={async (v) => {
                await update.mutateAsync({ email: v || undefined });
              }}
              muted
            />
          </dd>
          <dt className="pt-1 font-medium text-slate-500">Phone</dt>
          <dd>
            <InlineEdit
              value={c.phone}
              placeholder="—"
              onSave={async (v) => {
                await update.mutateAsync({ phone: v || undefined });
              }}
              muted
            />
          </dd>
          <dt className="pt-1 font-medium text-slate-500">Title</dt>
          <dd>
            <InlineEdit
              value={c.title}
              placeholder="—"
              onSave={async (v) => {
                await update.mutateAsync({ title: v || undefined });
              }}
              muted
            />
          </dd>
          <dt className="pt-2 font-medium text-slate-500">Company</dt>
          <dd className="flex items-center gap-3">
            <CompanySelect
              value={c.companyId}
              onChange={(companyId) => {
                void update.mutateAsync({ companyId });
              }}
              className="max-w-xs rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm disabled:opacity-60"
            />
            {c.companyId && (
              <Link
                to="/app/companies/$id"
                params={{ id: c.companyId }}
                className="whitespace-nowrap text-xs font-medium text-primary hover:underline"
              >
                View company →
              </Link>
            )}
          </dd>
        </dl>
      </section>

      <EmailEngagementRollup entityType="contact" entityId={c.id} />

      <CustomFieldsBlock
        entityType="contact"
        values={c.customFields ?? {}}
        onChange={(fieldId, value) => {
          void update.mutateAsync({ customFields: { [fieldId]: value } });
        }}
        card
      />

      <ActivityFeed parent={{ contactId: c.id }} />
    </main>
  );
}
