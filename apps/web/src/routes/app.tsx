import { createFileRoute, Outlet, redirect, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { getMe, logout } from '@/lib/auth';
import { CommandPalette } from '@/components/command-palette';

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
    <div className="flex min-h-screen bg-white">
      <aside className="hidden w-48 shrink-0 border-r border-neutral-200 p-4 md:block">
        <nav className="flex flex-col gap-1 text-sm">
          <Link
            to="/app/contacts"
            className="rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
            activeProps={{
              className: 'rounded px-2 py-1.5 bg-neutral-100 font-medium text-neutral-900',
            }}
          >
            Contacts
          </Link>
          <Link
            to="/app/companies"
            className="rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
            activeProps={{
              className: 'rounded px-2 py-1.5 bg-neutral-100 font-medium text-neutral-900',
            }}
          >
            Companies
          </Link>
          <Link
            to="/app/deals"
            className="rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
            activeProps={{
              className: 'rounded px-2 py-1.5 bg-neutral-100 font-medium text-neutral-900',
            }}
          >
            Deals
          </Link>
          <Link
            to="/app/settings"
            className="rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
            activeProps={{
              className: 'rounded px-2 py-1.5 bg-neutral-100 font-medium text-neutral-900',
            }}
          >
            Settings
          </Link>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
          <span className="font-semibold tracking-tight">DealFlow</span>
          <div className="flex items-center gap-3 text-sm">
            <kbd className="hidden rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-xs text-neutral-500 md:inline">
              {shortcutLabel}
            </kbd>
            {user && <span className="text-neutral-700">{user.email}</span>}
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
