import { z } from 'zod';
import { isSupportedCurrency } from './currency.js';

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  defaultCurrency: string;
}

export const updateOrganizationBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  defaultCurrency: z
    .string()
    .refine(isSupportedCurrency, { message: 'Unsupported currency code' })
    .optional(),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationBodySchema>;
