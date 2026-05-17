import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { CreateDealInput, PublicDeal, UpdateDealInput, MoveDealInput } from '@dealflow/shared';

export function listDeals(pipelineId?: string, status?: string): Promise<{ items: PublicDeal[] }> {
  const params = new URLSearchParams();
  if (pipelineId) params.set('pipelineId', pipelineId);
  if (status) params.set('status', status);
  const qs = params.toString();
  return apiFetch(`/api/v1/deals${qs ? `?${qs}` : ''}`);
}

export function getDeal(id: string): Promise<{ deal: PublicDeal }> {
  return apiFetch(`/api/v1/deals/${id}`);
}

export function createDeal(input: CreateDealInput): Promise<{ deal: PublicDeal }> {
  return apiFetch('/api/v1/deals', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDeal(id: string, patch: UpdateDealInput): Promise<{ deal: PublicDeal }> {
  return apiFetch(`/api/v1/deals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function moveDeal(id: string, input: MoveDealInput): Promise<{ deal: PublicDeal }> {
  return apiFetch(`/api/v1/deals/${id}/move`, { method: 'POST', body: JSON.stringify(input) });
}

export function deleteDeal(id: string): Promise<void> {
  return apiFetch(`/api/v1/deals/${id}`, { method: 'DELETE' });
}

export function useDealsList(pipelineId?: string, status?: string) {
  return useQuery({
    queryKey: queryKeys.deals.list(pipelineId, status),
    queryFn: () => listDeals(pipelineId, status),
    enabled: Boolean(pipelineId),
  });
}

export function useDeal(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.deals.detail(id) : ['deals', 'detail', 'none'],
    queryFn: () => getDeal(id!),
    enabled: Boolean(id),
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createDeal,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals.all });
    },
  });
}

export function useUpdateDeal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateDealInput) => updateDeal(id, patch),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.deals.detail(id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.deals.all });
    },
  });
}

/**
 * Optimistic moveDeal: instantly updates the cached list before the server
 * confirms. On failure, rolls back to the previous state and re-fetches.
 */
export function useMoveDeal(pipelineId?: string) {
  const qc = useQueryClient();
  const listKey = queryKeys.deals.list(pipelineId);
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & MoveDealInput) => moveDeal(id, input),
    onMutate: async ({ id, stageId, positionInStage }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<{ items: PublicDeal[] }>(listKey);
      if (prev) {
        qc.setQueryData<{ items: PublicDeal[] }>(listKey, {
          items: prev.items.map((d) => (d.id === id ? { ...d, stageId, positionInStage } : d)),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals.all });
    },
  });
}
