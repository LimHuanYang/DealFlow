import { sql } from 'drizzle-orm';
import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// citext is the case-insensitive text type (Postgres contrib extension).
// Activated by a migration via CREATE EXTENSION citext.
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: citext('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  name: text('name').notNull(),
  passwordHash: text('password_hash'), // nullable: null when only OAuth identities exist
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
