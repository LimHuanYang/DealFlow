import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateActivity } from './api';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';

type ParentFilter = { contactId: string } | { companyId: string } | { dealId: string };

interface AddTaskFormProps {
  parent: ParentFilter;
}

export function AddTaskForm({ parent }: AddTaskFormProps) {
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const create = useCreateActivity(parent);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    await create.mutateAsync({
      kind: 'task',
      body: trimmed,
      ...(dueAt ? { dueAt } : {}),
      customFields,
      ...parent,
    });
    setBody('');
    setDueAt('');
    setCustomFields({});
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What needs doing?"
        data-testid="add-task-input"
      />
      <CustomFieldsBlock
        entityType="task"
        values={customFields}
        onChange={(fieldId, value) => setCustomFields((prev) => ({ ...prev, [fieldId]: value }))}
      />
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="max-w-[160px]"
          data-testid="add-task-due"
        />
        <Button type="submit" size="sm" disabled={!body.trim() || create.isPending}>
          {create.isPending ? 'Adding…' : 'Add task'}
        </Button>
      </div>
    </form>
  );
}
