import { sql } from 'drizzle-orm';
import { customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { companies } from './companies';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    email: citext('email'),
    phone: text('phone'),
    title: text('title'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgEmailIdx: index('contacts_org_id_email_idx').on(t.organizationId, t.email),
    orgCompanyIdx: index('contacts_org_id_company_id_idx').on(t.organizationId, t.companyId),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
