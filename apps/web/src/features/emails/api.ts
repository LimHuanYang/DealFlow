import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DraftEmailBodyInput,
  DraftEmailResponse,
  PublicActivity,
  PublicEmailStatus,
  SendEmailInput,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

interface SendEmailResponse {
  activity: PublicActivity;
}

export function useEmailStatus() {
  return useQuery({
    queryKey: queryKeys.emails.status,
    queryFn: () => apiFetch<PublicEmailStatus>('/api/v1/email/status'),
    staleTime: Infinity,
  });
}

export function useSendEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendEmailInput) =>
      apiFetch<SendEmailResponse>('/api/v1/emails', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      // The new activity belongs to a contact — invalidate that feed.
      const contactId = data.activity.contactId;
      if (contactId) {
        qc.invalidateQueries({ queryKey: ['activities', 'contact', contactId] });
      }
    },
  });
}

export function useDraftEmail() {
  return useMutation({
    mutationFn: (input: DraftEmailBodyInput) =>
      apiFetch<DraftEmailResponse>('/api/v1/ai/draft-email', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}
