import { useQuery } from '@tanstack/react-query';
import type { DashboardResponse } from '@dealflow/shared';
import { queryKeys } from '@/lib/query-keys';
import { apiFetch } from '@/lib/api';

function fetchDashboard(): Promise<DashboardResponse> {
  // Route through the shared apiFetch so the request targets API_BASE
  // (http://localhost:3001) like every other feature. A bare relative
  // fetch() hits the Vite dev origin (5173), which has no /api proxy and
  // returns the SPA HTML — that's what previously broke this page.
  return apiFetch<DashboardResponse>('/api/v1/reports/dashboard');
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
