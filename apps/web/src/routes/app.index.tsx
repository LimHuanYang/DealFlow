import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { getMe } from '@/lib/auth';

export const Route = createFileRoute('/app/')({
  component: AppHome,
});

function AppHome() {
  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
  });
  const user = meQuery.data?.user;

  return (
    <main className="p-8">
      <h1 className="text-3xl font-semibold tracking-tight" data-testid="welcome">
        Welcome, {user?.name ?? '…'}
      </h1>
      <p className="mt-2 text-sm text-neutral-500">
        This is the Phase 1 placeholder. Real CRM features arrive in Sub-Plans 3 and onwards.
      </p>
    </main>
  );
}
