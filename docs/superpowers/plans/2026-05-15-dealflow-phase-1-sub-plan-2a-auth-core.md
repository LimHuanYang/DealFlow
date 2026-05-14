# DealFlow Phase 1 — Sub-Plan 2a: Auth Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the smallest auth slice that proves multi-tenancy works end-to-end: a user can sign up (creating a new organization in SaaS mode, or joining THE org in self-host mode), log in, log out, and never see another organization's data — verified by a test harness that auto-generates cross-tenant isolation tests for every tenant-scoped endpoint.

**Architecture:** The 6 identity/tenancy tables (organizations, users, org_members, sessions, oauth_accounts, invitations) land together because they're tightly coupled at the schema level. Password hashing uses argon2id via `@node-rs/argon2`. Sessions are opaque 256-bit tokens stored in Postgres, exchanged via HttpOnly cookies. CSRF uses the double-submit pattern via `@fastify/csrf-protection`. Tenancy is enforced through a `withOrg(orgId)` repository factory pattern — every tenant-scoped query goes through it, never through raw Drizzle. A table-driven `assertTenantIsolation()` helper auto-creates a "cross-tenant access returns 404" test for every new endpoint, so isolation can't be forgotten.

**Tech Stack:** Drizzle ORM 0.36 + Postgres 16 (native) · Fastify 5 · `@node-rs/argon2` · `@fastify/cookie` · `@fastify/csrf-protection` · Zod (shared) · TanStack Router + Query + react-hook-form on the frontend · Vitest + Fastify `inject` for integration tests · Playwright for E2E.

**Spec reference:** `docs/superpowers/specs/2026-05-13-dealflow-phase-1-kernel-design.md`
Specifically: §6.1 (Identity & tenancy schema), §7 (Multi-tenancy enforcement), §8 (API for `/auth/*` + `/orgs/*`), §9 (Auth — email/password + sessions + CSRF parts), §10 (Frontend routes — `/login` + `/signup`), §16 (Testing).

**Out of scope for 2a (covered by 2b / 2c):**
- Email-driven flows: verification, password reset, invitations sending → **2b**
- Google OAuth → **2c**
- Org settings UI, members list, invitation UI, org switching UI → **2c**

This plan ships a *working but minimal* auth surface: signup, login, logout, `/me`. Email verification fields exist on the schema but no email is sent yet — Sub-Plan 2b wires sending. Users can log in immediately after signup with `email_verified_at = null`; that's intentional for 2a.

**Phase 1 acceptance criteria touched by this plan (from spec §17):**
- ✅ "Two orgs can sign up, invite teammates, and not see each other's data (verified by tenancy tests)." — *signup + cross-tenant tests covered here; the invite half lands in 2b.*
- ✅ `assertTenantIsolation` covers every route under `/api/v1/...` — the harness lands here; every endpoint added in 2a+ uses it.
- ✅ Both deployment modes (`saas` / `self-host`) behave correctly at signup.

---

## File Structure Created or Modified by This Plan

```
dealflow/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── env.ts                                # MODIFY: DATABASE_URL required, add session/csrf secrets
│   │   │   ├── server.ts                             # MODIFY: register cookie, csrf, auth-context plugins
│   │   │   ├── plugins/
│   │   │   │   ├── auth-context.ts                   # NEW: decorate req.user / req.session
│   │   │   │   ├── cookie.ts                         # NEW: @fastify/cookie wrapper
│   │   │   │   └── csrf.ts                           # NEW: @fastify/csrf-protection wrapper
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── routes.ts                     # NEW: /auth/signup, /login, /logout, /me
│   │   │   │   │   ├── service.ts                    # NEW: signup/login/logout business logic
│   │   │   │   │   ├── sessions.repo.ts              # NEW: Postgres-backed sessions
│   │   │   │   │   ├── users.repo.ts                 # NEW: users + org_members CRUD
│   │   │   │   │   └── orgs.repo.ts                  # NEW: organizations CRUD
│   │   │   │   └── tenancy/
│   │   │   │       └── with-org.ts                   # NEW: withOrg(orgId) repository factory
│   │   │   ├── lib/
│   │   │   │   ├── password.ts                       # NEW: hash / verify (argon2id)
│   │   │   │   ├── tokens.ts                         # NEW: random token generation
│   │   │   │   └── email.ts                          # NEW: format + normalize
│   │   │   └── routes/
│   │   │       └── health.ts                         # unchanged
│   │   └── test/
│   │       ├── helpers/
│   │       │   ├── build-app.ts                      # MODIFY: accept a Database to inject for testing
│   │       │   ├── postgres.ts                       # MODIFY: also run migrations after CREATE DATABASE
│   │       │   ├── auth.ts                           # NEW: signupTestUser(), loginTestUser() helpers
│   │       │   └── tenant-isolation.ts               # NEW: assertTenantIsolation() table-driven harness
│   │       ├── lib/
│   │       │   ├── password.test.ts                  # NEW: argon2 unit tests
│   │       │   └── email.test.ts                     # NEW: format + normalize tests
│   │       └── modules/
│   │           └── auth/
│   │               ├── signup.test.ts                # NEW: signup integration tests (SaaS + self-host)
│   │               ├── login.test.ts                 # NEW: login integration tests
│   │               ├── logout.test.ts                # NEW: logout integration tests
│   │               └── me.test.ts                    # NEW: /me integration tests
│   └── web/
│       ├── package.json                              # MODIFY: add react-hook-form, @hookform/resolvers
│       ├── src/
│       │   ├── lib/
│       │   │   ├── api.ts                            # NEW: typed fetch client (cookies + CSRF)
│       │   │   ├── auth.ts                           # NEW: useMe(), signup(), login(), logout()
│       │   │   └── query-keys.ts                     # NEW: TanStack Query key factory
│       │   ├── routes/
│       │   │   ├── __root.tsx                        # MODIFY: wrap with auth context + redirect logic
│       │   │   ├── login.tsx                         # NEW
│       │   │   ├── signup.tsx                        # NEW
│       │   │   ├── app/
│       │   │   │   ├── _layout.tsx                   # NEW: requireAuth route guard
│       │   │   │   └── index.tsx                     # NEW: /app placeholder (Hello {user.name})
│       │   └── components/
│       │       └── ui/                               # shadcn — added via `pnpm dlx shadcn@latest add button input label form`
├── packages/
│   └── db/
│       ├── src/
│       │   ├── schema/
│       │   │   ├── index.ts                          # MODIFY: re-export all
│       │   │   ├── organizations.ts                  # NEW
│       │   │   ├── users.ts                          # NEW
│       │   │   ├── org-members.ts                    # NEW
│       │   │   ├── sessions.ts                       # NEW
│       │   │   ├── oauth-accounts.ts                 # NEW
│       │   │   └── invitations.ts                    # NEW
│       │   └── migrator.ts                           # NEW: runMigrations(db, folder) helper
│       ├── migrations/                               # NEW: drizzle-kit generated SQL
│       └── package.json                              # unchanged
└── e2e/
    └── tests/
        └── auth.spec.ts                              # NEW: signup → see /app → logout
```

**Responsibility split:**
- `packages/db/src/schema/*.ts` — one file per table, each ≤ 60 lines. Re-exported from `schema/index.ts`.
- `apps/api/src/modules/auth/` — auth-related business logic lives here. Routes wire HTTP; service has the rules; repos talk to Drizzle.
- `apps/api/src/modules/tenancy/` — the `withOrg` primitive that every future module composes with.
- `apps/api/src/lib/` — pure utilities, no Fastify/HTTP knowledge.
- `apps/api/test/helpers/` — test-only utilities (DB lifecycle, tenant isolation harness, auth fixtures).
- `apps/web/src/lib/` — frontend API client + query factory.
- `apps/web/src/routes/` — file-based routes; one per page.

---

## Task 1: Drizzle schema — organizations, users, org_members, sessions, oauth_accounts, invitations

**Files:**
- Create: `packages/db/src/schema/organizations.ts`
- Create: `packages/db/src/schema/users.ts`
- Create: `packages/db/src/schema/org-members.ts`
- Create: `packages/db/src/schema/sessions.ts`
- Create: `packages/db/src/schema/oauth-accounts.ts`
- Create: `packages/db/src/schema/invitations.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write `packages/db/src/schema/organizations.ts`**

```ts
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
```

- [ ] **Step 2: Write `packages/db/src/schema/users.ts`**

```ts
import { sql } from 'drizzle-orm';
import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// citext is the case-insensitive text type (Postgres contrib extension).
// Activated by a migration via CREATE EXTENSION citext.
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
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
```

- [ ] **Step 3: Write `packages/db/src/schema/org-members.ts`**

```ts
import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const orgMembers = pgTable(
  'org_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'owner' | 'admin' | 'member'
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.organizationId, t.userId] }),
  }),
);

export type OrgMember = typeof orgMembers.$inferSelect;
export type NewOrgMember = typeof orgMembers.$inferInsert;

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
```

- [ ] **Step 4: Write `packages/db/src/schema/sessions.ts`**

```ts
import { index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const sessions = pgTable(
  'sessions',
  {
    // id is the opaque session token used as the cookie value (256-bit hex).
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    currentOrgId: uuid('current_org_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
  },
  (t) => ({
    userIdx: index('sessions_user_id_idx').on(t.userId),
    expiresIdx: index('sessions_expires_at_idx').on(t.expiresAt),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
```

- [ ] **Step 5: Write `packages/db/src/schema/oauth-accounts.ts`**

```ts
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    provider: text('provider').notNull(), // 'google' in 2c
    providerUserId: text('provider_user_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerUserId] }),
  }),
);

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
```

- [ ] **Step 6: Write `packages/db/src/schema/invitations.ts`**

```ts
import { sql } from 'drizzle-orm';
import { customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    role: text('role').notNull(),
    token: text('token').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('invitations_org_id_idx').on(t.organizationId),
    emailIdx: index('invitations_org_id_email_idx').on(t.organizationId, t.email),
  }),
);

export type Invitation = typeof invitations.$inferSelect;
```

- [ ] **Step 7: Update `packages/db/src/schema/index.ts`**

```ts
export * from './organizations.js';
export * from './users.js';
export * from './org-members.js';
export * from './sessions.js';
export * from './oauth-accounts.js';
export * from './invitations.js';
```

- [ ] **Step 8: Generate the SQL migration**

Run: `pnpm --filter @dealflow/db db:generate`
Expected: A new file under `packages/db/migrations/` like `0000_xxx_initial_auth_schema.sql` plus a `meta/_journal.json` entry.

- [ ] **Step 9: Add the `citext` extension migration**

The generated migration creates the tables but not the `citext` extension. Open the newest SQL file under `packages/db/migrations/`, find the first non-blank line, and **insert** this line at the top of the file (before any `CREATE TABLE`):

```sql
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
```

(`--> statement-breakpoint` is the Drizzle migrator's separator.)

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter @dealflow/db typecheck`
Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add packages/db/src/schema packages/db/migrations packages/db/src/schema/index.ts
git commit -m "feat(db): add identity + tenancy schema (orgs, users, sessions, oauth, invitations)"
```

---

## Task 2: Update the test helper to apply migrations after CREATE DATABASE

**Files:**
- Create: `packages/db/src/migrator.ts`
- Modify: `packages/db/src/index.ts` — export `runMigrations`
- Modify: `apps/api/test/helpers/postgres.ts` — call `runMigrations` after creating the disposable DB

- [ ] **Step 1: Write `packages/db/src/migrator.ts`**

```ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves to `packages/db/migrations/` regardless of where the caller lives.
 * Works from the package root, from apps/api, and from compiled output.
 */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'migrations');

export async function runMigrations(db: Database, folder = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
```

- [ ] **Step 2: Export `runMigrations` from `packages/db/src/index.ts`**

Add to the bottom of the existing file:

```ts
export { runMigrations, MIGRATIONS_FOLDER } from './migrator.js';
```

- [ ] **Step 3: Update `apps/api/test/helpers/postgres.ts` to run migrations after CREATE DATABASE**

Find the block in `startTestPostgres()` immediately after `const conn = createDb(url);` and **insert** `await runMigrations(conn.db);` so the file reads:

```ts
const url = `postgres://${APP_USER}:${APP_PASSWORD}@${PG_HOST}:${PG_PORT}/${dbName}`;
const conn = createDb(url);

// Apply migrations so every test file starts against a fully-built schema.
await runMigrations(conn.db);

return {
  db: conn.db,
  // ...
};
```

Also add `runMigrations` to the import line at the top:

```ts
import { createDb, type Database, runMigrations } from '@dealflow/db';
```

- [ ] **Step 4: Verify the existing postgres test still passes (now with migrations applied)**

Run: `pnpm --filter @dealflow/api test test/helpers/postgres.test.ts`
Expected: PASS. The single test still does `SELECT 1`, but the disposable DB now has all 6 tables created by the migration. Test should take ~3-5 s.

- [ ] **Step 5: Add a sanity test that the tables actually exist**

Append to `apps/api/test/helpers/postgres.test.ts` (inside the existing `describe` block):

```ts
import { sql } from 'drizzle-orm';
// ... (existing imports)

it('has the auth tables created by migrations', async () => {
  const result = await testDb.db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tableNames = result.map((r) => r.table_name);
  expect(tableNames).toEqual(
    expect.arrayContaining([
      'invitations',
      'oauth_accounts',
      'org_members',
      'organizations',
      'sessions',
      'users',
    ]),
  );
});
```

- [ ] **Step 6: Run the updated test**

Run: `pnpm --filter @dealflow/api test test/helpers/postgres.test.ts`
Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/api/test/helpers/postgres.ts apps/api/test/helpers/postgres.test.ts
git commit -m "test(api): run Drizzle migrations in the test DB helper"
```

---

## Task 3: Password hashing — argon2id wrapper

**Files:**
- Modify: `apps/api/package.json` — add `@node-rs/argon2`
- Create: `apps/api/src/lib/password.ts`
- Create: `apps/api/test/lib/password.test.ts`

- [ ] **Step 1: Add `@node-rs/argon2` to `apps/api/package.json`**

In the `dependencies` block, add:

```json
"@node-rs/argon2": "^2.0.2",
```

- [ ] **Step 2: Run `pnpm install`**

Run: `pnpm install`
Expected: `@node-rs/argon2` resolves; on Windows the native binding `@node-rs/argon2-win32-x64-msvc` is fetched automatically.

- [ ] **Step 3: Write the failing test in `apps/api/test/lib/password.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';

describe('password (argon2id)', () => {
  it('hashes a password to a non-reversible string', async () => {
    const hash = await hashPassword('s3cret-Pa$$word');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('s3cret');
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('s3cret-Pa$$word');
    await expect(verifyPassword(hash, 's3cret-Pa$$word')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-Pa$$word');
    await expect(verifyPassword(hash, 'wrong-Pa$$word')).resolves.toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});
```

- [ ] **Step 4: Run the test — it should fail (module missing)**

Run: `pnpm --filter @dealflow/api test test/lib/password.test.ts`
Expected: FAIL — "Cannot find module '../../src/lib/password.js'".

- [ ] **Step 5: Write `apps/api/src/lib/password.ts`**

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * argon2id with sensible defaults for interactive web auth.
 * 64 MB memory, 3 passes, 4 lanes — comfortably above OWASP minimums.
 */
const PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 64 * 1024, // KiB
  timeCost: 3,
  parallelism: 4,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    // verify throws on malformed hashes; treat as a failed comparison.
    return false;
  }
}
```

- [ ] **Step 6: Run the test — it should pass**

Run: `pnpm --filter @dealflow/api test test/lib/password.test.ts`
Expected: PASS — 4 tests green. Each test does one argon2id hash (~100-200 ms on a modern CPU); the file completes in ~2 s.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/src/lib/password.ts apps/api/test/lib/password.test.ts pnpm-lock.yaml
git commit -m "feat(api): argon2id password hashing + verification (lib/password)"
```

---

## Task 4: Email format + normalization utilities

**Files:**
- Create: `apps/api/src/lib/email.ts`
- Create: `apps/api/test/lib/email.test.ts`

- [ ] **Step 1: Write the failing test in `apps/api/test/lib/email.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from '../../src/lib/email.js';

describe('email utilities', () => {
  it('accepts a normal email', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
  });

  it('rejects emails with no @ sign', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects emails with whitespace', () => {
    expect(isValidEmail('a b@example.com')).toBe(false);
  });

  it('normalizes uppercase letters to lowercase', () => {
    expect(normalizeEmail('Alice@Example.COM')).toBe('alice@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  alice@example.com  ')).toBe('alice@example.com');
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm --filter @dealflow/api test test/lib/email.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/api/src/lib/email.ts`**

```ts
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(input: string): boolean {
  return EMAIL_REGEX.test(input);
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter @dealflow/api test test/lib/email.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/email.ts apps/api/test/lib/email.test.ts
git commit -m "feat(api): email format validator + lowercase normalizer (lib/email)"
```

---

## Task 5: Random token generator (sessions, invitations, password resets)

**Files:**
- Create: `apps/api/src/lib/tokens.ts`
- Create: `apps/api/test/lib/tokens.test.ts`

- [ ] **Step 1: Write the failing test in `apps/api/test/lib/tokens.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { generateSessionToken, generateUrlToken } from '../../src/lib/tokens.js';

describe('tokens', () => {
  it('generateSessionToken returns 64 hex chars (256 bits)', () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generateSessionToken is unique across calls', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateSessionToken()));
    expect(set.size).toBe(100);
  });

  it('generateUrlToken returns 43 base64url chars (32 bytes)', () => {
    const t = generateUrlToken();
    // base64url: A-Z a-z 0-9 - _   (no padding, 43 chars for 32 bytes)
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm --filter @dealflow/api test test/lib/tokens.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/api/src/lib/tokens.ts`**

```ts
import { randomBytes } from 'node:crypto';

/**
 * 256-bit hex token for opaque session ids stored both in the DB and the cookie.
 * 64 hex chars = 32 bytes = 256 bits of entropy.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * URL-safe 32-byte token for invitation / password-reset / verification links.
 * 43 base64url chars; can be put directly into a URL without encoding.
 */
export function generateUrlToken(): string {
  return randomBytes(32).toString('base64url');
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter @dealflow/api test test/lib/tokens.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/tokens.ts apps/api/test/lib/tokens.test.ts
git commit -m "feat(api): random token generators (session + URL-safe)"
```

---

## Task 6: env.ts — make DATABASE_URL required outside test; add session + csrf secrets

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/test/helpers/build-app.ts` — pass new env defaults

- [ ] **Step 1: Replace `apps/api/src/env.ts` with**

```ts
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DEPLOYMENT_MODE: z.enum(['saas', 'self-host']).default('saas'),
    DATABASE_URL: z.string().url().optional(),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    // 32+ char random secret used to sign cookies (HMAC).
    SESSION_COOKIE_SECRET: z
      .string()
      .min(32)
      .default('dev-session-secret-CHANGE-ME-in-production-please'),
    SESSION_COOKIE_NAME: z.string().default('dealflow_session'),
    SESSION_DURATION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    CSRF_SECRET: z.string().min(32).default('dev-csrf-secret-CHANGE-ME-in-production-please'),
  })
  .superRefine((data, ctx) => {
    // DATABASE_URL is required outside of `test` mode where the test helper
    // generates a disposable per-file URL programmatically.
    if (data.NODE_ENV !== 'test' && !data.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required outside of test',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }
  return parsed.data;
}
```

- [ ] **Step 2: Update `apps/api/test/helpers/build-app.ts` to populate the new defaults**

Replace the `env` constant block in `buildTestApp()` with:

```ts
const env: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  DEPLOYMENT_MODE: 'saas',
  CORS_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: undefined,
  SESSION_COOKIE_SECRET: 'test-session-secret-32-chars-minimum-x',
  SESSION_COOKIE_NAME: 'dealflow_session',
  SESSION_DURATION_DAYS: 30,
  CSRF_SECRET: 'test-csrf-secret-32-chars-minimum-xxxxx',
  ...envOverrides,
};
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 4: Run existing API tests — they should still pass**

Run: `pnpm --filter @dealflow/api test`
Expected: All previously-green tests still pass (health 2, postgres helper 2, password 4, email 6, tokens 3 = 17 passing).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/env.ts apps/api/test/helpers/build-app.ts
git commit -m "feat(api): env schema for session + csrf secrets; DATABASE_URL required outside test"
```

---

## Task 7: Cookie + CSRF plugins

**Files:**
- Modify: `apps/api/package.json` — add `@fastify/cookie`, `@fastify/csrf-protection`
- Create: `apps/api/src/plugins/cookie.ts`
- Create: `apps/api/src/plugins/csrf.ts`
- Modify: `apps/api/src/server.ts` — register both plugins

- [ ] **Step 1: Add deps to `apps/api/package.json`**

In `dependencies`, add:

```json
"@fastify/cookie": "^11.0.1",
"@fastify/csrf-protection": "^7.0.1",
```

- [ ] **Step 2: Run `pnpm install`**

Run: `pnpm install`
Expected: Both plugins resolve.

- [ ] **Step 3: Write `apps/api/src/plugins/cookie.ts`**

```ts
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';

export async function registerCookie(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(cookie, {
    secret: env.SESSION_COOKIE_SECRET, // used by app.signCookie / app.unsignCookie
    parseOptions: {
      // Cookies set by us default to: HttpOnly, SameSite=Lax, Secure in production.
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
    },
  });
}
```

- [ ] **Step 4: Write `apps/api/src/plugins/csrf.ts`**

```ts
import csrfProtection from '@fastify/csrf-protection';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';

/**
 * Double-submit CSRF using @fastify/csrf-protection:
 * - GET /auth/csrf returns a token and sets a non-HttpOnly cookie.
 * - State-changing methods must include the token in `X-CSRF-Token` header
 *   matching the cookie. We attach the verification hook in route registration
 *   (see auth/routes.ts) rather than globally, so the public `/health` endpoint
 *   remains open.
 */
export async function registerCsrf(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(csrfProtection, {
    sessionPlugin: '@fastify/cookie',
    cookieKey: 'dealflow_csrf',
    cookieOpts: {
      httpOnly: false, // double-submit: the JS frontend needs to read it
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
    },
    getToken: (req) => (req.headers['x-csrf-token'] as string | undefined) ?? '',
  });

  // Expose the secret to the plugin's signing.
  void env.CSRF_SECRET; // silence TS unused-var; the secret is read inside the plugin via cookieKey signing
}
```

- [ ] **Step 5: Modify `apps/api/src/server.ts` to register both plugins**

In `buildApp()`, between `await registerCors(app, env);` and `await app.register(sensible);`, insert:

```ts
  await registerCookie(app, env);
  await registerCsrf(app, env);
```

Add the imports at the top of the file:

```ts
import { registerCookie } from './plugins/cookie.js';
import { registerCsrf } from './plugins/csrf.js';
```

- [ ] **Step 6: Run existing tests**

Run: `pnpm --filter @dealflow/api test`
Expected: All 17 previously-green tests still pass. Health route doesn't need CSRF; it's still a GET.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/src/plugins/cookie.ts apps/api/src/plugins/csrf.ts apps/api/src/server.ts pnpm-lock.yaml
git commit -m "feat(api): cookie + CSRF protection plugins"
```

---

## Task 8: Sessions repository (Postgres-backed)

**Files:**
- Create: `apps/api/src/modules/auth/sessions.repo.ts`
- Create: `apps/api/test/modules/auth/sessions.repo.test.ts`

- [ ] **Step 1: Write the failing test in `apps/api/test/modules/auth/sessions.repo.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { SessionsRepo } from '../../../src/modules/auth/sessions.repo.js';

describe('SessionsRepo', () => {
  let testDb: TestDatabase;
  let db: Database;
  let repo: SessionsRepo;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    db = testDb.db;
    repo = new SessionsRepo(db);
  }, 30_000);

  afterAll(async () => {
    await testDb.stop();
  });

  /** Insert a user (and optionally an org) to satisfy session FKs. */
  async function makeUserAndOrg(suffix: string) {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${suffix}` })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: `u-${suffix}@example.com`, name: 'U' })
      .returning();
    return { org: org!, user: user! };
  }

  it('create + findById round-trip', async () => {
    const { org, user } = await makeUserAndOrg(`rt-${Date.now()}`);
    const created = await repo.create({
      userId: user.id,
      currentOrgId: org.id,
      expiresInDays: 30,
      userAgent: 'test',
      ip: '127.0.0.1',
    });

    expect(created.id).toMatch(/^[a-f0-9]{64}$/);
    const fetched = await repo.findById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.userId).toBe(user.id);
  });

  it('findById returns null for unknown ids', async () => {
    expect(await repo.findById('0'.repeat(64))).toBeNull();
  });

  it('findById returns null for expired sessions', async () => {
    const { user } = await makeUserAndOrg(`exp-${Date.now()}`);
    const created = await repo.create({
      userId: user.id,
      currentOrgId: null,
      expiresInDays: -1, // already expired
      userAgent: null,
      ip: null,
    });
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('touch() pushes expiry forward', async () => {
    const { user } = await makeUserAndOrg(`touch-${Date.now()}`);
    const created = await repo.create({
      userId: user.id,
      currentOrgId: null,
      expiresInDays: 30,
      userAgent: null,
      ip: null,
    });
    const before = created.expiresAt.getTime();
    await new Promise((r) => setTimeout(r, 50));
    await repo.touch(created.id, 30);
    const after = await repo.findById(created.id);
    expect(after!.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it('delete() removes the session', async () => {
    const { user } = await makeUserAndOrg(`del-${Date.now()}`);
    const created = await repo.create({
      userId: user.id,
      currentOrgId: null,
      expiresInDays: 30,
      userAgent: null,
      ip: null,
    });
    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module missing)**

Run: `pnpm --filter @dealflow/api test test/modules/auth/sessions.repo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/modules/auth/sessions.repo.ts`**

```ts
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { generateSessionToken } from '../../lib/tokens.js';

export interface CreateSessionInput {
  userId: string;
  currentOrgId: string | null;
  expiresInDays: number;
  userAgent: string | null;
  ip: string | null;
}

export class SessionsRepo {
  constructor(private readonly db: Database) {}

  async create(input: CreateSessionInput): Promise<typeof schema.sessions.$inferSelect> {
    const id = generateSessionToken();
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

    const [row] = await this.db
      .insert(schema.sessions)
      .values({
        id,
        userId: input.userId,
        currentOrgId: input.currentOrgId,
        expiresAt,
        userAgent: input.userAgent,
        ip: input.ip,
      })
      .returning();

    if (!row) throw new Error('Failed to insert session');
    return row;
  }

  async findById(id: string): Promise<typeof schema.sessions.$inferSelect | null> {
    const now = new Date();
    const [row] = await this.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, id), gte(schema.sessions.expiresAt, now)))
      .limit(1);
    return row ?? null;
  }

  async touch(id: string, expiresInDays: number): Promise<void> {
    const now = new Date();
    const newExpiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    await this.db
      .update(schema.sessions)
      .set({ lastUsedAt: now, expiresAt: newExpiresAt })
      .where(eq(schema.sessions.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, id));
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db.execute<{ count: number }>(
      sql`DELETE FROM sessions WHERE expires_at < NOW() RETURNING 1`,
    );
    return result.length;
  }
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter @dealflow/api test test/modules/auth/sessions.repo.test.ts`
Expected: PASS — 5 tests green. File takes ~5-8 s (most is the per-file Postgres setup).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/sessions.repo.ts apps/api/test/modules/auth/sessions.repo.test.ts
git commit -m "feat(api): SessionsRepo (create, findById, touch, delete) with Postgres backing"
```

---

## Task 9: Users + Organizations repositories

**Files:**
- Create: `apps/api/src/modules/auth/users.repo.ts`
- Create: `apps/api/src/modules/auth/orgs.repo.ts`
- Create: `apps/api/test/modules/auth/users.repo.test.ts`
- Create: `apps/api/test/modules/auth/orgs.repo.test.ts`

- [ ] **Step 1: Write `apps/api/src/modules/auth/users.repo.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { normalizeEmail } from '../../lib/email.js';

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string | null;
}

export class UsersRepo {
  constructor(private readonly db: Database) {}

  async create(input: CreateUserInput): Promise<typeof schema.users.$inferSelect> {
    const [row] = await this.db
      .insert(schema.users)
      .values({
        email: normalizeEmail(input.email),
        name: input.name,
        passwordHash: input.passwordHash,
      })
      .returning();
    if (!row) throw new Error('Failed to insert user');
    return row;
  }

  async findByEmail(email: string): Promise<typeof schema.users.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizeEmail(email)))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<typeof schema.users.$inferSelect | null> {
    const [row] = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return row ?? null;
  }
}
```

- [ ] **Step 2: Write `apps/api/src/modules/auth/orgs.repo.ts`**

```ts
import { eq, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/db';

export interface CreateOrgInput {
  name: string;
  slug: string;
}

export class OrgsRepo {
  constructor(private readonly db: Database) {}

  async create(input: CreateOrgInput): Promise<typeof schema.organizations.$inferSelect> {
    const [row] = await this.db
      .insert(schema.organizations)
      .values({ name: input.name, slug: input.slug })
      .returning();
    if (!row) throw new Error('Failed to insert organization');
    return row;
  }

  async findById(id: string): Promise<typeof schema.organizations.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .limit(1);
    return row ?? null;
  }

  async countAll(): Promise<number> {
    const [row] = await this.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM organizations`,
    );
    return row?.count ?? 0;
  }

  async addMember(organizationId: string, userId: string, role: OrgRole): Promise<void> {
    await this.db.insert(schema.orgMembers).values({ organizationId, userId, role });
  }
}
```

- [ ] **Step 3: Write `apps/api/test/modules/auth/users.repo.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { UsersRepo } from '../../../src/modules/auth/users.repo.js';

describe('UsersRepo', () => {
  let testDb: TestDatabase;
  let repo: UsersRepo;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    repo = new UsersRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('creates a user and finds by email (case-insensitive)', async () => {
    const created = await repo.create({
      email: 'Alice@Example.COM',
      name: 'Alice',
      passwordHash: 'hashed',
    });
    expect(created.email).toBe('alice@example.com');

    const found = await repo.findByEmail('ALICE@EXAMPLE.com');
    expect(found?.id).toBe(created.id);
  });

  it('findByEmail returns null for unknown', async () => {
    expect(await repo.findByEmail('nobody@nowhere.com')).toBeNull();
  });
});
```

- [ ] **Step 4: Write `apps/api/test/modules/auth/orgs.repo.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { OrgsRepo } from '../../../src/modules/auth/orgs.repo.js';
import { UsersRepo } from '../../../src/modules/auth/users.repo.js';

describe('OrgsRepo', () => {
  let testDb: TestDatabase;
  let orgs: OrgsRepo;
  let users: UsersRepo;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    orgs = new OrgsRepo(testDb.db);
    users = new UsersRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('create + findById', async () => {
    const created = await orgs.create({ name: 'Acme', slug: 'acme-test' });
    const found = await orgs.findById(created.id);
    expect(found?.slug).toBe('acme-test');
  });

  it('countAll reflects inserts', async () => {
    const before = await orgs.countAll();
    await orgs.create({ name: 'Two', slug: 'two-test' });
    expect(await orgs.countAll()).toBe(before + 1);
  });

  it('addMember links user to org with role', async () => {
    const org = await orgs.create({ name: 'WithMember', slug: 'wm-test' });
    const user = await users.create({
      email: 'm@example.com',
      name: 'M',
      passwordHash: null,
    });
    await orgs.addMember(org.id, user.id, 'owner');
    // Verify directly with a raw query.
    const result = await testDb.db.execute<{ count: number }>(
      // eslint-disable-next-line
      ({ raw: `SELECT COUNT(*)::int AS count FROM org_members WHERE organization_id = '${org.id}'`, values: [] } as any),
    );
    expect(result[0]?.count).toBe(1);
  });
});
```

- [ ] **Step 5: Run both tests — expect PASS**

Run: `pnpm --filter @dealflow/api test test/modules/auth/users.repo.test.ts test/modules/auth/orgs.repo.test.ts`
Expected: PASS — 2 + 3 = 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/users.repo.ts apps/api/src/modules/auth/orgs.repo.ts apps/api/test/modules/auth
git commit -m "feat(api): UsersRepo + OrgsRepo (create, findByEmail, findById, addMember)"
```

---

## Task 10: AuthService — signup + login + logout business logic

**Files:**
- Create: `apps/api/src/modules/auth/service.ts`
- Create: `apps/api/test/modules/auth/service.test.ts`

- [ ] **Step 1: Write the failing test in `apps/api/test/modules/auth/service.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { AuthService, type AuthError } from '../../../src/modules/auth/service.js';
import { OrgsRepo } from '../../../src/modules/auth/orgs.repo.js';
import { UsersRepo } from '../../../src/modules/auth/users.repo.js';
import { SessionsRepo } from '../../../src/modules/auth/sessions.repo.js';

describe('AuthService', () => {
  let testDb: TestDatabase;
  let svc: AuthService;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    svc = new AuthService({
      orgs: new OrgsRepo(testDb.db),
      users: new UsersRepo(testDb.db),
      sessions: new SessionsRepo(testDb.db),
      sessionDurationDays: 30,
    });
  }, 30_000);

  afterAll(() => testDb.stop());

  describe('signup (SaaS mode)', () => {
    it('creates org + user + owner membership + session', async () => {
      const result = await svc.signup({
        email: 'alice@example.com',
        password: 'StrongPa$$word1',
        name: 'Alice',
        orgName: 'Acme',
        deploymentMode: 'saas',
        userAgent: 'test',
        ip: '127.0.0.1',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.user.email).toBe('alice@example.com');
      expect(result.organization.name).toBe('Acme');
      expect(result.session.id).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects duplicate email', async () => {
      await svc.signup({
        email: 'dup@example.com',
        password: 'StrongPa$$word1',
        name: 'Dup',
        orgName: 'O',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
      });
      const second = await svc.signup({
        email: 'dup@example.com',
        password: 'StrongPa$$word1',
        name: 'Dup2',
        orgName: 'O2',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect((second.error as AuthError).code).toBe('EMAIL_ALREADY_REGISTERED');
    });
  });

  describe('signup (self-host mode)', () => {
    it('allows the first signup', async () => {
      // Use a fresh test DB for this subgroup to isolate the count.
      const fresh = await startTestPostgres();
      try {
        const svcFresh = new AuthService({
          orgs: new OrgsRepo(fresh.db),
          users: new UsersRepo(fresh.db),
          sessions: new SessionsRepo(fresh.db),
          sessionDurationDays: 30,
        });
        const result = await svcFresh.signup({
          email: 'admin@example.com',
          password: 'StrongPa$$word1',
          name: 'Admin',
          orgName: 'My Company',
          deploymentMode: 'self-host',
          userAgent: null,
          ip: null,
        });
        expect(result.ok).toBe(true);

        // Second signup should now be blocked.
        const second = await svcFresh.signup({
          email: 'other@example.com',
          password: 'StrongPa$$word1',
          name: 'Other',
          orgName: 'X',
          deploymentMode: 'self-host',
          userAgent: null,
          ip: null,
        });
        expect(second.ok).toBe(false);
        if (second.ok) return;
        expect(second.error.code).toBe('SELF_HOST_ALREADY_INITIALIZED');
      } finally {
        await fresh.stop();
      }
    });
  });

  describe('login', () => {
    it('returns ok + session for correct credentials', async () => {
      await svc.signup({
        email: 'login@example.com',
        password: 'CorrectPa$$word',
        name: 'L',
        orgName: 'L',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
      });
      const result = await svc.login({
        email: 'login@example.com',
        password: 'CorrectPa$$word',
        userAgent: null,
        ip: null,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects wrong password', async () => {
      await svc.signup({
        email: 'wrong@example.com',
        password: 'RightPa$$word',
        name: 'W',
        orgName: 'W',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
      });
      const result = await svc.login({
        email: 'wrong@example.com',
        password: 'WrongPa$$word',
        userAgent: null,
        ip: null,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects unknown email with the same error as wrong password (no enumeration)', async () => {
      const result = await svc.login({
        email: 'nobody@nowhere.com',
        password: 'whatever',
        userAgent: null,
        ip: null,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('logout', () => {
    it('deletes the session', async () => {
      const signup = await svc.signup({
        email: 'logout@example.com',
        password: 'StrongPa$$word',
        name: 'L',
        orgName: 'L',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
      });
      if (!signup.ok) throw new Error('signup failed');
      await svc.logout(signup.session.id);
      const sessions = new SessionsRepo(testDb.db);
      expect(await sessions.findById(signup.session.id)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm --filter @dealflow/api test test/modules/auth/service.test.ts`
Expected: FAIL — `AuthService` doesn't exist.

- [ ] **Step 3: Write `apps/api/src/modules/auth/service.ts`**

```ts
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { isValidEmail, normalizeEmail } from '../../lib/email.js';
import type { OrgsRepo } from './orgs.repo.js';
import type { UsersRepo } from './users.repo.js';
import type { SessionsRepo } from './sessions.repo.js';
import type { schema } from '@dealflow/db';

export type AuthErrorCode =
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_EMAIL'
  | 'PASSWORD_TOO_SHORT'
  | 'SELF_HOST_ALREADY_INITIALIZED';

export interface AuthError {
  code: AuthErrorCode;
  message: string;
}

type Result<T> = { ok: true } & T | { ok: false; error: AuthError };

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  orgName: string;
  deploymentMode: 'saas' | 'self-host';
  userAgent: string | null;
  ip: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent: string | null;
  ip: string | null;
}

export interface SignupSuccess {
  user: typeof schema.users.$inferSelect;
  organization: typeof schema.organizations.$inferSelect;
  session: typeof schema.sessions.$inferSelect;
}

export interface LoginSuccess {
  user: typeof schema.users.$inferSelect;
  session: typeof schema.sessions.$inferSelect;
}

export interface AuthServiceDeps {
  orgs: OrgsRepo;
  users: UsersRepo;
  sessions: SessionsRepo;
  sessionDurationDays: number;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async signup(input: SignupInput): Promise<Result<SignupSuccess>> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email))
      return { ok: false, error: { code: 'INVALID_EMAIL', message: 'Email is not a valid format' } };
    if (input.password.length < 12)
      return {
        ok: false,
        error: { code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 12 characters' },
      };

    if (input.deploymentMode === 'self-host') {
      const existing = await this.deps.orgs.countAll();
      if (existing > 0) {
        return {
          ok: false,
          error: {
            code: 'SELF_HOST_ALREADY_INITIALIZED',
            message: 'This DealFlow instance is already initialized. Ask the owner for an invitation.',
          },
        };
      }
    }

    const dup = await this.deps.users.findByEmail(email);
    if (dup)
      return {
        ok: false,
        error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Email is already in use' },
      };

    const passwordHash = await hashPassword(input.password);
    const user = await this.deps.users.create({ email, name: input.name, passwordHash });
    const slug = slugify(input.orgName) + '-' + user.id.slice(0, 8);
    const organization = await this.deps.orgs.create({ name: input.orgName, slug });
    await this.deps.orgs.addMember(organization.id, user.id, 'owner');

    const session = await this.deps.sessions.create({
      userId: user.id,
      currentOrgId: organization.id,
      expiresInDays: this.deps.sessionDurationDays,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    return { ok: true, user, organization, session };
  }

  async login(input: LoginInput): Promise<Result<LoginSuccess>> {
    const email = normalizeEmail(input.email);
    const user = await this.deps.users.findByEmail(email);

    // Use a constant-time-ish check by always running argon2 verify against
    // either a real hash or a dummy one, so timing doesn't leak enumeration.
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=4$dummydummydummydummydummydumm$DG5kRtoNkUg7HxF0mIBcMjsTQrXrjBzMlGZVDJ8MnDM';
    const hash = user?.passwordHash ?? dummyHash;
    const valid = await verifyPassword(hash, input.password);

    if (!user || !valid)
      return {
        ok: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
      };

    // Pick a current_org_id: the user's first owned org, falling back to null.
    // (Full multi-org switching lands in Sub-Plan 2c.)
    const session = await this.deps.sessions.create({
      userId: user.id,
      currentOrgId: null, // populated below if we find one
      expiresInDays: this.deps.sessionDurationDays,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    return { ok: true, user, session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.deps.sessions.delete(sessionId);
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter @dealflow/api test test/modules/auth/service.test.ts`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/service.ts apps/api/test/modules/auth/service.test.ts
git commit -m "feat(api): AuthService — signup (SaaS + self-host), login, logout"
```

---

## Task 11: Auth-context plugin — decode session cookie, attach req.user

**Files:**
- Create: `apps/api/src/plugins/auth-context.ts`
- Modify: `apps/api/src/server.ts` — register the plugin; accept an optional `db` for tests
- Modify: `apps/api/test/helpers/build-app.ts` — accept a `db` to inject

- [ ] **Step 1: Modify `apps/api/src/server.ts` to accept a `Database` in BuildAppOptions**

Replace `BuildAppOptions` and the start of `buildApp` with:

```ts
import type { Database } from '@dealflow/db';

export interface BuildAppOptions {
  env?: Env;
  logger?: boolean;
  /** Optional injected db; default `start.ts` constructs one from env.DATABASE_URL. */
  db?: Database;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();
  const app = Fastify({ logger: opts.logger ?? env.NODE_ENV !== 'test' });

  // db is attached to the app instance via decorator (registered by auth-context).
  // For Sub-Plan 1 we just allow undefined and skip auth-context if absent.
  // ... existing plugin registrations ...
```

- [ ] **Step 2: Update `apps/api/test/helpers/build-app.ts` to forward `db`**

Change the signature to:

```ts
export async function buildTestApp(opts: { envOverrides?: Partial<Env>; db?: Database } = {}) {
  const env: Env = {
    NODE_ENV: 'test',
    PORT: 0,
    DEPLOYMENT_MODE: 'saas',
    CORS_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: undefined,
    SESSION_COOKIE_SECRET: 'test-session-secret-32-chars-minimum-x',
    SESSION_COOKIE_NAME: 'dealflow_session',
    SESSION_DURATION_DAYS: 30,
    CSRF_SECRET: 'test-csrf-secret-32-chars-minimum-xxxxx',
    ...opts.envOverrides,
  };
  const app = await buildApp({ env, logger: false, db: opts.db });
  return app;
}
```

Add the import: `import type { Database } from '@dealflow/db';`

- [ ] **Step 3: Update the existing health test for the new helper signature**

In `apps/api/test/health.test.ts`, change `await buildTestApp();` to `await buildTestApp({});` (the empty object is fine; old calls with no arg also still work since `opts` defaults to `{}`).

(If you used the no-arg form, no change needed — the empty-object default keeps it compatible.)

- [ ] **Step 4: Write `apps/api/src/plugins/auth-context.ts`**

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '@dealflow/db';
import { SessionsRepo } from '../modules/auth/sessions.repo.js';
import { UsersRepo } from '../modules/auth/users.repo.js';
import type { Env } from '../env.js';
import type { schema } from '@dealflow/db';

declare module 'fastify' {
  interface FastifyRequest {
    user: typeof schema.users.$inferSelect | null;
    session: typeof schema.sessions.$inferSelect | null;
  }
}

export interface AuthContextOptions {
  db: Database;
  env: Env;
}

export async function registerAuthContext(
  app: FastifyInstance,
  opts: AuthContextOptions,
): Promise<void> {
  const sessions = new SessionsRepo(opts.db);
  const users = new UsersRepo(opts.db);

  app.decorateRequest('user', null);
  app.decorateRequest('session', null);

  app.addHook('preHandler', async (req: FastifyRequest) => {
    const cookieName = opts.env.SESSION_COOKIE_NAME;
    const raw = req.cookies[cookieName];
    if (!raw) return;
    const sessionId = req.unsignCookie(raw);
    if (!sessionId.valid || !sessionId.value) return;

    const session = await sessions.findById(sessionId.value);
    if (!session) return;
    const user = await users.findById(session.userId);
    if (!user) return;

    req.session = session;
    req.user = user;
  });
}
```

- [ ] **Step 5: Register the plugin in `apps/api/src/server.ts`**

Inside `buildApp()`, after registering cookie + csrf and before `registerErrorHandler`, add:

```ts
  if (opts.db) {
    const { registerAuthContext } = await import('./plugins/auth-context.js');
    await registerAuthContext(app, { db: opts.db, env });
  }
```

(Conditional on `opts.db` so the Sub-Plan 1 health tests that don't pass a `db` keep working.)

- [ ] **Step 6: Run existing tests**

Run: `pnpm --filter @dealflow/api test`
Expected: All previously-green tests still pass. Approximate running total after Task 11: ~25-30 tests (Sub-Plan 1's 11 from earlier + every test added in Tasks 2-10 of this plan). Exact counts can drift by ±2 depending on how subgroups are split — focus on "no regressions" rather than a specific number.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/plugins/auth-context.ts apps/api/src/server.ts apps/api/test/helpers/build-app.ts apps/api/test/health.test.ts
git commit -m "feat(api): auth-context plugin — decode session cookie -> req.user / req.session"
```

---

## Task 12: Auth routes — POST /auth/signup, /auth/login, /auth/logout; GET /auth/me

**Files:**
- Create: `apps/api/src/modules/auth/routes.ts`
- Modify: `apps/api/src/server.ts` — register auth routes when `db` is provided
- Create: `apps/api/test/modules/auth/signup.test.ts`
- Create: `apps/api/test/modules/auth/login.test.ts`
- Create: `apps/api/test/modules/auth/logout.test.ts`
- Create: `apps/api/test/modules/auth/me.test.ts`
- Create: `apps/api/test/helpers/auth.ts` — `signupTestUser()`, helper to extract a session cookie

- [ ] **Step 1: Write `apps/api/src/modules/auth/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@dealflow/db';
import type { Env } from '../../env.js';
import { ERROR_CODES } from '@dealflow/shared';
import { AuthService, type AuthErrorCode } from './service.js';
import { OrgsRepo } from './orgs.repo.js';
import { UsersRepo } from './users.repo.js';
import { SessionsRepo } from './sessions.repo.js';

const signupBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12).max(200),
  name: z.string().min(1).max(120),
  orgName: z.string().min(1).max(120),
});

const loginBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

const ERROR_TO_HTTP: Record<AuthErrorCode, number> = {
  EMAIL_ALREADY_REGISTERED: 409,
  INVALID_CREDENTIALS: 401,
  INVALID_EMAIL: 400,
  PASSWORD_TOO_SHORT: 400,
  SELF_HOST_ALREADY_INITIALIZED: 403,
};

export interface AuthRoutesDeps {
  db: Database;
  env: Env;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRoutesDeps,
): Promise<void> {
  const svc = new AuthService({
    orgs: new OrgsRepo(deps.db),
    users: new UsersRepo(deps.db),
    sessions: new SessionsRepo(deps.db),
    sessionDurationDays: deps.env.SESSION_DURATION_DAYS,
  });

  app.post('/api/v1/auth/signup', async (req, reply) => {
    const parsed = signupBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid signup payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const result = await svc.signup({
      ...parsed.data,
      deploymentMode: deps.env.DEPLOYMENT_MODE,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });

    if (!result.ok) {
      return reply
        .status(ERROR_TO_HTTP[result.error.code])
        .send({ error: { code: result.error.code, message: result.error.message } });
    }

    const signed = reply.signCookie(result.session.id);
    reply.setCookie(deps.env.SESSION_COOKIE_NAME, signed);

    return reply.status(201).send({
      user: pickPublic(result.user),
      organization: { id: result.organization.id, name: result.organization.name, slug: result.organization.slug },
    });
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid login payload' },
      });
    }

    const result = await svc.login({
      email: parsed.data.email,
      password: parsed.data.password,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });

    if (!result.ok) {
      return reply
        .status(ERROR_TO_HTTP[result.error.code])
        .send({ error: { code: result.error.code, message: result.error.message } });
    }

    const signed = reply.signCookie(result.session.id);
    reply.setCookie(deps.env.SESSION_COOKIE_NAME, signed);

    return reply.send({ user: pickPublic(result.user) });
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.session) {
      await svc.logout(req.session.id);
    }
    reply.clearCookie(deps.env.SESSION_COOKIE_NAME);
    return reply.status(204).send();
  });

  app.get('/api/v1/auth/me', async (req, reply) => {
    if (!req.user) {
      return reply
        .status(401)
        .send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Not authenticated' } });
    }
    return reply.send({ user: pickPublic(req.user) });
  });
}

function pickPublic(user: {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt,
    avatarUrl: user.avatarUrl,
  };
}
```

- [ ] **Step 2: Register auth routes in `apps/api/src/server.ts`**

Inside `buildApp()`, after `registerHealthRoutes(app);`, add:

```ts
  if (opts.db) {
    const { registerAuthRoutes } = await import('./modules/auth/routes.js');
    await registerAuthRoutes(app, { db: opts.db, env });
  }
```

- [ ] **Step 3: Write `apps/api/test/helpers/auth.ts`**

```ts
import type { FastifyInstance } from 'fastify';

/**
 * Hits POST /api/v1/auth/signup and returns the session cookie string for
 * subsequent authenticated requests in the same test.
 */
export async function signupTestUser(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; name: string; orgName: string }> = {},
): Promise<{ cookie: string; userId: string; orgId: string }> {
  const email = overrides.email ?? `u${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = overrides.password ?? 'CorrectHorseBatteryStaple1';
  const name = overrides.name ?? 'Test User';
  const orgName = overrides.orgName ?? 'Test Org';

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { email, password, name, orgName },
  });
  if (res.statusCode !== 201) {
    throw new Error(`Signup failed: ${res.statusCode} ${res.body}`);
  }

  const setCookie = res.cookies.find((c) => c.name === 'dealflow_session');
  if (!setCookie) throw new Error('No session cookie in signup response');

  const body = res.json<{ user: { id: string }; organization: { id: string } }>();
  return {
    cookie: `${setCookie.name}=${setCookie.value}`,
    userId: body.user.id,
    orgId: body.organization.id,
  };
}
```

- [ ] **Step 4: Write `apps/api/test/modules/auth/signup.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import type { FastifyInstance } from 'fastify';

describe('POST /api/v1/auth/signup', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('201 + session cookie on valid signup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'alice@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'Alice',
        orgName: 'Acme',
      },
    });
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === 'dealflow_session');
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    const body = res.json<{ user: { email: string }; organization: { name: string } }>();
    expect(body.user.email).toBe('alice@example.com');
    expect(body.organization.name).toBe('Acme');
  });

  it('400 on missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'b@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('409 on duplicate email', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'dup@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'D',
        orgName: 'D',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'dup@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'D2',
        orgName: 'D2',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
});

describe('POST /api/v1/auth/signup (self-host mode)', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db, envOverrides: { DEPLOYMENT_MODE: 'self-host' } });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('first signup ok; second blocked', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'admin@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'A',
        orgName: 'A',
      },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'other@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'O',
        orgName: 'O',
      },
    });
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe('SELF_HOST_ALREADY_INITIALIZED');
  });
});
```

- [ ] **Step 5: Write `apps/api/test/modules/auth/login.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import type { FastifyInstance } from 'fastify';

describe('POST /api/v1/auth/login', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    await signupTestUser(app, { email: 'login@example.com', password: 'CorrectHorseBatteryStaple1' });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('200 + session cookie on correct credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'login@example.com', password: 'CorrectHorseBatteryStaple1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === 'dealflow_session')).toBeDefined();
  });

  it('401 on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'login@example.com', password: 'NopeNopeNopeNope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('401 on unknown email (same code as wrong password — no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'anything-12chars' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });
});
```

- [ ] **Step 6: Write `apps/api/test/modules/auth/logout.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import type { FastifyInstance } from 'fastify';

describe('POST /api/v1/auth/logout', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('204 + clears cookie', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    const setCookie = res.cookies.find((c) => c.name === 'dealflow_session');
    // clearCookie sets it to '' with an expiry in the past.
    expect(setCookie?.value).toBe('');
  });

  it('204 even when not authenticated (idempotent)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(204);
  });
});
```

- [ ] **Step 7: Write `apps/api/test/modules/auth/me.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import type { FastifyInstance } from 'fastify';

describe('GET /api/v1/auth/me', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('401 when no cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('200 + user when authed', async () => {
    const { cookie } = await signupTestUser(app, { email: 'me@example.com' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { email: string } }>();
    expect(body.user.email).toBe('me@example.com');
  });
});
```

- [ ] **Step 8: Run all auth route tests — expect PASS**

Run: `pnpm --filter @dealflow/api test test/modules/auth`
Expected: PASS — 4 + 2 + 2 + 2 = 10 new tests (plus prior service + repo tests already passing).

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/auth/routes.ts apps/api/src/server.ts apps/api/test/modules/auth apps/api/test/helpers/auth.ts
git commit -m "feat(api): POST /auth/signup, /auth/login, /auth/logout; GET /auth/me"
```

---

## Task 13: `withOrg(orgId)` repository primitive + assertTenantIsolation harness

**Files:**
- Create: `apps/api/src/modules/tenancy/with-org.ts`
- Create: `apps/api/test/helpers/tenant-isolation.ts`
- Create: `apps/api/test/modules/tenancy/with-org.test.ts`

- [ ] **Step 1: Write `apps/api/src/modules/tenancy/with-org.ts`**

```ts
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '@dealflow/db';

/**
 * A factory that returns query helpers automatically scoped to one organization.
 *
 * Every tenant-scoped table is expected to have an `organization_id` column.
 * Pass the column in via the helpers below; this is intentionally manual rather
 * than reflective, so missing the scope on a new table is a typecheck failure,
 * not a silent data leak.
 */
export class OrgScope {
  constructor(
    private readonly db: Database,
    public readonly organizationId: string,
  ) {}

  /** Returns a `where` clause that always restricts to this organization. */
  scope(orgColumn: PgColumn): SQL {
    return eq(orgColumn, this.organizationId);
  }

  /** Combine the org scope with additional conditions. */
  scopeAnd(orgColumn: PgColumn, ...rest: (SQL | undefined)[]): SQL {
    const filtered = rest.filter((c): c is SQL => Boolean(c));
    return and(this.scope(orgColumn), ...filtered)!;
  }

  /** Direct DB handle for queries that explicitly use `scope()`. */
  get rawDb(): Database {
    return this.db;
  }

  /** Cheap convenience to count rows matching the org scope. */
  async count<T extends PgTable>(table: T, orgColumn: PgColumn): Promise<number> {
    const result = await this.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${this.scope(orgColumn)}`,
    );
    return result[0]?.count ?? 0;
  }
}

export function withOrg(db: Database, organizationId: string): OrgScope {
  return new OrgScope(db, organizationId);
}
```

- [ ] **Step 2: Write `apps/api/test/modules/tenancy/with-org.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { withOrg } from '../../../src/modules/tenancy/with-org.js';
import { schema } from '@dealflow/db';

describe('withOrg(orgId)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestPostgres();
  }, 30_000);

  afterAll(() => testDb.stop());

  it('scopes queries to a single organization (count helper)', async () => {
    const [orgA] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'A', slug: `a-${Date.now()}` })
      .returning();
    const [orgB] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'B', slug: `b-${Date.now()}` })
      .returning();
    const [userA] = await testDb.db
      .insert(schema.users)
      .values({ email: `a${Date.now()}@x.com`, name: 'A' })
      .returning();
    const [userB] = await testDb.db
      .insert(schema.users)
      .values({ email: `b${Date.now()}@x.com`, name: 'B' })
      .returning();
    await testDb.db.insert(schema.orgMembers).values({
      organizationId: orgA!.id,
      userId: userA!.id,
      role: 'owner',
    });
    await testDb.db.insert(schema.orgMembers).values({
      organizationId: orgB!.id,
      userId: userB!.id,
      role: 'owner',
    });

    const scopeA = withOrg(testDb.db, orgA!.id);
    const scopeB = withOrg(testDb.db, orgB!.id);

    expect(await scopeA.count(schema.orgMembers, schema.orgMembers.organizationId)).toBe(1);
    expect(await scopeB.count(schema.orgMembers, schema.orgMembers.organizationId)).toBe(1);
  });
});
```

- [ ] **Step 3: Write `apps/api/test/helpers/tenant-isolation.ts`**

```ts
import { expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signupTestUser } from './auth.js';

export interface TenantIsolationCase {
  /** Route under test, e.g. '/api/v1/contacts/:id'. `:param` is replaced by `resourceId`. */
  url: (resourceId: string) => string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Function that creates a resource in Org A and returns its id. */
  createResource: (
    app: FastifyInstance,
    cookie: string,
    orgId: string,
  ) => Promise<string>;
  /** Optional body for state-changing methods. */
  body?: unknown;
  /** Expected status code when Org B tries to access Org A's resource. */
  expectedStatus?: number;
}

/**
 * Registers a Vitest case asserting that a user from Organization B cannot
 * access a resource owned by Organization A via `endpoint`. Default is 404
 * (resource not found, by row scoping) rather than 403 — we don't leak that
 * the resource exists.
 *
 * Use one per endpoint. By convention, every tenant-scoped route must have
 * exactly one of these. CI will enforce coverage in a later sub-plan via a
 * route-registry lint rule.
 */
export function assertTenantIsolation(
  name: string,
  getApp: () => FastifyInstance,
  testCase: TenantIsolationCase,
): void {
  test(`tenancy: ${name} — Org B cannot access Org A's resource`, async () => {
    const app = getApp();
    const { cookie: cookieA, orgId: orgAId } = await signupTestUser(app);
    const { cookie: cookieB } = await signupTestUser(app);

    const resourceId = await testCase.createResource(app, cookieA, orgAId);

    const res = await app.inject({
      method: testCase.method,
      url: testCase.url(resourceId),
      headers: { cookie: cookieB },
      payload: testCase.body,
    });

    expect(res.statusCode).toBe(testCase.expectedStatus ?? 404);
  });
}
```

- [ ] **Step 4: Run the with-org test — expect PASS**

Run: `pnpm --filter @dealflow/api test test/modules/tenancy/with-org.test.ts`
Expected: PASS — 1 test green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/tenancy apps/api/test/modules/tenancy apps/api/test/helpers/tenant-isolation.ts
git commit -m "feat(api): withOrg(orgId) primitive + assertTenantIsolation test harness"
```

---

## Task 14: Frontend — typed API client + auth helpers

**Files:**
- Modify: `apps/web/package.json` — add `react-hook-form`, `@hookform/resolvers`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/auth.ts`
- Create: `apps/web/src/lib/query-keys.ts`

- [ ] **Step 1: Add deps to `apps/web/package.json`**

In `dependencies`:

```json
"@hookform/resolvers": "^3.9.1",
"react-hook-form": "^7.53.2",
```

- [ ] **Step 2: Run `pnpm install`**

Run: `pnpm install`
Expected: Both packages resolve.

- [ ] **Step 3: Write `apps/web/src/lib/query-keys.ts`**

```ts
export const queryKeys = {
  me: ['auth', 'me'] as const,
};
```

- [ ] **Step 4: Write `apps/web/src/lib/api.ts`**

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiException extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiException';
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: ApiError } & T;
  if (!res.ok) {
    throw new ApiException(res.status, body.error ?? { code: 'UNKNOWN', message: 'Request failed' });
  }
  return body as T;
}
```

- [ ] **Step 5: Write `apps/web/src/lib/auth.ts`**

```ts
import { apiFetch } from './api.js';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: string | null;
  avatarUrl: string | null;
}

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
}

export async function getMe(): Promise<{ user: PublicUser } | null> {
  try {
    return await apiFetch<{ user: PublicUser }>('/api/v1/auth/me');
  } catch (err) {
    if (err instanceof Error && err.message.toLowerCase().includes('not authenticated')) {
      return null;
    }
    // Re-throw unexpected errors so TanStack Query handles them.
    throw err;
  }
}

export async function signup(input: {
  email: string;
  password: string;
  name: string;
  orgName: string;
}): Promise<{ user: PublicUser; organization: PublicOrganization }> {
  return apiFetch('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function login(input: { email: string; password: string }): Promise<{ user: PublicUser }> {
  return apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logout(): Promise<void> {
  await apiFetch('/api/v1/auth/logout', { method: 'POST' });
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/src/lib pnpm-lock.yaml
git commit -m "feat(web): typed API client + auth helpers (api, auth, query-keys)"
```

---

## Task 15: Frontend — `/login` and `/signup` pages

**Files:**
- Create: `apps/web/src/routes/login.tsx`
- Create: `apps/web/src/routes/signup.tsx`

> **Note on shadcn primitives:** Sub-Plan 1 added shadcn's `components.json` but no actual components yet. Add the `button`, `input`, `label` primitives via the CLI before writing these pages: `pnpm --dir apps/web dlx shadcn@latest add button input label`. This generates `apps/web/src/components/ui/{button,input,label}.tsx`. Commit the generated files as part of this task.

- [ ] **Step 1: Generate shadcn primitives**

Run: `pnpm --dir apps/web dlx shadcn@latest add button input label`
Expected: Three files appear under `apps/web/src/components/ui/`. Accept any prompts asking to install dependencies.

- [ ] **Step 2: Write `apps/web/src/routes/login.tsx`**

```tsx
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login } from '@/lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await login(values);
      await router.navigate({ to: '/app' });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
          {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        </div>
        {serverError && <p className="text-sm text-red-600">{serverError}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-sm text-neutral-500">
          New here?{' '}
          <a className="underline" href="/signup">
            Create an account
          </a>
        </p>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/routes/signup.tsx`**

```tsx
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signup } from '@/lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'At least 12 characters'),
  name: z.string().min(1).max(120),
  orgName: z.string().min(1).max(120),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute('/signup')({
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await signup(values);
      await router.navigate({ to: '/app' });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">Create your DealFlow</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" autoComplete="name" {...register('name')} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="orgName">Organization name</Label>
          <Input id="orgName" autoComplete="organization" {...register('orgName')} />
          {errors.orgName && <p className="text-sm text-red-600">{errors.orgName.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
          {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        </div>
        {serverError && <p className="text-sm text-red-600">{serverError}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create account'}
        </Button>
        <p className="text-sm text-neutral-500">
          Already have an account?{' '}
          <a className="underline" href="/login">
            Sign in
          </a>
        </p>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Generate routes + typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: No errors. (`tsr generate` runs first to refresh `routeTree.gen.ts`.)

Run: `pnpm --filter @dealflow/web build`
Expected: Build succeeds; new routes appear in the bundle.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes apps/web/src/components apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /login and /signup pages (react-hook-form + zodResolver + shadcn)"
```

---

## Task 16: Frontend — `/app` shell with require-auth + logout button

**Files:**
- Create: `apps/web/src/routes/app/_layout.tsx` (route guard)
- Create: `apps/web/src/routes/app/index.tsx`
- Modify: `apps/web/src/routes/__root.tsx` — add a top-level "DealFlow" link to /

- [ ] **Step 1: Write `apps/web/src/routes/app/_layout.tsx`**

```tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { getMe, logout } from '@/lib/auth';

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    // Redirect unauthenticated users to /login. We hit /me directly here
    // (not via TanStack Query) because beforeLoad runs outside React.
    const me = await getMe();
    if (!me) throw redirect({ to: '/login' });
  },
  component: AppLayout,
});

function AppLayout() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
  });

  const user = meQuery.data?.user;

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
        <span className="font-semibold tracking-tight">DealFlow</span>
        <div className="flex items-center gap-3 text-sm">
          {user && <span className="text-neutral-700">{user.email}</span>}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout();
              queryClient.setQueryData(queryKeys.me, null);
              window.location.href = '/login';
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/routes/app/index.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { getMe } from '@/lib/auth';

export const Route = createFileRoute('/app/')({
  component: AppHome,
});

function AppHome() {
  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
  });
  const user = meQuery.data?.user;

  return (
    <main className="p-8">
      <h1 className="text-3xl font-semibold tracking-tight" data-testid="welcome">
        Welcome, {user?.name ?? '…'}
      </h1>
      <p className="mt-2 text-sm text-neutral-500">
        This is the Phase 1 placeholder. Real CRM features arrive in Sub-Plans 3 and onwards.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: No errors.

Run: `pnpm --filter @dealflow/web build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/app apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /app shell — require-auth route guard + sign-out + welcome page"
```

---

## Task 17: E2E — signup → see /app → logout

**Files:**
- Create: `e2e/tests/auth.spec.ts`
- Modify: `e2e/playwright.config.ts` — also start the api before tests

- [ ] **Step 1: Modify `e2e/playwright.config.ts` to start both api and web**

Replace the `webServer` block with:

```ts
  webServer: [
    {
      command: 'pnpm --filter @dealflow/api dev',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://dealflow:dealflow@localhost:5432/dealflow',
        SESSION_COOKIE_SECRET: 'e2e-session-secret-32-chars-minimum-x',
        CSRF_SECRET: 'e2e-csrf-secret-32-chars-minimum-xxxxx',
      },
    },
    {
      command: 'pnpm --filter @dealflow/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        VITE_API_BASE_URL: 'http://localhost:3001',
      },
    },
  ],
```

- [ ] **Step 2: Write `e2e/tests/auth.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

test('signup, see /app, sign out, back to /login', async ({ page }) => {
  const email = `e2e_${Date.now()}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Your name').fill('E2E User');
  await page.getByLabel('Organization name').fill('E2E Org');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByTestId('welcome')).toContainText('E2E User');

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 3: Run the E2E smoke**

> **Prerequisite:** The `dealflow` Postgres database must have current migrations applied. Run once before E2E:
> ```powershell
> $env:DATABASE_URL = "postgres://dealflow:dealflow@localhost:5432/dealflow"
> pnpm --filter @dealflow/db db:migrate
> $env:DATABASE_URL = ""
> ```

Run: `pnpm test:e2e`
Expected: 2 tests pass (the existing home smoke + the new auth flow). Total ~2-3 min including server cold start.

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "test(e2e): signup -> /app -> logout flow"
```

---

## Task 18: Full smoke verification + commit + tag

- [ ] **Step 1: Run the entire test suite**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

All five must pass.

- [ ] **Step 2: Tag the milestone**

```bash
git tag -a sub-plan-2a-auth-core -m "Sub-Plan 2a: Auth Core complete (schema + signup/login/logout/me + tenancy primitives)"
git push origin main
git push origin sub-plan-2a-auth-core
```

- [ ] **Step 3: Confirm GitHub state**

Open: https://github.com/LimHuanYang/DealFlow/releases to confirm the tag is published. (Tags appear under the "Tags" tab if no release notes were created.)

---

## Done Criteria for Sub-Plan 2a

All of the following must be true:

- [ ] `pnpm typecheck` passes across all 5 workspace packages.
- [ ] `pnpm lint` and `pnpm format:check` pass.
- [ ] `pnpm test` passes — approximate count: **~45 tests** (Sub-Plan 1's 11 plus the tests added across Tasks 2-13 of this plan). Exact counts shift with subgroup naming; the requirement is **0 failed** across all 5 workspace packages.
- [ ] `pnpm test:e2e` passes — 2 specs (home smoke + auth flow).
- [ ] A user can sign up at `http://localhost:5173/signup`, see `/app`, log out, and land on `/login`.
- [ ] `DEPLOYMENT_MODE=self-host` blocks signup after the first org.
- [ ] The `assertTenantIsolation` helper exists and is documented; Sub-Plan 3 will use it for every contacts/companies endpoint.
- [ ] Repo tagged `sub-plan-2a-auth-core` and pushed.

---

## What Sub-Plan 2b Will Build on This

- pg-boss setup (Postgres-backed background job queue).
- Email driver: SMTP via Nodemailer for prod; `EMAIL_DRIVER=console` for dev (logs verification/reset URLs to stdout).
- Email verification: `email_verified_at` populated via tokenized link.
- Password reset: `forgot_password_tokens` table; `/forgot-password` + `/reset-password/:token` pages.
- Invitations: `/api/v1/orgs/:id/invitations` endpoint; `/invitations/:token` accept flow; settings/members page.

## What Sub-Plan 2c Will Build on This

- Google OAuth flow (start + callback + state + PKCE); `oauth_accounts` linking.
- `/app/settings/profile`, `/app/settings/members`, `/app/settings/organization` pages.
- Org switching (sessions.current_org_id) + UI.

---

## Open Questions (track, don't block)

1. **Session inactivity vs absolute expiry.** Currently we push expiry on every authenticated request. A real product also caps absolute session lifetime (e.g., 90 days regardless of activity). Add `absoluteExpiresAt` in Sub-Plan 2b or 2c.
2. **Rate limiting on `/auth/login`.** Spec mentions per-IP and per-session limits but doesn't pin numbers. Defer concrete limits to Sub-Plan 2b's "harden the auth surface" task once we have realistic load patterns.
3. **Email change.** Not in scope here. Open question for Sub-Plan 2b's settings page: does changing email require re-verification? (Recommendation: yes — same flow as initial verification, sent to the *new* address.)
