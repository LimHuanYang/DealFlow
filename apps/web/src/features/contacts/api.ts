import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type {
  CreateContactInput,
  PublicContact,
  UpdateContactInput,
} from '@dealflow/shared';

export interface ContactListResponse {
  items: PublicContact[];
  nextCursor: string | null;
}

export function listContacts(q?: string, companyId?: string): Promise<ContactListResponse> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (companyId) params.set('companyId', companyId);
  const qs = params.toString();
  return apiFetch<ContactListResponse>(`/api/v1/contacts${qs ? `?${qs}` : ''}`);
}

export function getContact(id: string): Promise<{ contact: PublicContact }> {
  return apiFetch(`/api/v1/contacts/${id}`);
}

export function createContact(input: CreateContactInput): Promise<{ contact: PublicContact }> {
  return apiFetch('/api/v1/contacts', { method: 'POST', body: JSON.stringify(input) });
}

export function updateContact(
  id: string,
  patch: UpdateContactInput,
): Promise<{ contact: PublicContact }> {
  return apiFetch(`/api/v1/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteContact(id: string): Promise<void> {
  return apiFetch(`/api/v1/contacts/${id}`, { method: 'DELETE' });
}

// ----- React Query hooks -----

export function useContactsList(q?: string, companyId?: string) {
  return useQuery({
    queryKey: queryKeys.contacts.list(q, companyId),
    queryFn: () => listContacts(q, companyId),
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.contacts.detail(id) : ['contacts', 'detail', 'none'],
    queryFn: () => getContact(id!),
    enabled: Boolean(id),
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateContactInput) => updateContact(id, patch),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.contacts.detail(id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteContact,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}
