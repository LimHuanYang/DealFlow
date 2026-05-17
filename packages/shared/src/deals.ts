import { z } from 'zod';

export const dealStatusSchema = z.enum(['open', 'won', 'lost']);
export type DealStatusValue = z.infer<typeof dealStatusSchema>;

export const createDealBodySchema = z.object({
  name: z.string().min(1).max(200),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  value: z.coerce.number().nonnegative().max(1_000_000_000).optional(),
  currency: z.string().length(3).optional(),
  primaryContactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateDealBodySchema = createDealBodySchema.partial();

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
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}
