import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  ExtractContactResponse,
  PublicAIStatus,
  SummarizeActivityInput,
  SummarizeActivityResponse,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useAIStatus() {
  return useQuery({
    queryKey: queryKeys.ai.status,
    queryFn: () => apiFetch<PublicAIStatus>('/api/v1/ai/status'),
    staleTime: Infinity, // env-driven; refresh on page reload
  });
}

export function useSummarizeActivity() {
  return useMutation({
    mutationFn: (input: SummarizeActivityInput) =>
      apiFetch<SummarizeActivityResponse>('/api/v1/ai/summarize-activity', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useExtractContact() {
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<ExtractContactResponse>('/api/v1/ai/extract-contact', {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
  });
}
