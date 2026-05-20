import { z } from 'zod';

const uuid = z.string().uuid();

/** Body for POST /api/v1/emails. Sends to a single contact's email. */
export const sendEmailBodySchema = z.object({
  contactId: uuid,
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
});
export type SendEmailInput = z.infer<typeof sendEmailBodySchema>;
export interface SendEmailResponse {
  activity: import('./activities.js').PublicActivity;
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
  /** Formatted "Name <email>" string when enabled, else null. */
  from: string | null;
}
