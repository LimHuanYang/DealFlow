import { z } from 'zod';
import { isSupportedCurrency } from './currency.js';

export const dealStatusSchema = z.enum(['open', 'won', 'lost']);
export type DealStatusValue = z.infer<typeof dealStatusSchema>;

export const createDealBodySchema = z.object({
  name: z.string().min(1).max(200),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  value: z.coerce.number().nonnegative().max(1_000_000_000).optional(),
  currency: z
    .string()
    .refine(isSupportedCurrency, { message: 'Unsupported currency code' })
    .optional(),
  primaryContactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  customFields: z.record(z.unknown()).optional(),
});

// `ownerUserId` lets owners/admins *reassign* a record to another user. The
// route enforces that only owner/admin may set it; a member who includes it is
// rejected (see deals routes / assertCanWrite). It is intentionally absent from
// `createDealBodySchema` — create always assigns ownership to the acting user
// server-side.
export const updateDealBodySchema = createDealBodySchema.partial().extend({
  ownerUserId: z.string().uuid().optional(),
});

export const moveDealBodySchema = z.object({
  stageId: z.string().uuid(),
  positionInStage: z.number(),
});

export type CreateDealInput = z.infer<typeof createDealBodySchema>;
export type UpdateDealInput = z.infer<typeof updateDealBodySchema>;
export type MoveDealInput = z.infer<typeof moveDealBodySchema>;

export interface PublicDeal {
  id: string;
  name: string;
  pipelineId: string;
  stageId: string;
  value: number | null;
  currency: string;
  primaryContactId: string | null;
  companyId: string | null;
  ownerUserId: string | null;
  expectedCloseDate: string | null;
  status: DealStatusValue;
  positionInStage: number;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}
