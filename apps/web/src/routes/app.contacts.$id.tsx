import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { InlineEdit } from '@/components/inline-edit';
import { ActivityFeed } from '@/features/activities/activity-feed';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';
import { useContact, useUpdateContact } from '@/features/contacts/api';
import { useEmailStatus } from '@/features/emails/api';
import { ComposeEmailDialog } from '@/features/emails/compose-email-dialog';

export const Route = createFileRoute('/app/contacts/$id')({
  component: ContactDetailPage,
});

function ContactDetailPage() {
  const { id } = Route.useParams();
  const { data, isPending, error } = useContact(id);
  const update = useUpdateContact(id);
  const emailStatus = useEmailStatus();

  if (isPending) return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  if (error || !data) {
    return <main className="p-6 text-sm text-red-600">Could not load contact.</main>;
  }

  const c = data.contact;
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed contact';

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight" data-testid="contact-name">
        {fullName}
      </h1>
      <p className="mb-2 text-sm text-neutral-500">
        Contact · created {new Date(c.createdAt).toLocaleDateString()}
      </p>

      {emailStatus.data?.enabled && c.email && (
        <div className="mt-2 mb-4">
          <ComposeEmailDialog
            contactId={c.id}
            recipientName={`${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`}
            recipientEmail={c.email}
            trigger={
              <Button variant="outline" size="sm" data-testid="email-contact">
                ✉️ Email
              </Button>
            }
          />
        </div>
      )}

      <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
        <dt className="text-neutral-500">First name</dt>
        <dd>
          <InlineEdit
            value={c.firstName}
            onSave={async (v) => {
              await update.mutateAsync({ firstName: v });
            }}
          />
        </dd>
        <dt className="text-neutral-500">Last name</dt>
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
        <dt className="text-neutral-500">Email</dt>
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
        <dt className="text-neutral-500">Phone</dt>
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
        <dt className="text-neutral-500">Title</dt>
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
      </dl>
      <section className="mt-6">
        <CustomFieldsBlock
          entityType="contact"
          values={c.customFields ?? {}}
          onChange={(fieldId, value) => {
            void update.mutateAsync({ customFields: { [fieldId]: value } });
          }}
        />
      </section>
      <ActivityFeed parent={{ contactId: c.id }} />
    </main>
  );
}
