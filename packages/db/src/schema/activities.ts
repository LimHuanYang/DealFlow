import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { contacts } from './contacts';
import { companies } from './companies';
import { deals } from './deals';

/**
 * Polymorphic CRM activity. Each row is either a note or a task, attached to
 * exactly one parent entity (contact, company, or deal). The "one parent"
 * invariant is enforced by the CHECK constraint below — repo code can rely on
 * it without re-checking.
 */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),

    kind: text('kind').notNull(), // 'note' | 'task'
    body: text('body').notNull(),

    // Task-only fields. NULL for notes.
    status: text('status'), // 'open' | 'done'
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Email-only fields. NULL for notes/tasks.
    subject: text('subject'),
    externalId: text('external_id'),

    // Exactly one of these is set (enforced by CHECK).
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    customFields: jsonb('custom_fields').notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgKindIdx: index('activities_org_kind_idx').on(t.organizationId, t.kind),
    orgDueIdx: index('activities_org_due_at_idx').on(t.organizationId, t.dueAt),
    contactIdx: index('activities_contact_idx').on(t.contactId),
    companyIdx: index('activities_company_idx').on(t.companyId),
    dealIdx: index('activities_deal_idx').on(t.dealId),
    oneParent: check(
      'activities_one_parent_check',
      sql`(
        (CASE WHEN ${t.contactId} IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN ${t.companyId} IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN ${t.dealId}    IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1`,
    ),
  }),
);

export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;

export const ACTIVITY_KINDS = ['note', 'task'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const TASK_STATUSES = ['open', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
