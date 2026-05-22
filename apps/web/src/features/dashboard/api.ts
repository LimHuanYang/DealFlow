import { useQuery } from '@tanstack/react-query';
import type { DashboardResponse } from '@dealflow/shared';
import { queryKeys } from '@/lib/query-keys';

async function fetchDashboard(): Promise<DashboardResponse> {
  const res = await fetch('/api/v1/reports/dashboard', { credentials: 'include' });
  if (!res.ok) throw new Error(`Dashboard request failed: ${res.status}`);
  return (await res.json()) as DashboardResponse;
}

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.reports.dashboard,
    queryFn: fetchDashboard,
    // The page is the home — let it re-fetch when the tab regains focus, but
    // don't hammer the API on every navigation. 30s stale is plenty for a
    // CEO dashboard.
    staleTime: 30_000,
  });
}
