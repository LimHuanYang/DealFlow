import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface InlineEditProps {
  value: string | null;
  placeholder?: string;
  onSave: (value: string) => void | Promise<void>;
  /** When true, render text muted (e.g. for nullable fields). */
  muted?: boolean;
  /** Custom class name on the read-mode span. */
  className?: string;
  /**
   * When true, render the value as plain text with no edit affordance
   * (used to gate editing by role/ownership). Keeps `muted` styling.
   */
  disabled?: boolean;
}

/**
 * Click-to-edit text field. Press Enter or blur to save, Esc to cancel.
 * No optimistic UI here — that lives in the calling mutation hook.
 */
export function InlineEdit({
  value,
  placeholder,
  onSave,
  muted,
  className,
  disabled,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  async function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value ?? '')) {
      await onSave(next);
    }
  }

  // Read-only: plain text, no button, no hover/edit affordance.
  if (disabled) {
    return (
      <span
        className={cn(
          'px-1 py-0.5 text-left',
          muted && !value && 'italic text-neutral-400',
          className,
        )}
      >
        {value ?? placeholder ?? '—'}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          'rounded px-1 py-0.5 text-left hover:bg-neutral-100',
          muted && !value && 'italic text-neutral-400',
          className,
        )}
        onClick={() => setEditing(true)}
      >
        {value ?? placeholder ?? '—'}
      </button>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          setDraft(value ?? '');
          setEditing(false);
        }
      }}
      className="h-7 px-1 py-0.5"
    />
  );
}
