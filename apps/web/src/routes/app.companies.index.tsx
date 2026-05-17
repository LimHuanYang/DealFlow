import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EntityTable, type EntityColumn } from '@/components/entity-table';
import { CreateCompanyDialog } from '@/features/companies/create-company-dialog';
import { useCompaniesList } from '@/features/companies/api';
import type { PublicCompany } from '@dealflow/shared';

export const Route = createFileRoute('/app/companies/')({
  component: CompaniesListPage,
});

function CompaniesListPage() {
  const [q, setQ] = useState('');
  const query = useCompaniesList(q || undefined);

  const columns: EntityColumn<PublicCompany>[] = [
    { header: 'Name', cell: (c) => c.name },
    { header: 'Domain', cell: (c) => c.domain ?? '—' },
    { header: 'Industry', cell: (c) => c.industry ?? '—' },
    {
      header: 'Created',
      cell: (c) => new Date(c.createdAt).toLocaleDateString(),
      className: 'text-right text-sm text-neutral-500',
    },
  ];

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <CreateCompanyDialog trigger={<Button>New company</Button>} />
      </div>
      <div className="mb-3">
        <Input
          placeholder="Search by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>
      {query.isPending ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : query.error ? (
        <p className="text-sm text-red-600">Failed to load companies.</p>
      ) : (
        <EntityTable
          columns={columns}
          rows={query.data!.items}
          rowHref={(c) => `/app/companies/${c.id}`}
          emptyMessage="No companies yet. Create your first one to get started."
        />
      )}
    </main>
  );
}
