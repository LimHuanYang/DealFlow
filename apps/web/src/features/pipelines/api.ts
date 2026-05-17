import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { PublicPipeline } from '@dealflow/shared';

export function listPipelines(): Promise<{ pipelines: PublicPipeline[] }> {
  return apiFetch('/api/v1/pipelines');
}

export function usePipelines() {
  return useQuery({
    queryKey: queryKeys.pipelines.all,
    queryFn: listPipelines,
    staleTime: 5 * 60 * 1000, // pipelines rarely change
  });
}
