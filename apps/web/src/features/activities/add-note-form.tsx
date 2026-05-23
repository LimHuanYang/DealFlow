import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCreateActivity } from './api';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';

type ParentFilter = { contactId: string } | { companyId: string } | { dealId: string };

interface AddNoteFormProps {
  parent: ParentFilter;
}

export function AddNoteForm({ parent }: AddNoteFormProps) {
  const [body, setBody] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const create = useCreateActivity(parent);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    await create.mutateAsync({ kind: 'note', body: trimmed, customFields, ...parent });
    setBody('');
    setCustomFields({});
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note…"
        rows={3}
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
        data-testid="add-note-textarea"
      />
      <CustomFieldsBlock
        entityType="note"
        values={customFields}
        onChange={(fieldId, value) => setCustomFields((prev) => ({ ...prev, [fieldId]: value }))}
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" size="sm" disabled={!body.trim() || create.isPending}>
          {create.isPending ? 'Adding…' : 'Add note'}
        </Button>
      </div>
    </form>
  );
}
