import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { getMe, logout } from '@/lib/auth';

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    // Redirect unauthenticated users to /login. We hit /me directly here
    // (not via TanStack Query) because beforeLoad runs outside React.
    const me = await getMe();
    if (!me) throw redirect({ to: '/login' });
  },
  component: AppLayout,
});

function AppLayout() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
  });

  const user = meQuery.data?.user;

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
        <span className="font-semibold tracking-tight">DealFlow</span>
        <div className="flex items-center gap-3 text-sm">
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
      <Outlet />
    </div>
  );
}
