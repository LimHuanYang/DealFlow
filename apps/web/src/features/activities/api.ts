import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateActivityInput,
  ListTasksQuery,
  PublicActivity,
  UpdateActivityInput,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

interface ActivitiesListResponse {
  items: PublicActivity[];
}

interface ActivityResponse {
  activity: PublicActivity;
}

type ParentFilter =
  | { contactId: string }
  | { companyId: string }
  | { dealId: string };

function parentQueryString(p: ParentFilter): string {
  if ('contactId' in p) return `contactId=${p.contactId}`;
  if ('companyId' in p) return `companyId=${p.companyId}`;
  return `dealId=${p.dealId}`;
}

function parentQueryKey(p: ParentFilter) {
  if ('contactId' in p) return queryKeys.activities.forContact(p.contactId);
  if ('companyId' in p) return queryKeys.activities.forCompany(p.companyId);
  return queryKeys.activities.forDeal(p.dealId);
}

export function useActivitiesFor(parent: ParentFilter) {
  return useQuery({
    queryKey: parentQueryKey(parent),
    queryFn: () =>
      apiFetch<ActivitiesListResponse>(`/api/v1/activities?${parentQueryString(parent)}`),
  });
}

export function useCreateActivity(parent: ParentFilter) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) =>
      apiFetch<ActivityResponse>('/api/v1/activities', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: parentQueryKey(parent) });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateActivity(parent: ParentFilter) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateActivityInput }) =>
      apiFetch<ActivityResponse>(`/api/v1/activities/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: parentQueryKey(parent) });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteActivity(parent: ParentFilter) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/activities/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: parentQueryKey(parent) });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/** Used by the global /app/tasks page. */
export function useTasks(query: ListTasksQuery) {
  return useQuery({
    queryKey: queryKeys.tasks.list(query.status, query.due),
    queryFn: () =>
      apiFetch<ActivitiesListResponse>(
        `/api/v1/tasks?status=${query.status}&due=${query.due}`,
      ),
  });
}

/**
 * Mutations for the /app/tasks page where parent context isn't available.
 * Invalidates the tasks key (any filter) plus all activities keys so feeds
 * on entity detail pages stay fresh.
 */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateActivityInput }) =>
      apiFetch<ActivityResponse>(`/api/v1/activities/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
