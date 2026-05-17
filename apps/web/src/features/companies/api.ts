import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { CreateCompanyInput, PublicCompany, UpdateCompanyInput } from '@dealflow/shared';

export interface CompanyListResponse {
  items: PublicCompany[];
  nextCursor: string | null;
}

export function listCompanies(q?: string): Promise<CompanyListResponse> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const qs = params.toString();
  return apiFetch<CompanyListResponse>(`/api/v1/companies${qs ? `?${qs}` : ''}`);
}

export function getCompany(id: string): Promise<{ company: PublicCompany }> {
  return apiFetch(`/api/v1/companies/${id}`);
}

export function createCompany(input: CreateCompanyInput): Promise<{ company: PublicCompany }> {
  return apiFetch('/api/v1/companies', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCompany(
  id: string,
  patch: UpdateCompanyInput,
): Promise<{ company: PublicCompany }> {
  return apiFetch(`/api/v1/companies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteCompany(id: string): Promise<void> {
  return apiFetch(`/api/v1/companies/${id}`, { method: 'DELETE' });
}

// ----- React Query hooks -----

export function useCompaniesList(q?: string) {
  return useQuery({
    queryKey: queryKeys.companies.list(q),
    queryFn: () => listCompanies(q),
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.companies.detail(id) : ['companies', 'detail', 'none'],
    queryFn: () => getCompany(id!),
    enabled: Boolean(id),
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCompany,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });
}

export function useUpdateCompany(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateCompanyInput) => updateCompany(id, patch),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.companies.detail(id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteCompany,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });
}
