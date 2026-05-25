import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DraftEmailBodyInput,
  DraftEmailResponse,
  EmailDashboardResponse,
  EmailEngagementRollup,
  PublicActivity,
  PublicEmailEvent,
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

interface EmailEventsResponse {
  items: PublicEmailEvent[];
}

export function useEmailEvents(activityId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.activities.events(activityId ?? ''),
    queryFn: () =>
      apiFetch<EmailEventsResponse>(`/api/v1/activities/${activityId}/events`),
    enabled: !!activityId,
  });
}

export function useEmailsList(params: { status?: string; range?: string; q?: string; cursor?: string | null }) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.range) qs.set('range', params.range);
  if (params.q) qs.set('q', params.q);
  if (params.cursor) qs.set('cursor', params.cursor);
  return useQuery({
    queryKey: queryKeys.emails.list(params),
    queryFn: () => apiFetch<EmailDashboardResponse>(`/api/v1/emails?${qs}`),
  });
}

export function useEmailEngagement(entityType: 'contact' | 'company' | 'deal', id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.emails.engagement(entityType, id ?? ''),
    queryFn: () =>
      apiFetch<EmailEngagementRollup>(`/api/v1/emails/engagement/${entityType}/${id}`),
    enabled: !!id,
  });
}
