import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldEntityType,
  UpdateCustomFieldBody,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useCustomFields(entityType: CustomFieldEntityType) {
  return useQuery({
    queryKey: queryKeys.customFields.list(entityType),
    queryFn: () => apiFetch<CustomFieldDefinition[]>(`/api/v1/custom-fields?entity=${entityType}`),
    staleTime: 60_000,
  });
}

export function useCreateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomFieldBody) =>
      apiFetch<CustomFieldDefinition>('/api/v1/custom-fields', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.customFields.list(created.entityType) });
    },
  });
}

export function useUpdateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateCustomFieldBody }) =>
      apiFetch<CustomFieldDefinition>(`/api/v1/custom-fields/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input.patch),
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.customFields.list(updated.entityType) });
    },
  });
}

export function useDeleteCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; entityType: CustomFieldEntityType }) =>
      apiFetch(`/api/v1/custom-fields/${input.id}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.customFields.list(vars.entityType) });
    },
  });
}
