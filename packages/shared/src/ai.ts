import { z } from 'zod';

const uuid = z.string().uuid();

/** Public response from `GET /api/v1/ai/status`. */
export interface PublicAIStatus {
  enabled: boolean;
  providers: Array<{ name: string; model: string }>;
}

export const summarizeActivityBodySchema = z
  .object({
    contactId: uuid.optional(),
    companyId: uuid.optional(),
    dealId: uuid.optional(),
  })
  .refine(
    (v) => (v.contactId ? 1 : 0) + (v.companyId ? 1 : 0) + (v.dealId ? 1 : 0) === 1,
    { message: 'Set exactly one of contactId, companyId, dealId' },
  );
export type SummarizeActivityInput = z.infer<typeof summarizeActivityBodySchema>;
export interface SummarizeActivityResponse {
  summary: string;
}

export const extractContactBodySchema = z.object({
  text: z.string().min(1).max(10000),
});
export type ExtractContactBodyInput = z.infer<typeof extractContactBodySchema>;

export interface ExtractedContact {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  companyName?: string;
}
export interface ExtractContactResponse {
  extracted: ExtractedContact;
}
