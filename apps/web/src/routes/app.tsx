import { createFileRoute, Outlet, redirect, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Users,
  Building2,
  CircleDollarSign,
  ListChecks,
  Mail,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { getMe, logout } from '@/lib/auth';
import { CommandPalette } from '@/components/command-palette';
import { OrgSwitcher } from '@/features/members/org-switcher';

const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/contacts', label: 'Contacts', icon: Users },
  { to: '/app/companies', label: 'Companies', icon: Building2 },
  { to: '/app/deals', label: 'Deals', icon: CircleDollarSign },
  { to: '/app/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/app/emails', label: 'Emails', icon: Mail },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

const NAV_BASE =
  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors';
const NAV_INACTIVE = `${NAV_BASE} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
const NAV_ACTIVE = `${NAV_BASE} bg-accent text-accent-foreground`;

/** Two-letter initials from a name (or email local-part) for the avatar. */
function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0]! : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : base.slice(0, 2);
  return letters.toUpperCase();
}

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    // Redirect unauthenticated users to /login. We hit /me directly here
    // (not via TanStack Query) because beforeLoad runs outside React.
    const me = await getMe();
    if (!me) throw redirect({ to: '/login' });
  },
  component: AppLayout,
});

/**
 * Returns the OS-appropriate label for the Cmd-K palette shortcut.
 * macOS / iOS show the ⌘ glyph (Apple convention); Windows / Linux / others
 * show `Ctrl+K` (cross-desktop convention). The palette listens for either
 * modifier, so functionality is unaffected — only the display label changes.
 */
function getShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+K';
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K';
}

function AppLayout() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
  });
  const user = meQuery.data?.user;
  const shortcutLabel = getShortcutLabel();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm">
            DF
          </span>
          <span className="text-base font-semibold tracking-tight text-slate-900">DealFlow</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={NAV_INACTIVE} activeProps={{ className: NAV_ACTIVE }}>
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-400 md:hidden">DealFlow</span>
            <OrgSwitcher />
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <kbd className="hidden items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-400 md:inline-flex">
              {shortcutLabel}
            </kbd>
            {user && (
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                  {initials(user.name || user.email)}
                </span>
                <span className="hidden text-slate-600 sm:inline">{user.email}</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await logout();
                } catch (err) {
                  // Don't block the user from leaving if the API call fails —
                  // the local cache + redirect still gets them off authed UI.
                  console.error('logout failed', err);
                }
                queryClient.setQueryData(queryKeys.me, null);
                window.location.href = '/login';
              }}
            >
              Sign out
            </Button>
          </div>
        </header>

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>

      <CommandPalette />
    </div>
  );
}
