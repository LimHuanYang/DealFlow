import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EntityTable, type EntityColumn } from '@/components/entity-table';
import { CreateContactDialog } from '@/features/contacts/create-contact-dialog';
import { useContactsList } from '@/features/contacts/api';
import type { PublicContact } from '@dealflow/shared';

export const Route = createFileRoute('/app/contacts/')({
  component: ContactsListPage,
});

function ContactsListPage() {
  const [q, setQ] = useState('');
  const query = useContactsList(q || undefined);

  const columns: EntityColumn<PublicContact>[] = [
    {
      header: 'Name',
      cell: (c) => [c.firstName, c.lastName].filter(Boolean).join(' '),
    },
    { header: 'Email', cell: (c) => c.email ?? '—' },
    { header: 'Title', cell: (c) => c.title ?? '—' },
    {
      header: 'Created',
      cell: (c) => new Date(c.createdAt).toLocaleDateString(),
      className: 'text-right text-sm text-neutral-500',
    },
  ];

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <CreateContactDialog trigger={<Button>New contact</Button>} />
      </div>
      <div className="mb-3">
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>
      {query.isPending ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : query.error ? (
        <p className="text-sm text-red-600">Failed to load contacts.</p>
      ) : (
        <EntityTable
          columns={columns}
          rows={query.data!.items}
          rowHref={(c) => `/app/contacts/${c.id}`}
          emptyMessage="No contacts yet. Add your first one."
        />
      )}
    </main>
  );
}
