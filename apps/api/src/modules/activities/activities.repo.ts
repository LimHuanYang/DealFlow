import { and, desc, eq, gt, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { CreateActivityInput, ListTasksQuery, UpdateActivityInput } from '@dealflow/shared';

export interface CreateActivityEmailExtras {
  ccEmails?: string[] | null;
  bccEmails?: string[] | null;
  trackingEnabled?: boolean;
  deliveryStatus?: 'sent' | 'failed';
}

export interface ListForParentQuery {
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export class ActivitiesRepo {
  constructor(private readonly db: Database) {}

  /**
   * Insert a new note or task. Tasks default to status='open'. The caller is
   * responsible for asserting the parent entity (contact/company/deal) lives
   * in the same org — the route layer does that before calling create().
   */
  async create(
    organizationId: string,
    ownerUserId: string,
    input: CreateActivityInput & CreateActivityEmailExtras,
  ): Promise<typeof schema.activities.$inferSelect> {
    const [row] = await this.db
      .insert(schema.activities)
      .values({
        organizationId,
        ownerUserId,
        kind: input.kind,
        body: input.body,
        status: input.kind === 'task' ? 'open' : null,
        dueAt: input.dueAt ? parseDueAt(input.dueAt) : null,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        customFields: input.customFields ?? {},
        ccEmails: input.ccEmails ?? null,
        bccEmails: input.bccEmails ?? null,
        trackingEnabled: input.trackingEnabled ?? true,
        deliveryStatus: input.deliveryStatus ?? 'sent',
      })
      .returning();
    if (!row) throw new Error('Failed to insert activity');
    return row;
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<typeof schema.activities.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.activities)
      .where(
        and(eq(schema.activities.organizationId, organizationId), eq(schema.activities.id, id)),
      )
      .limit(1);
    return row ?? null;
  }

  async listForParent(
    organizationId: string,
    parent: ListForParentQuery,
  ): Promise<(typeof schema.activities.$inferSelect)[]> {
    const conds = [eq(schema.activities.organizationId, organizationId)];
    if (parent.contactId) conds.push(eq(schema.activities.contactId, parent.contactId));
    else if (parent.companyId) conds.push(eq(schema.activities.companyId, parent.companyId));
    else if (parent.dealId) conds.push(eq(schema.activities.dealId, parent.dealId));
    else throw new Error('listForParent requires one parent id');

    return this.db
      .select()
      .from(schema.activities)
      .where(and(...conds))
      .orderBy(desc(schema.activities.createdAt));
  }

  async listTasks(
    organizationId: string,
    q: ListTasksQuery,
  ): Promise<(typeof schema.activities.$inferSelect)[]> {
    const conds = [
      eq(schema.activities.organizationId, organizationId),
      eq(schema.activities.kind, 'task'),
      eq(schema.activities.status, q.status),
    ];

    if (q.due !== 'all') {
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

      if (q.due === 'overdue') {
        conds.push(isNotNull(schema.activities.dueAt));
        conds.push(lt(schema.activities.dueAt, startOfToday));
      } else if (q.due === 'today') {
        conds.push(gte(schema.activities.dueAt, startOfToday));
        conds.push(lt(schema.activities.dueAt, startOfTomorrow));
      } else if (q.due === 'upcoming') {
        conds.push(gte(schema.activities.dueAt, startOfTomorrow));
      }
    }

    return this.db
      .select()
      .from(schema.activities)
      .where(and(...conds))
      .orderBy(sql`${schema.activities.dueAt} ASC NULLS LAST`, desc(schema.activities.createdAt));
  }

  /**
   * Partial update. When `status` toggles, `completed_at` is bumped to NOW()
   * (on done) or cleared (on open). Other fields pass through.
   */
  async update(
    organizationId: string,
    id: string,
    patch: UpdateActivityInput,
  ): Promise<typeof schema.activities.$inferSelect | null> {
    const set: Partial<typeof schema.activities.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (patch.body !== undefined) set.body = patch.body;
    if (patch.dueAt !== undefined) {
      set.dueAt = patch.dueAt === null ? null : parseDueAt(patch.dueAt);
    }
    if (patch.status !== undefined) {
      set.status = patch.status;
      set.completedAt = patch.status === 'done' ? new Date() : null;
    }
    if (patch.customFields !== undefined) {
      set.customFields = patch.customFields;
    }

    const [row] = await this.db
      .update(schema.activities)
      .set(set)
      .where(
        and(eq(schema.activities.organizationId, organizationId), eq(schema.activities.id, id)),
      )
      .returning();
    return row ?? null;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.activities)
      .where(
        and(eq(schema.activities.organizationId, organizationId), eq(schema.activities.id, id)),
      )
      .returning({ id: schema.activities.id });
    return rows.length > 0;
  }
}

/**
 * Accepts YYYY-MM-DD (treated as 00:00 UTC) or any value `new Date()` can
 * parse. Throws on garbage so the caller surfaces a 400 instead of silently
 * persisting an Invalid Date.
 */
function parseDueAt(raw: string): Date {
  // 'YYYY-MM-DD' alone — pin to UTC midnight to avoid a TZ surprise.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00Z`);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid dueAt: ${raw}`);
  }
  return d;
}

// Silence the unused import warning — gt is reserved for an upcoming
// "tasks due in next 7 days" filter; keep the import to avoid churn.
void gt;
