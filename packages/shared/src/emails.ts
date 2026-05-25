import { z } from 'zod';
import type { PublicActivity } from './activities.js';

const uuid = z.string().uuid();

/** Body for POST /api/v1/emails. Sends to a single contact's email. */
export const sendEmailBodySchema = z.object({
  contactId: uuid,
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
  cc: z.array(z.string().email()).max(20).optional(),
  bcc: z.array(z.string().email()).max(20).optional(),
  trackEnabled: z.boolean().optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailBodySchema>;
export interface SendEmailResponse {
  activity: PublicActivity;
}

/** Body for POST /api/v1/ai/draft-email. */
export const draftEmailBodySchema = z.object({
  contactId: uuid,
  intent: z.string().min(1).max(500),
});
export type DraftEmailBodyInput = z.infer<typeof draftEmailBodySchema>;
export interface DraftEmailResponse {
  subject: string;
  body: string;
}

/** Public response from GET /api/v1/email/status. */
export interface PublicEmailStatus {
  enabled: boolean;
  /** Raw sender email address when enabled, else null. The UI displays it as-is; the API layer wraps it as "{userName} <{from}>" per-email. */
  from: string | null;
}
