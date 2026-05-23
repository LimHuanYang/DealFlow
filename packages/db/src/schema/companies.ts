import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

export const companies = pgTable(
  'companies',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    domain: text('domain'),
    industry: text('industry'),
    size: text('size'),
    website: text('website'),
    description: text('description'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    customFields: jsonb('custom_fields')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgNameIdx: index('companies_org_id_name_idx').on(t.organizationId, t.name),
    orgDomainIdx: index('companies_org_id_domain_idx').on(t.organizationId, t.domain),
  }),
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
