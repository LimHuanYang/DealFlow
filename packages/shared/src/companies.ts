import { z } from 'zod';

export const createCompanyBodySchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().min(1).max(200).optional(),
  industry: z.string().min(1).max(100).optional(),
  size: z.string().min(1).max(50).optional(),
  website: z.string().url().max(500).optional(),
  description: z.string().max(5000).optional(),
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
