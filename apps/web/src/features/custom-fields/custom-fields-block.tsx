import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldType,
} from '@dealflow/shared';
import { useCustomFields } from './api';

interface Props {
  entityType: CustomFieldEntityType;
  /** Current values keyed by definition.id */
  values: Record<string, unknown>;
  /** Called when a single field changes. Pass `null` to clear. */
  onChange: (fieldId: string, value: unknown) => void;
  /** When true, header label + section divider render. */
  showHeader?: boolean;
}

export function CustomFieldsBlock({ entityType, values, onChange, showHeader = true }: Props) {
  const q = useCustomFields(entityType);
  if (q.isPending) return null;
  const defs = q.data ?? [];
  if (defs.length === 0) return null;

  return (
    <section className="space-y-3" data-testid={`custom-fields-${entityType}`}>
      {showHeader && (
        <div className="text-xs uppercase tracking-wide text-neutral-400">Custom fields</div>
      )}
      {defs.map((def) => (
        <FieldRow
          key={def.id}
          def={def}
          value={values[def.id]}
          onChange={(v) => onChange(def.id, v)}
        />
      ))}
    </section>
  );
}

function FieldRow({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div>
      <Label htmlFor={`cf-${def.id}`} className="text-xs">
        {def.name}
        {def.required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <FieldInput def={def} value={value} onChange={onChange} id={`cf-${def.id}`} />
    </div>
  );
}

function FieldInput({
  def,
  value,
  onChange,
  id,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  id: string;
}) {
  const t: CustomFieldType = def.type;
  if (t === 'long_text') {
    return (
      <textarea
        id={id}
        rows={3}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
      />
    );
  }
  if (t === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (t === 'select') {
    return (
      <select
        id={id}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
      >
        <option value="">— Select —</option>
        {def.options?.values.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (t === 'multi_select') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-1">
        {def.options?.values.map((o) => {
          const on = arr.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange(on ? arr.filter((k) => k !== o.key) : [...arr, o.key])}
              className={`rounded-md border px-2 py-1 text-xs ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700'}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  const htmlType =
    t === 'number'
      ? 'number'
      : t === 'date'
        ? 'date'
        : t === 'email'
          ? 'email'
          : t === 'url'
            ? 'url'
            : t === 'phone'
              ? 'tel'
              : 'text';
  return (
    <Input
      id={id}
      type={htmlType}
      value={value == null ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        if (t === 'number') return onChange(Number(raw));
        onChange(raw);
      }}
    />
  );
}
