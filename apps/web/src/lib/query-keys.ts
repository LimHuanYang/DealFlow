export const queryKeys = {
  me: ['auth', 'me'] as const,
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
};
