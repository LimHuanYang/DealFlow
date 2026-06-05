import { z } from 'zod';
import { blankToUndefined } from './zod-helpers.js';

export const createCompanyBodySchema = z.object({
  name: z.string().min(1).max(200),
  // Optional text fields: blank form inputs ("") are treated as omitted so the
  // create/edit dialogs don't silently fail on empty values.
  domain: blankToUndefined(z.string().min(1).max(200).optional()),
  industry: blankToUndefined(z.string().min(1).max(100).optional()),
  size: blankToUndefined(z.string().min(1).max(50).optional()),
  website: blankToUndefined(z.string().url().max(500).optional()),
  description: blankToUndefined(z.string().max(5000).optional()),
  customFields: z.record(z.unknown()).optional(),
});

export const updateCompanyBodySchema = createCompanyBodySchema.partial();

export type CreateCompanyInput = z.infer<typeof createCompanyBodySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanyBodySchema>;

/** Public-facing company shape returned by the API. */
export interface PublicCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  description: string | null;
  ownerUserId: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
