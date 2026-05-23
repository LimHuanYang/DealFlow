import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldDefinition,
  type CustomFieldEntityType,
  type CustomFieldType,
} from '@dealflow/shared';
import { useCreateCustomField, useUpdateCustomField } from './api';

interface Props {
  open: boolean;
  onClose: () => void;
  entityType: CustomFieldEntityType;
  /** When set, the dialog edits this definition instead of creating a new one. */
  existing?: CustomFieldDefinition;
}

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  boolean: 'Checkbox',
  select: 'Single select',
  multi_select: 'Multi-select',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
};

function kebab(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'option'
  );
}

export function CustomFieldEditor({ open, onClose, entityType, existing }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);

  const create = useCreateCustomField();
  const update = useUpdateCustomField();
  const isEdit = !!existing;

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? '');
      setType(existing?.type ?? 'text');
      setOptionsText((existing?.options?.values ?? []).map((v) => v.label).join('\n'));
      setRequired(existing?.required ?? false);
    }
  }, [open, existing]);

  const needsOptions = type === 'select' || type === 'multi_select';

  async function onSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const options = needsOptions
      ? {
          values: optionsText
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((label) => ({ key: kebab(label), label })),
        }
      : null;

    if (isEdit) {
      await update.mutateAsync({ id: existing.id, patch: { name: trimmed, options, required } });
    } else {
      await create.mutateAsync({ entityType, name: trimmed, type, options, required });
    }
    onClose();
  }

  const submitting = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit custom field' : `Add a custom field for ${entityType}s`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="cf-name" className="text-xs">
              Field name
            </Label>
            <Input
              id="cf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lead Source"
            />
          </div>

          <div>
            <Label htmlFor="cf-type" className="text-xs">
              Type
            </Label>
            <select
              id="cf-type"
              disabled={isEdit}
              value={type}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
              className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-50"
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {isEdit && (
              <p className="mt-1 text-[11px] text-neutral-400">Type can't change after creation.</p>
            )}
          </div>

          {needsOptions && (
            <div>
              <Label htmlFor="cf-options" className="text-xs">
                Options (one per line)
              </Label>
              <textarea
                id="cf-options"
                rows={5}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={'Referral\nLinkedIn\nCold outreach'}
                className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            Required
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={!name.trim() || submitting}>
            {submitting ? 'Saving…' : 'Save field'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
