import { useCompaniesList } from './api';

interface CompanySelectProps {
  /** Currently linked company id, or null/undefined when none. */
  value: string | null | undefined;
  /** Called with the chosen company id, or null when "No company" is picked. */
  onChange: (companyId: string | null) => void;
  id?: string;
  className?: string;
  /** Disable the select (e.g. gate by role/ownership). */
  disabled?: boolean;
}

/**
 * Dropdown of the org's companies for linking a contact (or other entity) to a
 * company. Emits `null` for the "— No company —" option so callers can clear
 * the association. Companies are loaded via the shared list hook.
 */
export function CompanySelect({ value, onChange, id, className, disabled }: CompanySelectProps) {
  const { data, isPending } = useCompaniesList();
  const companies = data?.items ?? [];

  return (
    <select
      id={id}
      data-testid="company-select"
      className={
        className ??
        'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm disabled:opacity-60'
      }
      value={value ?? ''}
      disabled={isPending || disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">— No company —</option>
      {companies.map((co) => (
        <option key={co.id} value={co.id}>
          {co.name}
        </option>
      ))}
    </select>
  );
}
