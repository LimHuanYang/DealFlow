import { createFileRoute } from '@tanstack/react-router';
import { InlineEdit } from '@/components/inline-edit';
import { useContact, useUpdateContact } from '@/features/contacts/api';

export const Route = createFileRoute('/app/contacts/$id')({
  component: ContactDetailPage,
});

function ContactDetailPage() {
  const { id } = Route.useParams();
  const { data, isPending, error } = useContact(id);
  const update = useUpdateContact(id);

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
      <p className="mb-6 text-sm text-neutral-500">
        Contact · created {new Date(c.createdAt).toLocaleDateString()}
      </p>

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
    </main>
  );
}
