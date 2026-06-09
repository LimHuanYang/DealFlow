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
  /** When true, render inside a bordered card (used on detail pages). */
  card?: boolean;
  /**
   * When true, render the fields read-only: inputs are disabled and no
   * changes can be made. Used on detail pages when the viewer lacks write
   * access to the record (`disabled={!canWrite}`), so they don't see
   * editable inputs that the server would 403.
   */
  disabled?: boolean;
}

export function CustomFieldsBlock({
  entityType,
  values,
  onChange,
  showHeader = true,
  card = false,
  disabled = false,
}: Props) {
  const q = useCustomFields(entityType);
  if (q.isPending) return null;
  const defs = q.data ?? [];
  if (defs.length === 0) return null;

  return (
    <section
      className={
        card ? 'space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm' : 'space-y-3'
      }
      data-testid={`custom-fields-${entityType}`}
    >
      {showHeader && (
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Custom fields
        </div>
      )}
      {defs.map((def) => (
        <FieldRow
          key={def.id}
          def={def}
          value={values[def.id]}
          onChange={(v) => onChange(def.id, v)}
          disabled={disabled}
        />
      ))}
    </section>
  );
}

function FieldRow({
  def,
  value,
  onChange,
  disabled,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <Label htmlFor={`cf-${def.id}`} className="text-xs">
        {def.name}
        {def.required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <FieldInput def={def} value={value} onChange={onChange} id={`cf-${def.id}`} disabled={disabled} />
    </div>
  );
}

function FieldInput({
  def,
  value,
  onChange,
  id,
  disabled,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  id: string;
  disabled: boolean;
}) {
  const t: CustomFieldType = def.type;
  if (t === 'long_text') {
    return (
      <textarea
        id={id}
        rows={3}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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
        disabled={disabled}
        className="disabled:cursor-not-allowed disabled:opacity-60"
      />
    );
  }
  if (t === 'select') {
    return (
      <select
        id={id}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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
              disabled={disabled}
              onClick={() => onChange(on ? arr.filter((k) => k !== o.key) : [...arr, o.key])}
              className={`rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700'}`}
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
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        if (t === 'number') return onChange(Number(raw));
        onChange(raw);
      }}
    />
  );
}
