import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { PublicOrganization, UpdateOrganizationInput } from '@dealflow/shared';

interface CurrentOrgResponse {
  organization: PublicOrganization;
}

export function useCurrentOrg() {
  return useQuery({
    queryKey: queryKeys.organization,
    queryFn: () => apiFetch<CurrentOrgResponse>('/api/v1/organizations/current'),
  });
}

export function useUpdateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrganizationInput) =>
      apiFetch<CurrentOrgResponse>('/api/v1/organizations/current', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.organization, data);
    },
  });
}
