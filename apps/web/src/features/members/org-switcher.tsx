import { Check, ChevronDown } from 'lucide-react';
import type { PublicOrgSummary } from '@dealflow/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/features/organizations/api';
import { useOrgs, useSwitchOrg } from './api';

// Stable indigo + slate-blue palette for org tiles. Hash the org id so the
// same org always gets the same colour, even if it isn't the "current" one.
const ORG_COLORS = [
  'bg-indigo-600',
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
] as const;

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ORG_COLORS[Math.abs(hash) % ORG_COLORS.length]!;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function OrgSquare({ id, name, size = 'sm' }: { id: string; name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 'h-[22px] w-[22px] text-[11px]' : 'h-5 w-5 text-[10px]';
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md font-bold text-white',
        dim,
        colorFor(id),
      )}
    >
      {initials(name).slice(0, 2)}
    </span>
  );
}

function RoleChip({ role }: { role: PublicOrgSummary['role'] }) {
  return (
    <span className="ml-auto text-[11px] capitalize text-slate-400">{role}</span>
  );
}

export function OrgSwitcher() {
  const orgsQuery = useOrgs();
  const currentOrgQuery = useCurrentOrg();
  const switchOrg = useSwitchOrg();

  // Failure states should never break the header. Hide silently while loading
  // or on error and let the rest of the header render normally.
  if (orgsQuery.isPending || currentOrgQuery.isPending) {
    return (
      <div
        aria-hidden
        className="hidden h-9 w-36 animate-pulse rounded-lg bg-slate-100 sm:block"
      />
    );
  }
  if (orgsQuery.error || currentOrgQuery.error) {
    return null;
  }

  const orgs = orgsQuery.data?.orgs ?? [];
  const current = currentOrgQuery.data?.organization;
  if (orgs.length === 0 || !current) {
    return null;
  }

  // Degrade gracefully when there's only one org. TODO(create-org): once a
  // signed-in user can create another org from the UI, surface the switcher
  // even in the single-org case for the "+ Create organization" affordance.
  if (orgs.length === 1) {
    return null;
  }

  function handleSelect(org: PublicOrgSummary) {
    if (!current || org.id === current.id || switchOrg.isPending) return;
    switchOrg.mutate({ organizationId: org.id });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={switchOrg.isPending}
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors',
          'hover:bg-slate-50',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        aria-label={`Switch organization — current is ${current.name}`}
      >
        <OrgSquare id={current.id} name={current.name} />
        <span className="max-w-[12rem] truncate">{current.name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={2.25} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-60 p-1.5">
        <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Your organizations
        </DropdownMenuLabel>
        {orgs.map((org) => {
          const isCurrent = org.id === current.id;
          return (
            <DropdownMenuItem
              key={org.id}
              onSelect={(e) => {
                e.preventDefault();
                handleSelect(org);
              }}
              disabled={switchOrg.isPending && !isCurrent}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
                isCurrent ? 'font-semibold text-slate-900' : 'text-slate-700',
              )}
            >
              <OrgSquare id={org.id} name={org.name} size="md" />
              <span className="truncate">{org.name}</span>
              {isCurrent ? (
                <Check className="ml-auto h-4 w-4 text-primary" strokeWidth={2.5} />
              ) : (
                <RoleChip role={org.role} />
              )}
            </DropdownMenuItem>
          );
        })}
        {/*
          TODO(create-org): no in-app flow exists yet for an authed user to
          create another org. The signup route only creates one as part of
          account creation. Add a "+ Create organization" item here once a
          dedicated POST /orgs endpoint + creation dialog land.
        */}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
