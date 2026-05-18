export const queryKeys = {
  me: ['auth', 'me'] as const,
  organization: ['organization', 'current'] as const,
  companies: {
    all: ['companies'] as const,
    list: (q?: string) => ['companies', 'list', { q: q ?? '' }] as const,
    detail: (id: string) => ['companies', 'detail', id] as const,
  },
  contacts: {
    all: ['contacts'] as const,
    list: (q?: string, companyId?: string) =>
      ['contacts', 'list', { q: q ?? '', companyId: companyId ?? '' }] as const,
    detail: (id: string) => ['contacts', 'detail', id] as const,
  },
  pipelines: {
    all: ['pipelines'] as const,
  },
  deals: {
    all: ['deals'] as const,
    list: (pipelineId?: string, status?: string) =>
      ['deals', 'list', { pipelineId: pipelineId ?? '', status: status ?? '' }] as const,
    detail: (id: string) => ['deals', 'detail', id] as const,
  },
};
