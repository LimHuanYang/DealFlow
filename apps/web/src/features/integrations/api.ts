import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PublicIntegrations,
  TestAIInput,
  TestResultResponse,
  UpdateIntegrationsInput,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useIntegrations() {
  return useQuery({
    queryKey: queryKeys.integrations.current,
    queryFn: () => apiFetch<PublicIntegrations>('/api/v1/integrations'),
  });
}

export function useUpdateIntegrations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIntegrationsInput) =>
      apiFetch<PublicIntegrations>('/api/v1/integrations', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.integrations.current, data);
      // Email + AI status hooks read from the same backend; invalidate so the
      // Email button / AI buttons across the app refresh.
      qc.invalidateQueries({ queryKey: ['emails', 'status'] });
      qc.invalidateQueries({ queryKey: ['ai', 'status'] });
    },
  });
}

export function useTestAI() {
  return useMutation({
    mutationFn: (input: TestAIInput) =>
      apiFetch<TestResultResponse>('/api/v1/integrations/test-ai', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useTestEmail() {
  return useMutation({
    mutationFn: () =>
      apiFetch<TestResultResponse>('/api/v1/integrations/test-email', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  });
}
