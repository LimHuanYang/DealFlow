import { sql } from 'drizzle-orm';
import {
  date,
  doublePrecision,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { companies } from './companies';
import { contacts } from './contacts';
import { pipelines } from './pipelines';
import { pipelineStages } from './pipeline-stages';

export const deals = pgTable(
  'deals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => pipelineStages.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    value: numeric('value', { precision: 14, scale: 2 }),
    currency: text('currency').notNull().default('USD'),
    primaryContactId: uuid('primary_contact_id').references(() => contacts.id, {
      onDelete: 'set null',
    }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    expectedCloseDate: date('expected_close_date'),
    status: text('status').notNull().default('open'),
    positionInStage: doublePrecision('position_in_stage').notNull().default(0),
    customFields: jsonb('custom_fields').notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    boardIdx: index('deals_board_idx').on(
      t.organizationId,
      t.pipelineId,
      t.stageId,
      t.positionInStage,
    ),
    statusIdx: index('deals_org_status_idx').on(t.organizationId, t.status),
  }),
);

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;

export const DEAL_STATUSES = ['open', 'won', 'lost'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
