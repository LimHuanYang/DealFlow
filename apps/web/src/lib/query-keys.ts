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
  activities: {
    forContact: (id: string) => ['activities', 'contact', id] as const,
    forCompany: (id: string) => ['activities', 'company', id] as const,
    forDeal: (id: string) => ['activities', 'deal', id] as const,
    detail: (id: string) => ['activities', 'detail', id] as const,
    events: (id: string) => ['activities', 'detail', id, 'events'] as const,
  },
  tasks: {
    list: (status: string, due: string) => ['tasks', 'list', { status, due }] as const,
  },
  ai: {
    status: ['ai', 'status'] as const,
  },
  emails: {
    status: ['emails', 'status'] as const,
    list: (params: { status?: string; range?: string; q?: string; cursor?: string | null }) =>
      ['emails', 'list', params] as const,
    engagement: (entityType: string, id: string) =>
      ['emails', 'engagement', entityType, id] as const,
  },
  integrations: {
    current: ['integrations', 'current'] as const,
  },
  reports: {
    dashboard: ['reports', 'dashboard'] as const,
  },
  customFields: {
    list: (entityType: string) => ['custom-fields', 'list', entityType] as const,
  },
  members: {
    all: ['members'] as const,
    list: () => ['members', 'list'] as const,
  },
  invitations: {
    all: ['invitations'] as const,
    list: () => ['invitations', 'list'] as const,
  },
  orgs: {
    all: ['orgs'] as const,
    list: () => ['orgs', 'list'] as const,
  },
  membership: {
    current: ['membership', 'current'] as const,
  },
};
