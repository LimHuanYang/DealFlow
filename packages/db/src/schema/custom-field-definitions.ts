import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),       // contact | company | deal | note | task
    name: text('name').notNull(),
    type: text('type').notNull(),                    // 10 type keys; validated by Zod, not DB
    options: jsonb('options').$type<{ values: { key: string; label: string }[] } | null>(),
    required: boolean('required').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgEntityIdx: index('cfd_org_entity_idx').on(t.organizationId, t.entityType, t.position),
    orgEntityNameUnique: uniqueIndex('cfd_org_entity_name_unique').on(
      t.organizationId,
      t.entityType,
      t.name,
    ),
  }),
);

export type CustomFieldDefinitionRow = typeof customFieldDefinitions.$inferSelect;
export type NewCustomFieldDefinition = typeof customFieldDefinitions.$inferInsert;
