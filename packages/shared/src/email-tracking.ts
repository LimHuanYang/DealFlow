import { z } from 'zod';

export const EMAIL_EVENT_TYPES = ['sent', 'open', 'click'] as const;
export const emailEventTypeSchema = z.enum(EMAIL_EVENT_TYPES);
export type EmailEventType = z.infer<typeof emailEventTypeSchema>;

export const publicEmailEventSchema = z.object({
  id: z.string().uuid(),
  eventType: emailEventTypeSchema,
  url: z.string().nullable(),
  occurredAt: z.string(),
});
export type PublicEmailEvent = z.infer<typeof publicEmailEventSchema>;

export const publicEmailRowSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().nullable(),
  recipientName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  sentAt: z.string(),
  deliveryStatus: z.enum(['sent', 'failed']),
  openCount: z.number().int().nonnegative(),
  clickCount: z.number().int().nonnegative(),
});
export type PublicEmailRow = z.infer<typeof publicEmailRowSchema>;

export const emailEngagementRollupSchema = z.object({
  sent: z.number().int().nonnegative(),
  opened: z.number().int().nonnegative(),
  openedPct: z.number().min(0).max(1),
  clickedWith: z.number().int().nonnegative(),
  clickedWithPct: z.number().min(0).max(1),
  lastActivityAt: z.string().nullable(),
});
export type EmailEngagementRollup = z.infer<typeof emailEngagementRollupSchema>;

export const EMAIL_ROLLUP_ENTITY_TYPES = ['contact', 'company', 'deal'] as const;
export const emailRollupEntityTypeSchema = z.enum(EMAIL_ROLLUP_ENTITY_TYPES);
export type EmailRollupEntityType = z.infer<typeof emailRollupEntityTypeSchema>;

export const EMAIL_DASHBOARD_STATUSES = ['all', 'opened', 'clicked', 'failed'] as const;
export const EMAIL_DASHBOARD_RANGES = ['7d', '30d', 'all'] as const;
export const emailDashboardQuerySchema = z.object({
  status: z.enum(EMAIL_DASHBOARD_STATUSES).default('all'),
  range: z.enum(EMAIL_DASHBOARD_RANGES).default('7d'),
  q: z.string().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type EmailDashboardQuery = z.infer<typeof emailDashboardQuerySchema>;

export interface EmailDashboardResponse {
  items: PublicEmailRow[];
  nextCursor: string | null;
}
