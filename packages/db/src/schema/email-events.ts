import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { activities } from './activities';

export const emailEvents = pgTable(
  'email_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // 'sent' | 'open' | 'click'
    url: text('url'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activityIdx: index('email_events_activity_idx').on(t.activityId, t.occurredAt),
    orgIdx: index('email_events_org_idx').on(t.organizationId, t.occurredAt),
  }),
);

export type EmailEventRow = typeof emailEvents.$inferSelect;
export type NewEmailEvent = typeof emailEvents.$inferInsert;
