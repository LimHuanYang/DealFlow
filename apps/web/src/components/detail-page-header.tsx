import type { ReactNode } from 'react';

interface DetailPageHeaderProps {
  /** Icon or initials rendered inside the indigo avatar square. */
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  /** Optional right-aligned action (e.g. an Email button). */
  action?: ReactNode;
  titleTestId?: string;
}

/**
 * Consistent header for entity detail pages (contact / company / deal /
 * activity): an accent avatar, the title, a muted subtitle, and an optional
 * action on the right.
 */
export function DetailPageHeader({
  icon,
  title,
  subtitle,
  action,
  titleTestId,
}: DetailPageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-lg font-semibold text-accent-foreground">
          {icon}
        </span>
        <div className="min-w-0">
          <h1
            className="truncate text-2xl font-semibold tracking-tight text-slate-900"
            data-testid={titleTestId}
          >
            {title}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
