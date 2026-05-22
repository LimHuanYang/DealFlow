import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CUSTOM_FIELD_ENTITY_TYPES, type CustomFieldDefinition, type CustomFieldEntityType } from '@dealflow/shared';
import { CustomFieldEditor } from './custom-field-editor';
import { useCustomFields, useDeleteCustomField } from './api';

const TABS: { key: CustomFieldEntityType; label: string }[] = [
  { key: 'contact',  label: 'Contacts'   },
  { key: 'company',  label: 'Companies'  },
  { key: 'deal',     label: 'Deals'      },
  { key: 'note',     label: 'Notes'      },
  { key: 'task',     label: 'Tasks'      },
];

export function CustomFieldsSettings() {
  const [tab, setTab] = useState<CustomFieldEntityType>(TABS[0]!.key);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | undefined>(undefined);
  const list = useCustomFields(tab);
  const del = useDeleteCustomField();
  void CUSTOM_FIELD_ENTITY_TYPES; // silence unused

  return (
    <main className="p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Custom fields</h1>
        <p className="text-sm text-neutral-500">Define your own fields per entity. Up to 50 chars per name.</p>
      </header>

      <div className="mb-3 flex items-center justify-between border-b border-neutral-200">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                tab === t.key
                  ? 'border-neutral-900 font-medium text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => { setEditing(undefined); setEditorOpen(true); }}>
          + Add field
        </Button>
      </div>

      {list.isPending && <p className="text-sm text-neutral-500">Loading…</p>}
      {list.data && list.data.length === 0 && (
        <p className="text-sm text-neutral-400">No custom fields yet — click + Add field to create one.</p>
      )}

      {list.data && list.data.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
          {list.data.map((def) => (
            <li key={def.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-900">{def.name}</div>
                <div className="text-xs text-neutral-500">
                  {def.type}{def.required ? ' · required' : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { setEditing(def); setEditorOpen(true); }}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(`Delete "${def.name}"? Values stored on existing ${tab}s will be hidden but not erased.`)) return;
                    await del.mutateAsync({ id: def.id, entityType: tab });
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CustomFieldEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        entityType={tab}
        existing={editing}
      />
    </main>
  );
}
