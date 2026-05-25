import { z } from 'zod';

export const ACTIVITY_KINDS = ['note', 'task', 'email'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const TASK_STATUSES = ['open', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const uuid = z.string().uuid();

// "Date-only" input: the HTML <input type="date"> sends 'YYYY-MM-DD'. We also
// accept full ISO timestamps for API symmetry. The API layer converts the
// final value to a JS Date before storage.
const dueAtInput = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  z.string().datetime(),
]);

/**
 * Body for POST /api/v1/activities. Exactly one of `contactId`, `companyId`,
 * `dealId` must be set — refined below.
 */
export const createActivityBodySchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    body: z.string().min(1).max(8000),
    contactId: uuid.optional(),
    companyId: uuid.optional(),
    dealId: uuid.optional(),
    dueAt: dueAtInput.optional(),
    customFields: z.record(z.unknown()).optional(),
  })
  .refine(
    (v) => {
      const n = (v.contactId ? 1 : 0) + (v.companyId ? 1 : 0) + (v.dealId ? 1 : 0);
      return n === 1;
    },
    {
      message: 'Set exactly one of contactId, companyId, dealId',
      path: ['contactId'],
    },
  );
export type CreateActivityInput = z.infer<typeof createActivityBodySchema>;

/**
 * Body for PATCH /api/v1/activities/:id.
 *
 * `dueAt: null` is allowed to clear an existing due date. `status` set to
 * 'done' will cause the API layer to also stamp `completed_at = now()`.
 */
export const updateActivityBodySchema = z.object({
  body: z.string().min(1).max(8000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueAt: dueAtInput.nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});
export type UpdateActivityInput = z.infer<typeof updateActivityBodySchema>;

/**
 * Query for GET /api/v1/tasks.
 *   status: 'open' (default) | 'done'
 *   due: 'all' (default) | 'overdue' | 'today' | 'upcoming'
 */
export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).default('open'),
  due: z.enum(['all', 'overdue', 'today', 'upcoming']).default('all'),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export interface PublicActivity {
  id: string;
  kind: ActivityKind;
  body: string;
  subject: string | null;
  externalId: string | null;
  status: TaskStatus | null;
  dueAt: string | null; // ISO 8601 string when set
  completedAt: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  ownerUserId: string | null;
  customFields: Record<string, unknown>;
  // Email-tracking columns (defaults safe for non-email activities)
  ccEmails: string[] | null;
  bccEmails: string[] | null;
  trackingEnabled: boolean;
  deliveryStatus: 'sent' | 'failed';
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  clickCount: number;
  firstClickedAt: string | null;
  lastClickedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
