# DealFlow Phase 1 — Sub-Plan 3: Contacts & Companies CRUD + Cmd-K

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two foundational CRM entities — Companies and Contacts — as fully-tested CRUD across the backend (5 endpoints each, all tenancy-isolated) and the frontend (list + detail with inline edit), plus a minimal **Cmd-K command palette** so every primary action across the app is keyboard-reachable from day one. After this plan, a user can sign up, create a few companies, add contacts assigned to those companies, and edit them inline — the first demoable slice of the CRM.

**Architecture:** Both entities follow the same shape — Drizzle schema → typed repository (every method takes `organizationId` as its first arg; `WHERE organization_id = $1` is built into every query) → REST routes that pull `req.session.currentOrgId` and pass it to the repo → integration tests + auto-generated cross-tenant isolation tests via `assertTenantIsolation()`. The `withOrg()` primitive from Sub-Plan 2a remains available for ad-hoc queries outside repos. The frontend uses TanStack Query for caching, react-hook-form + Zod for create modals, optimistic mutations, and a small `InlineEdit` primitive for detail-page editing. The command palette is a single client-side React component built on shadcn's `Command` (cmdk underneath) with a static command list — every state-changing action on contacts/companies registers a Cmd-K command. Future sub-plans extend the static list.

**Tech Stack:** Drizzle 0.36 + Postgres 16 (native) · Fastify 5 with the existing auth-context plugin · Zod (shared) · React 19 + TanStack Router/Query + react-hook-form + zodResolver · shadcn/ui (`command`, `dialog`, `table`, `dropdown-menu`, `alert-dialog`) · cmdk underneath · Vitest + Fastify `inject` for integration · Playwright for E2E.

**Spec reference:** `docs/superpowers/specs/2026-05-13-dealflow-phase-1-kernel-design.md`
- §6.2 — `companies` + `contacts` schema
- §7 — tenancy enforcement via `withOrg`
- §8 — `/companies/*`, `/contacts/*` REST surface
- §10 — `/app/companies`, `/app/companies/:id`, `/app/contacts`, `/app/contacts/:id` routes
- §11 — Cmd-K command palette as a *primary* deliverable, not a finishing touch
- §17 — Phase 1 acceptance: "a user can create a contact + company + deal" (deal half lands in Sub-Plan 4)

**Sub-Plan 2a (Auth Core) is the prerequisite.** This plan assumes:
- Schema for `organizations`, `users`, `org_members`, `sessions` exists (commit `73b42b4`).
- `auth-context` plugin populates `req.session` (commit `2f2ccd1`).
- Signup creates `session.currentOrgId` from the new org id; login leaves it `null` — for Sub-Plan 3, **every signed-up user has a current org**; login-only users with no `currentOrgId` get **HTTP 400 `NO_CURRENT_ORG`** until Sub-Plan 2c adds org switching. Document the gap; don't paper over it.
- `assertTenantIsolation()` test harness exists at `apps/api/test/helpers/tenant-isolation.ts` (commit `a42894e`) — use it for every tenant-scoped route added in this plan.
- `withOrg(db, orgId)` repo primitive exists at `apps/api/src/modules/tenancy/with-org.ts` — use it for every query that returns tenant data.

**Out of scope for Sub-Plan 3 (deferred to later sub-plans):**
- Custom fields on contacts/companies → Phase 3.
- Filtering, search beyond simple name/email LIKE → Sub-Plan 6 (AI nl-filter) does the heavy lifting; Sub-Plan 3 has cursor-based pagination + a simple `?q=` text filter.
- Bulk import/export → Phase 2+.
- AI features (extract-contact from text, summarize note) → Sub-Plan 6.

---

## File Structure Created or Modified by This Plan

```
dealflow/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── companies/
│   │   │   │   │   ├── routes.ts                    # NEW: 5 endpoints
│   │   │   │   │   └── companies.repo.ts            # NEW
│   │   │   │   └── contacts/
│   │   │   │       ├── routes.ts                    # NEW: 5 endpoints
│   │   │   │       └── contacts.repo.ts             # NEW
│   │   │   ├── server.ts                            # MODIFY: register the two route modules
│   │   │   └── plugins/
│   │   │       └── require-org.ts                   # NEW: 400 if session.currentOrgId is null
│   │   └── test/
│   │       ├── modules/
│   │       │   ├── companies/
│   │       │   │   ├── companies.repo.test.ts       # NEW
│   │       │   │   ├── companies.routes.test.ts     # NEW
│   │       │   │   └── companies.tenancy.test.ts    # NEW: assertTenantIsolation for every endpoint
│   │       │   └── contacts/
│   │       │       ├── contacts.repo.test.ts        # NEW
│   │       │       ├── contacts.routes.test.ts      # NEW
│   │       │       └── contacts.tenancy.test.ts     # NEW
│   │       └── helpers/
│   │           └── fixtures.ts                      # NEW: createTestCompany(), createTestContact()
│   └── web/
│       ├── package.json                             # MODIFY: add 'cmdk' if shadcn doesn't bring it
│       ├── src/
│       │   ├── components/
│       │   │   ├── ui/                              # GENERATED: command, dialog, table, dropdown-menu, alert-dialog (via shadcn CLI)
│       │   │   ├── inline-edit.tsx                  # NEW: click-to-edit text field
│       │   │   ├── command-palette.tsx              # NEW: Cmd-K palette with command list
│       │   │   └── entity-table.tsx                 # NEW: reusable table for list pages
│       │   ├── lib/
│       │   │   ├── api.ts                           # MODIFY: add companies/contacts fetch functions
│       │   │   └── query-keys.ts                    # MODIFY: add companies + contacts keys
│       │   ├── features/
│       │   │   ├── companies/
│       │   │   │   ├── api.ts                       # NEW: companies CRUD client + hooks
│       │   │   │   └── create-company-dialog.tsx    # NEW: shadcn Dialog + form
│       │   │   └── contacts/
│       │   │       ├── api.ts                       # NEW
│       │   │       └── create-contact-dialog.tsx    # NEW
│       │   └── routes/
│       │       └── app/
│       │           ├── _layout.tsx                  # MODIFY: mount <CommandPalette>
│       │           ├── companies/
│       │           │   ├── index.tsx                # NEW: /app/companies list
│       │           │   └── $id.tsx                  # NEW: /app/companies/:id detail
│       │           └── contacts/
│       │               ├── index.tsx                # NEW: /app/contacts list
│       │               └── $id.tsx                  # NEW: /app/contacts/:id detail
├── packages/
│   ├── db/
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── companies.ts                     # NEW
│   │   │   │   ├── contacts.ts                      # NEW
│   │   │   │   └── index.ts                         # MODIFY: re-export
│   │   │   └── migrations/
│   │   │       └── 0001_*.sql                       # GENERATED
│   └── shared/
│       └── src/
│           ├── companies.ts                         # NEW: Zod schemas + types
│           ├── contacts.ts                          # NEW
│           └── index.ts                             # MODIFY: re-export
└── e2e/
    └── tests/
        └── contacts-companies.spec.ts               # NEW: full flow
```

**Responsibility split (one file = one concern):**
- `packages/db/src/schema/{companies,contacts}.ts` — only the Drizzle table definitions + inferred types.
- `packages/shared/src/{companies,contacts}.ts` — only the Zod input schemas + their inferred TypeScript types. Shared between API (request validation) and Web (form validation).
- `apps/api/src/modules/{companies,contacts}/{routes,repo}.ts` — routes do HTTP + Zod parse + delegation; repos do the SQL.
- `apps/web/src/features/{companies,contacts}/api.ts` — fetch functions + TanStack Query hooks. Components consume hooks, never raw fetch.
- `apps/web/src/components/{inline-edit,command-palette,entity-table}.tsx` — generic, no entity-specific code.

---

## Task 1: Schema — companies + contacts + migration

**Files:**
- Create: `packages/db/src/schema/companies.ts`
- Create: `packages/db/src/schema/contacts.ts`
- Modify: `packages/db/src/schema/index.ts`
- Generated: `packages/db/migrations/0001_<auto>.sql`

- [ ] **Step 1: Write `packages/db/src/schema/companies.ts`**

```ts
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
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
```

- [ ] **Step 2: Write `packages/db/src/schema/contacts.ts`**

```ts
import { sql } from 'drizzle-orm';
import { customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { companies } from './companies';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
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
```

- [ ] **Step 3: Update `packages/db/src/schema/index.ts`**

Add to the existing re-exports (preserve all current lines):

```ts
export * from './companies';
export * from './contacts';
```

- [ ] **Step 4: Generate the migration**

Run (from repo root):
```powershell
$env:DATABASE_URL = "postgres://dealflow:dealflow@localhost:5432/dealflow"
pnpm --filter @dealflow/db db:generate
$env:DATABASE_URL = ""
```

Expected: a new file `packages/db/migrations/0001_<name>.sql` with two `CREATE TABLE` blocks (companies + contacts), the four indexes, and the foreign-key constraints. The migration `meta/_journal.json` updates to include the new entry.

- [ ] **Step 5: Apply the migration to the dev `dealflow` database**

```powershell
$env:DATABASE_URL = "postgres://dealflow:dealflow@localhost:5432/dealflow"
pnpm --filter @dealflow/db db:migrate
$env:DATABASE_URL = ""
```

Expected output ends with `[i] No more migrations to apply.` after running the new 0001 migration once.

Verify with psql:

```powershell
$env:PGPASSWORD = "dealflow"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U dealflow -h localhost -d dealflow -c "\dt public.*"
$env:PGPASSWORD = ""
```

Expected: `companies` and `contacts` appear in the list alongside the 6 tables from Sub-Plan 2a.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @dealflow/db typecheck`
Expected: No errors.

- [ ] **Step 7: Run the postgres test helper test (verifies migrations apply to disposable DBs too)**

Run: `pnpm --filter @dealflow/api test test/helpers/postgres.test.ts`
Expected: The "tables created by migrations" test now sees 8 tables instead of 6. The test uses `arrayContaining` so it still passes — but verify by looking at the test output that the assertion didn't fail.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema packages/db/migrations
git commit -m "feat(db): add companies + contacts schema (Sub-Plan 3 Task 1)"
```

---

## Task 2: Zod schemas in @dealflow/shared

**Files:**
- Create: `packages/shared/src/companies.ts`
- Create: `packages/shared/src/contacts.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write `packages/shared/src/companies.ts`**

```ts
import { z } from 'zod';

export const createCompanyBodySchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().min(1).max(200).optional(),
  industry: z.string().min(1).max(100).optional(),
  size: z.string().min(1).max(50).optional(),
  website: z.string().url().max(500).optional(),
  description: z.string().max(5000).optional(),
});

export const updateCompanyBodySchema = createCompanyBodySchema.partial();

export type CreateCompanyInput = z.infer<typeof createCompanyBodySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanyBodySchema>;

/** Public-facing company shape returned by the API. */
export interface PublicCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  description: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Write `packages/shared/src/contacts.ts`**

```ts
import { z } from 'zod';

export const createContactBodySchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().min(1).max(50).optional(),
  title: z.string().min(1).max(200).optional(),
  companyId: z.string().uuid().optional(),
});

export const updateContactBodySchema = createContactBodySchema.partial();

export type CreateContactInput = z.infer<typeof createContactBodySchema>;
export type UpdateContactInput = z.infer<typeof updateContactBodySchema>;

export interface PublicContact {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Update `packages/shared/src/index.ts`**

Append:

```ts
export * from './companies.js';
export * from './contacts.js';
```

- [ ] **Step 4: Typecheck shared**

Run: `pnpm --filter @dealflow/shared typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): Zod schemas for companies + contacts CRUD"
```

---

## Task 3: requireOrg plugin + test fixtures

This task adds a tiny Fastify plugin (`requireOrg`) that returns 400 `NO_CURRENT_ORG` when `req.session.currentOrgId` is null. It also adds reusable test fixtures (`createTestCompany`, `createTestContact`) used by tasks 4-5.

**Files:**
- Create: `apps/api/src/plugins/require-org.ts`
- Create: `apps/api/test/helpers/fixtures.ts`

- [ ] **Step 1: Write `apps/api/src/plugins/require-org.ts`**

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@dealflow/shared';

/**
 * preHandler hook that 401s unauthenticated and 400s authenticated users
 * with no current_org_id (e.g., login-only users until Sub-Plan 2c adds
 * explicit org switching).
 *
 * Routes that need an authenticated user *and* an active org use this as
 * their preHandler.
 */
export async function requireOrg(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user || !req.session) {
    void reply.status(401).send({
      error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Not authenticated' },
    });
    return;
  }
  if (!req.session.currentOrgId) {
    void reply.status(400).send({
      error: {
        code: 'NO_CURRENT_ORG',
        message: 'No current organization selected. Pick one or sign up to create one.',
      },
    });
    return;
  }
}
```

- [ ] **Step 2: Write `apps/api/test/helpers/fixtures.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { signupTestUser } from './auth.js';
import type { PublicCompany, PublicContact } from '@dealflow/shared';

/**
 * Create a signed-up user and a company in their org. Returns the auth
 * cookie and the company so tests can build on top.
 */
export async function createTestCompany(
  app: FastifyInstance,
  overrides: Partial<{
    email: string;
    name: string;
    orgName: string;
    companyName: string;
    domain: string;
  }> = {},
): Promise<{ cookie: string; orgId: string; userId: string; company: PublicCompany }> {
  const auth = await signupTestUser(app, {
    email: overrides.email,
    name: overrides.name,
    orgName: overrides.orgName,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/companies',
    headers: { cookie: auth.cookie },
    payload: {
      name: overrides.companyName ?? `Acme ${Date.now()}`,
      domain: overrides.domain,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createTestCompany failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json<{ company: PublicCompany }>();
  return { cookie: auth.cookie, orgId: auth.orgId, userId: auth.userId, company: body.company };
}

/** Same shape for contacts. */
export async function createTestContact(
  app: FastifyInstance,
  cookie: string,
  overrides: Partial<{ firstName: string; lastName: string; email: string; companyId: string }> = {},
): Promise<PublicContact> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    headers: { cookie },
    payload: {
      firstName: overrides.firstName ?? `First-${Date.now()}`,
      lastName: overrides.lastName ?? 'Doe',
      email: overrides.email,
      companyId: overrides.companyId,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createTestContact failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ contact: PublicContact }>().contact;
}
```

- [ ] **Step 3: Typecheck (apps/api will compile even though the routes don't exist yet — the fixtures only fail at runtime)**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/plugins/require-org.ts apps/api/test/helpers/fixtures.ts
git commit -m "feat(api): requireOrg preHandler + test fixtures for company/contact"
```

---

## Task 4: CompaniesRepo + integration tests

**Files:**
- Create: `apps/api/src/modules/companies/companies.repo.ts`
- Create: `apps/api/test/modules/companies/companies.repo.test.ts`

- [ ] **Step 1: Write `apps/api/test/modules/companies/companies.repo.test.ts` (TDD failing first)**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { CompaniesRepo } from '../../../src/modules/companies/companies.repo.js';

describe('CompaniesRepo', () => {
  let testDb: TestDatabase;
  let repo: CompaniesRepo;
  let orgId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
    repo = new CompaniesRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('create + findById within org', async () => {
    const created = await repo.create(orgId, {
      name: 'Beta Industries',
      domain: 'beta.com',
    });
    expect(created.name).toBe('Beta Industries');
    expect(created.organizationId).toBe(orgId);

    const found = await repo.findById(orgId, created.id);
    expect(found?.id).toBe(created.id);
  });

  it('findById returns null for an id in a different org', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    const c = await repo.create(otherOrg!.id, { name: 'Foreign Co' });
    expect(await repo.findById(orgId, c.id)).toBeNull();
  });

  it('list returns only the orgs rows, ordered by createdAt desc', async () => {
    const [b] = await Promise.all([
      repo.create(orgId, { name: `Z-${Date.now()}` }),
      repo.create(orgId, { name: `A-${Date.now()}` }),
    ]);
    const result = await repo.list(orgId, { limit: 50 });
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items.every((r) => r.organizationId === orgId)).toBe(true);
  });

  it('update merges partial fields', async () => {
    const c = await repo.create(orgId, { name: 'Patchable' });
    const updated = await repo.update(orgId, c.id, { industry: 'SaaS' });
    expect(updated?.industry).toBe('SaaS');
    expect(updated?.name).toBe('Patchable');
  });

  it('update returns null when id is in a different org', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Else', slug: `else-${Date.now()}` })
      .returning();
    const c = await repo.create(otherOrg!.id, { name: 'NotMine' });
    expect(await repo.update(orgId, c.id, { name: 'hijack' })).toBeNull();
  });

  it('delete removes only when the id is in the org', async () => {
    const c = await repo.create(orgId, { name: 'Deleteme' });
    expect(await repo.delete(orgId, c.id)).toBe(true);
    expect(await repo.findById(orgId, c.id)).toBeNull();

    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'NoTouch', slug: `nt-${Date.now()}` })
      .returning();
    const foreign = await repo.create(otherOrg!.id, { name: 'Foreign' });
    expect(await repo.delete(orgId, foreign.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `pnpm --filter @dealflow/api test test/modules/companies/companies.repo.test.ts`
Expected: FAIL — `Failed to load url ../../../src/modules/companies/companies.repo.js`.

- [ ] **Step 3: Write `apps/api/src/modules/companies/companies.repo.ts`**

```ts
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { CreateCompanyInput, UpdateCompanyInput } from '@dealflow/shared';

export interface ListCompaniesQuery {
  cursor?: string | undefined;
  limit?: number;
  q?: string | undefined;
}

export class CompaniesRepo {
  constructor(private readonly db: Database) {}

  async create(
    organizationId: string,
    input: CreateCompanyInput,
  ): Promise<typeof schema.companies.$inferSelect> {
    const [row] = await this.db
      .insert(schema.companies)
      .values({
        organizationId,
        name: input.name,
        domain: input.domain ?? null,
        industry: input.industry ?? null,
        size: input.size ?? null,
        website: input.website ?? null,
        description: input.description ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to insert company');
    return row;
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<typeof schema.companies.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.organizationId, organizationId), eq(schema.companies.id, id)))
      .limit(1);
    return row ?? null;
  }

  async list(
    organizationId: string,
    query: ListCompaniesQuery,
  ): Promise<{
    items: (typeof schema.companies.$inferSelect)[];
    nextCursor: string | null;
  }> {
    const limit = query.limit ?? 50;
    const conds = [eq(schema.companies.organizationId, organizationId)];
    if (query.cursor) {
      const cursorDate = new Date(query.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        conds.push(lt(schema.companies.createdAt, cursorDate));
      }
    }
    if (query.q) {
      conds.push(sql`${schema.companies.name} ILIKE ${'%' + query.q + '%'}`);
    }
    const rows = await this.db
      .select()
      .from(schema.companies)
      .where(and(...conds))
      .orderBy(desc(schema.companies.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null;
    return { items, nextCursor };
  }

  async update(
    organizationId: string,
    id: string,
    patch: UpdateCompanyInput,
  ): Promise<typeof schema.companies.$inferSelect | null> {
    const [row] = await this.db
      .update(schema.companies)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.companies.organizationId, organizationId), eq(schema.companies.id, id)))
      .returning();
    return row ?? null;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.companies)
      .where(and(eq(schema.companies.organizationId, organizationId), eq(schema.companies.id, id)))
      .returning({ id: schema.companies.id });
    return result.length > 0;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @dealflow/api test test/modules/companies/companies.repo.test.ts`
Expected: 6 tests passing.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/companies/companies.repo.ts apps/api/test/modules/companies/companies.repo.test.ts
git commit -m "feat(api): CompaniesRepo (CRUD with org scoping)"
```

---

## Task 5: ContactsRepo + integration tests

Mirrors Task 4 for contacts. Same pattern.

**Files:**
- Create: `apps/api/src/modules/contacts/contacts.repo.ts`
- Create: `apps/api/test/modules/contacts/contacts.repo.test.ts`

- [ ] **Step 1: Write `apps/api/test/modules/contacts/contacts.repo.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { ContactsRepo } from '../../../src/modules/contacts/contacts.repo.js';
import { CompaniesRepo } from '../../../src/modules/companies/companies.repo.js';

describe('ContactsRepo', () => {
  let testDb: TestDatabase;
  let repo: ContactsRepo;
  let companies: CompaniesRepo;
  let orgId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
    repo = new ContactsRepo(testDb.db);
    companies = new CompaniesRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('create + findById within org', async () => {
    const created = await repo.create(orgId, {
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
    });
    expect(created.firstName).toBe('Alice');
    expect(created.organizationId).toBe(orgId);

    const found = await repo.findById(orgId, created.id);
    expect(found?.id).toBe(created.id);
  });

  it('create with companyId links to a company in the same org', async () => {
    const company = await companies.create(orgId, { name: 'Linked Co' });
    const contact = await repo.create(orgId, {
      firstName: 'Bob',
      companyId: company.id,
    });
    expect(contact.companyId).toBe(company.id);
  });

  it('findById returns null for an id in a different org', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    const c = await repo.create(otherOrg!.id, { firstName: 'Foreign' });
    expect(await repo.findById(orgId, c.id)).toBeNull();
  });

  it('list returns only the orgs rows, ordered by createdAt desc', async () => {
    await Promise.all([
      repo.create(orgId, { firstName: `A-${Date.now()}` }),
      repo.create(orgId, { firstName: `B-${Date.now()}` }),
    ]);
    const result = await repo.list(orgId, { limit: 50 });
    expect(result.items.every((r) => r.organizationId === orgId)).toBe(true);
  });

  it('update merges partial fields', async () => {
    const c = await repo.create(orgId, { firstName: 'Patchable' });
    const updated = await repo.update(orgId, c.id, { title: 'CEO' });
    expect(updated?.title).toBe('CEO');
    expect(updated?.firstName).toBe('Patchable');
  });

  it('delete removes only when the id is in the org', async () => {
    const c = await repo.create(orgId, { firstName: 'Deleteme' });
    expect(await repo.delete(orgId, c.id)).toBe(true);
    expect(await repo.findById(orgId, c.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @dealflow/api test test/modules/contacts/contacts.repo.test.ts`

- [ ] **Step 3: Write `apps/api/src/modules/contacts/contacts.repo.ts`**

```ts
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { CreateContactInput, UpdateContactInput } from '@dealflow/shared';

export interface ListContactsQuery {
  cursor?: string | undefined;
  limit?: number;
  q?: string | undefined;
  companyId?: string | undefined;
}

export class ContactsRepo {
  constructor(private readonly db: Database) {}

  async create(
    organizationId: string,
    input: CreateContactInput,
  ): Promise<typeof schema.contacts.$inferSelect> {
    const [row] = await this.db
      .insert(schema.contacts)
      .values({
        organizationId,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        title: input.title ?? null,
        companyId: input.companyId ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to insert contact');
    return row;
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<typeof schema.contacts.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.id, id)))
      .limit(1);
    return row ?? null;
  }

  async list(
    organizationId: string,
    query: ListContactsQuery,
  ): Promise<{
    items: (typeof schema.contacts.$inferSelect)[];
    nextCursor: string | null;
  }> {
    const limit = query.limit ?? 50;
    const conds = [eq(schema.contacts.organizationId, organizationId)];
    if (query.cursor) {
      const cursorDate = new Date(query.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        conds.push(lt(schema.contacts.createdAt, cursorDate));
      }
    }
    if (query.companyId) {
      conds.push(eq(schema.contacts.companyId, query.companyId));
    }
    if (query.q) {
      const pattern = '%' + query.q + '%';
      const orClause = or(
        sql`${schema.contacts.firstName} ILIKE ${pattern}`,
        sql`${schema.contacts.lastName} ILIKE ${pattern}`,
        sql`${schema.contacts.email} ILIKE ${pattern}`,
      );
      if (orClause) conds.push(orClause);
    }
    const rows = await this.db
      .select()
      .from(schema.contacts)
      .where(and(...conds))
      .orderBy(desc(schema.contacts.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null;
    return { items, nextCursor };
  }

  async update(
    organizationId: string,
    id: string,
    patch: UpdateContactInput,
  ): Promise<typeof schema.contacts.$inferSelect | null> {
    const [row] = await this.db
      .update(schema.contacts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.id, id)))
      .returning();
    return row ?? null;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.id, id)))
      .returning({ id: schema.contacts.id });
    return result.length > 0;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Expected: 6 tests passing.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/contacts/contacts.repo.ts apps/api/test/modules/contacts/contacts.repo.test.ts
git commit -m "feat(api): ContactsRepo (CRUD with org scoping + company filter)"
```

---

## Task 6: Companies routes + integration tests + tenancy isolation

**Files:**
- Create: `apps/api/src/modules/companies/routes.ts`
- Modify: `apps/api/src/server.ts` — register the route module when `opts.db` is provided
- Create: `apps/api/test/modules/companies/companies.routes.test.ts`
- Create: `apps/api/test/modules/companies/companies.tenancy.test.ts`

- [ ] **Step 1: Write `apps/api/src/modules/companies/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@dealflow/db';
import { ERROR_CODES, createCompanyBodySchema, updateCompanyBodySchema, paginationQuerySchema } from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { CompaniesRepo } from './companies.repo.js';
import type { schema } from '@dealflow/db';

const idParamSchema = z.object({ id: z.string().uuid() });

function publicCompany(row: typeof schema.companies.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    size: row.size,
    website: row.website,
    description: row.description,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerCompaniesRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const repo = new CompaniesRepo(deps.db);

  app.get('/api/v1/companies', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = paginationQuerySchema
      .extend({ q: z.string().min(1).optional() })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid query' },
      });
    }
    const result = await repo.list(req.session!.currentOrgId!, parsed.data);
    return reply.send({
      items: result.items.map(publicCompany),
      nextCursor: result.nextCursor,
    });
  });

  app.post('/api/v1/companies', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createCompanyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid company payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const created = await repo.create(req.session!.currentOrgId!, parsed.data);
    return reply.status(201).send({ company: publicCompany(created) });
  });

  app.get('/api/v1/companies/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const company = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!company) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Company not found' },
      });
    }
    return reply.send({ company: publicCompany(company) });
  });

  app.patch('/api/v1/companies/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const body = updateCompanyBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid patch' },
      });
    }
    const updated = await repo.update(req.session!.currentOrgId!, params.data.id, body.data);
    if (!updated) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Company not found' },
      });
    }
    return reply.send({ company: publicCompany(updated) });
  });

  app.delete('/api/v1/companies/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const ok = await repo.delete(req.session!.currentOrgId!, params.data.id);
    if (!ok) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Company not found' },
      });
    }
    return reply.status(204).send();
  });
}
```

- [ ] **Step 2: Modify `apps/api/src/server.ts` to register companies routes**

Inside the `if (opts.db) { ... }` block, after `registerAuthRoutes`, add:

```ts
    const { registerCompaniesRoutes } = await import('./modules/companies/routes.js');
    await registerCompaniesRoutes(app, { db: opts.db });
```

- [ ] **Step 3: Write `apps/api/test/modules/companies/companies.routes.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Companies routes', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    const auth = await signupTestUser(app);
    cookie = auth.cookie;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('POST creates and GET fetches', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'Acme', domain: 'acme.com' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ company: { id: string; name: string } }>();
    expect(body.company.name).toBe('Acme');

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${body.company.id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ company: { name: string } }>().company.name).toBe('Acme');
  });

  it('GET list returns items + nextCursor null when under page size', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/companies?limit=50',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST rejects missing required name with 400 VALIDATION_FAILED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { domain: 'no-name.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH updates partial fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'Patch Me' },
    });
    const id = created.json<{ company: { id: string } }>().company.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${id}`,
      headers: { cookie },
      payload: { industry: 'SaaS' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ company: { industry: string; name: string } }>().company.industry).toBe('SaaS');
  });

  it('DELETE returns 204 then GET 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'DelMe' },
    });
    const id = created.json<{ company: { id: string } }>().company.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(404);
  });

  it('401 when not authed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/companies' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 4: Write `apps/api/test/modules/companies/companies.tenancy.test.ts`**

```ts
import { afterAll, beforeAll, describe } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { assertTenantIsolation } from '../../helpers/tenant-isolation.js';

describe('Companies tenancy', () => {
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

  async function createCompanyForOrgA(
    app: FastifyInstance,
    cookie: string,
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'OrgA Co' },
    });
    return res.json<{ company: { id: string } }>().company.id;
  }

  assertTenantIsolation('GET /api/v1/companies/:id', () => app, {
    method: 'GET',
    url: (id) => `/api/v1/companies/${id}`,
    createResource: (app, cookie) => createCompanyForOrgA(app, cookie),
  });

  assertTenantIsolation('PATCH /api/v1/companies/:id', () => app, {
    method: 'PATCH',
    url: (id) => `/api/v1/companies/${id}`,
    body: { name: 'hijack' },
    createResource: (app, cookie) => createCompanyForOrgA(app, cookie),
  });

  assertTenantIsolation('DELETE /api/v1/companies/:id', () => app, {
    method: 'DELETE',
    url: (id) => `/api/v1/companies/${id}`,
    createResource: (app, cookie) => createCompanyForOrgA(app, cookie),
  });
});
```

- [ ] **Step 5: Run both test files**

Run: `pnpm --filter @dealflow/api test test/modules/companies/`
Expected: 6 routes tests + 3 tenancy tests = 9 passing.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/companies apps/api/src/server.ts apps/api/test/modules/companies
git commit -m "feat(api): companies CRUD routes + tenancy isolation tests"
```

---

## Task 7: Contacts routes + integration tests + tenancy isolation

Mirrors Task 6 for contacts.

**Files:**
- Create: `apps/api/src/modules/contacts/routes.ts`
- Modify: `apps/api/src/server.ts` — register contacts route module
- Create: `apps/api/test/modules/contacts/contacts.routes.test.ts`
- Create: `apps/api/test/modules/contacts/contacts.tenancy.test.ts`

- [ ] **Step 1: Write `apps/api/src/modules/contacts/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database, schema } from '@dealflow/db';
import {
  ERROR_CODES,
  createContactBodySchema,
  updateContactBodySchema,
  paginationQuerySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ContactsRepo } from './contacts.repo.js';

const idParamSchema = z.object({ id: z.string().uuid() });

function publicContact(row: typeof schema.contacts.$inferSelect) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    title: row.title,
    companyId: row.companyId,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerContactsRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const repo = new ContactsRepo(deps.db);

  app.get('/api/v1/contacts', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = paginationQuerySchema
      .extend({
        q: z.string().min(1).optional(),
        companyId: z.string().uuid().optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid query' },
      });
    }
    const result = await repo.list(req.session!.currentOrgId!, parsed.data);
    return reply.send({
      items: result.items.map(publicContact),
      nextCursor: result.nextCursor,
    });
  });

  app.post('/api/v1/contacts', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createContactBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid contact payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const created = await repo.create(req.session!.currentOrgId!, parsed.data);
    return reply.status(201).send({ contact: publicContact(created) });
  });

  app.get('/api/v1/contacts/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const contact = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!contact) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' },
      });
    }
    return reply.send({ contact: publicContact(contact) });
  });

  app.patch('/api/v1/contacts/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const body = updateContactBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid patch' },
      });
    }
    const updated = await repo.update(req.session!.currentOrgId!, params.data.id, body.data);
    if (!updated) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' },
      });
    }
    return reply.send({ contact: publicContact(updated) });
  });

  app.delete('/api/v1/contacts/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const ok = await repo.delete(req.session!.currentOrgId!, params.data.id);
    if (!ok) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' },
      });
    }
    return reply.status(204).send();
  });
}
```

- [ ] **Step 2: Register in `apps/api/src/server.ts`**

Add after the companies registration:

```ts
    const { registerContactsRoutes } = await import('./modules/contacts/routes.js');
    await registerContactsRoutes(app, { db: opts.db });
```

- [ ] **Step 3: Write `apps/api/test/modules/contacts/contacts.routes.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Contacts routes', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    const auth = await signupTestUser(app);
    cookie = auth.cookie;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('POST creates with first name only and GET fetches', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Carol' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ contact: { id: string } }>().contact.id;

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ contact: { firstName: string } }>().contact.firstName).toBe('Carol');
  });

  it('POST rejects missing firstName with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { lastName: 'NoFirst' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('POST with companyId links to that company', async () => {
    const company = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'LinkedCo' },
    });
    const companyId = company.json<{ company: { id: string } }>().company.id;
    const contact = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Linked', companyId },
    });
    expect(contact.statusCode).toBe(201);
    expect(contact.json<{ contact: { companyId: string } }>().contact.companyId).toBe(companyId);
  });

  it('PATCH updates partial fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Patchable' },
    });
    const id = created.json<{ contact: { id: string } }>().contact.id;
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
      payload: { title: 'CTO' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ contact: { title: string } }>().contact.title).toBe('CTO');
  });

  it('DELETE returns 204 then GET 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'DelMe' },
    });
    const id = created.json<{ contact: { id: string } }>().contact.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(404);
  });

  it('401 when not authed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 4: Write `apps/api/test/modules/contacts/contacts.tenancy.test.ts`**

```ts
import { afterAll, beforeAll, describe } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { assertTenantIsolation } from '../../helpers/tenant-isolation.js';

describe('Contacts tenancy', () => {
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

  async function createContactForOrgA(app: FastifyInstance, cookie: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'OrgA' },
    });
    return res.json<{ contact: { id: string } }>().contact.id;
  }

  assertTenantIsolation('GET /api/v1/contacts/:id', () => app, {
    method: 'GET',
    url: (id) => `/api/v1/contacts/${id}`,
    createResource: (app, cookie) => createContactForOrgA(app, cookie),
  });

  assertTenantIsolation('PATCH /api/v1/contacts/:id', () => app, {
    method: 'PATCH',
    url: (id) => `/api/v1/contacts/${id}`,
    body: { firstName: 'hijack' },
    createResource: (app, cookie) => createContactForOrgA(app, cookie),
  });

  assertTenantIsolation('DELETE /api/v1/contacts/:id', () => app, {
    method: 'DELETE',
    url: (id) => `/api/v1/contacts/${id}`,
    createResource: (app, cookie) => createContactForOrgA(app, cookie),
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @dealflow/api test test/modules/contacts/`
Expected: 6 routes + 3 tenancy = 9 passing.

- [ ] **Step 6: Typecheck + full test suite**

Run: `pnpm --filter @dealflow/api typecheck && pnpm --filter @dealflow/api test`
Expected: All previous tests still pass; ~60 total now.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/contacts apps/api/src/server.ts apps/api/test/modules/contacts
git commit -m "feat(api): contacts CRUD routes + tenancy isolation tests"
```

---

## Task 8: Web — API client + query hooks for companies + contacts

**Files:**
- Modify: `apps/web/src/lib/query-keys.ts` — add companies + contacts keys
- Create: `apps/web/src/features/companies/api.ts`
- Create: `apps/web/src/features/contacts/api.ts`

- [ ] **Step 1: Extend `apps/web/src/lib/query-keys.ts`**

Append to the existing `queryKeys` object (preserve `me` from Sub-Plan 2a):

```ts
export const queryKeys = {
  me: ['auth', 'me'] as const,
  companies: {
    all: ['companies'] as const,
    list: (q?: string) => ['companies', 'list', { q: q ?? '' }] as const,
    detail: (id: string) => ['companies', 'detail', id] as const,
  },
  contacts: {
    all: ['contacts'] as const,
    list: (q?: string, companyId?: string) =>
      ['contacts', 'list', { q: q ?? '', companyId: companyId ?? '' }] as const,
    detail: (id: string) => ['contacts', 'detail', id] as const,
  },
};
```

- [ ] **Step 2: Write `apps/web/src/features/companies/api.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type {
  CreateCompanyInput,
  PublicCompany,
  UpdateCompanyInput,
} from '@dealflow/shared';

export interface CompanyListResponse {
  items: PublicCompany[];
  nextCursor: string | null;
}

export function listCompanies(q?: string): Promise<CompanyListResponse> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const qs = params.toString();
  return apiFetch<CompanyListResponse>(`/api/v1/companies${qs ? `?${qs}` : ''}`);
}

export function getCompany(id: string): Promise<{ company: PublicCompany }> {
  return apiFetch(`/api/v1/companies/${id}`);
}

export function createCompany(input: CreateCompanyInput): Promise<{ company: PublicCompany }> {
  return apiFetch('/api/v1/companies', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCompany(
  id: string,
  patch: UpdateCompanyInput,
): Promise<{ company: PublicCompany }> {
  return apiFetch(`/api/v1/companies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteCompany(id: string): Promise<void> {
  return apiFetch(`/api/v1/companies/${id}`, { method: 'DELETE' });
}

// ----- React Query hooks -----

export function useCompaniesList(q?: string) {
  return useQuery({
    queryKey: queryKeys.companies.list(q),
    queryFn: () => listCompanies(q),
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.companies.detail(id) : ['companies', 'detail', 'none'],
    queryFn: () => getCompany(id!),
    enabled: Boolean(id),
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCompany,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });
}

export function useUpdateCompany(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateCompanyInput) => updateCompany(id, patch),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.companies.detail(id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteCompany,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });
}
```

- [ ] **Step 3: Write `apps/web/src/features/contacts/api.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type {
  CreateContactInput,
  PublicContact,
  UpdateContactInput,
} from '@dealflow/shared';

export interface ContactListResponse {
  items: PublicContact[];
  nextCursor: string | null;
}

export function listContacts(q?: string, companyId?: string): Promise<ContactListResponse> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (companyId) params.set('companyId', companyId);
  const qs = params.toString();
  return apiFetch<ContactListResponse>(`/api/v1/contacts${qs ? `?${qs}` : ''}`);
}

export function getContact(id: string): Promise<{ contact: PublicContact }> {
  return apiFetch(`/api/v1/contacts/${id}`);
}

export function createContact(input: CreateContactInput): Promise<{ contact: PublicContact }> {
  return apiFetch('/api/v1/contacts', { method: 'POST', body: JSON.stringify(input) });
}

export function updateContact(
  id: string,
  patch: UpdateContactInput,
): Promise<{ contact: PublicContact }> {
  return apiFetch(`/api/v1/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteContact(id: string): Promise<void> {
  return apiFetch(`/api/v1/contacts/${id}`, { method: 'DELETE' });
}

// ----- React Query hooks -----

export function useContactsList(q?: string, companyId?: string) {
  return useQuery({
    queryKey: queryKeys.contacts.list(q, companyId),
    queryFn: () => listContacts(q, companyId),
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.contacts.detail(id) : ['contacts', 'detail', 'none'],
    queryFn: () => getContact(id!),
    enabled: Boolean(id),
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateContactInput) => updateContact(id, patch),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.contacts.detail(id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteContact,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}
```

- [ ] **Step 4: Typecheck web**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: No errors. (Routes don't exist yet but that's not a typecheck failure — they're new files that nothing imports yet.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/query-keys.ts apps/web/src/features
git commit -m "feat(web): API client + TanStack Query hooks for companies + contacts"
```

---

## Task 9: shadcn primitives + InlineEdit + EntityTable

This task installs the shadcn components we'll need for list + detail pages, plus writes two small generic components.

**Files:**
- Generated by shadcn CLI: `apps/web/src/components/ui/{table,dialog,dropdown-menu,alert-dialog,select}.tsx`
- Create: `apps/web/src/components/inline-edit.tsx`
- Create: `apps/web/src/components/entity-table.tsx`

- [ ] **Step 1: Install shadcn primitives**

```powershell
pnpm --dir apps/web dlx shadcn@latest add table dialog dropdown-menu alert-dialog select
```

Expected: five new files under `apps/web/src/components/ui/`. Accept any dependency-install prompts.

- [ ] **Step 2: Write `apps/web/src/components/inline-edit.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface InlineEditProps {
  value: string | null;
  placeholder?: string;
  onSave: (value: string) => void | Promise<void>;
  /** When true, render text muted (e.g. for nullable fields). */
  muted?: boolean;
  /** Custom class name on the read-mode span. */
  className?: string;
}

/**
 * Click-to-edit text field. Press Enter or blur to save, Esc to cancel.
 * No optimistic UI here — that lives in the calling mutation hook.
 */
export function InlineEdit({ value, placeholder, onSave, muted, className }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  async function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value ?? '')) {
      await onSave(next);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          'rounded px-1 py-0.5 text-left hover:bg-neutral-100',
          muted && !value && 'italic text-neutral-400',
          className,
        )}
        onClick={() => setEditing(true)}
      >
        {value ?? placeholder ?? '—'}
      </button>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          setDraft(value ?? '');
          setEditing(false);
        }
      }}
      className="h-7 px-1 py-0.5"
    />
  );
}
```

- [ ] **Step 3: Write `apps/web/src/components/entity-table.tsx`**

```tsx
import { Link } from '@tanstack/react-router';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface EntityColumn<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

interface EntityTableProps<T extends { id: string }> {
  columns: EntityColumn<T>[];
  rows: T[];
  rowHref: (row: T) => string;
  emptyMessage?: string;
}

/**
 * Generic table that links each row to a detail page. List pages use this
 * to render contacts/companies without duplicating layout.
 */
export function EntityTable<T extends { id: string }>({
  columns,
  rows,
  rowHref,
  emptyMessage,
}: EntityTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
        {emptyMessage ?? 'No items yet.'}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.header} className={c.className}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="cursor-pointer">
            {columns.map((c, i) => (
              <TableCell key={i} className={c.className}>
                {i === 0 ? (
                  <Link to={rowHref(row)} className="font-medium underline-offset-2 hover:underline">
                    {c.cell(row)}
                  </Link>
                ) : (
                  c.cell(row)
                )}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Typecheck + build the web app**

Run: `pnpm --filter @dealflow/web typecheck`
Run: `pnpm --filter @dealflow/web build`
Expected: Both succeed; `dist/` produced.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): shadcn primitives + InlineEdit + EntityTable"
```

---

## Task 10: Companies pages (list + detail)

**Files:**
- Create: `apps/web/src/features/companies/create-company-dialog.tsx`
- Create: `apps/web/src/routes/app/companies/index.tsx`
- Create: `apps/web/src/routes/app/companies/$id.tsx`

- [ ] **Step 1: Write `apps/web/src/features/companies/create-company-dialog.tsx`**

```tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createCompanyBodySchema, type CreateCompanyInput } from '@dealflow/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateCompany } from './api';

interface CreateCompanyDialogProps {
  trigger?: React.ReactNode;
  /** Controlled open state, for command-palette invocation. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateCompanyDialog({ trigger, open, onOpenChange }: CreateCompanyDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const mut = useCreateCompany();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCompanyInput>({ resolver: zodResolver(createCompanyBodySchema) });

  async function onSubmit(values: CreateCompanyInput) {
    await mut.mutateAsync(values);
    reset();
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} autoFocus />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="domain">Domain</Label>
            <Input id="domain" {...register('domain')} placeholder="example.com" />
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create company'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/routes/app/companies/index.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EntityTable, type EntityColumn } from '@/components/entity-table';
import { CreateCompanyDialog } from '@/features/companies/create-company-dialog';
import { useCompaniesList } from '@/features/companies/api';
import type { PublicCompany } from '@dealflow/shared';

export const Route = createFileRoute('/app/companies/')({
  component: CompaniesListPage,
});

function CompaniesListPage() {
  const [q, setQ] = useState('');
  const query = useCompaniesList(q || undefined);

  const columns: EntityColumn<PublicCompany>[] = [
    { header: 'Name', cell: (c) => c.name },
    { header: 'Domain', cell: (c) => c.domain ?? '—' },
    { header: 'Industry', cell: (c) => c.industry ?? '—' },
    {
      header: 'Created',
      cell: (c) => new Date(c.createdAt).toLocaleDateString(),
      className: 'text-right text-sm text-neutral-500',
    },
  ];

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <CreateCompanyDialog trigger={<Button>New company</Button>} />
      </div>
      <div className="mb-3">
        <Input
          placeholder="Search by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>
      {query.isPending ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : query.error ? (
        <p className="text-sm text-red-600">Failed to load companies.</p>
      ) : (
        <EntityTable
          columns={columns}
          rows={query.data!.items}
          rowHref={(c) => `/app/companies/${c.id}`}
          emptyMessage="No companies yet. Create your first one to get started."
        />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/routes/app/companies/$id.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { InlineEdit } from '@/components/inline-edit';
import { useCompany, useUpdateCompany } from '@/features/companies/api';

export const Route = createFileRoute('/app/companies/$id')({
  component: CompanyDetailPage,
});

function CompanyDetailPage() {
  const { id } = Route.useParams();
  const { data, isPending, error } = useCompany(id);
  const update = useUpdateCompany(id);

  if (isPending) return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  if (error || !data) {
    return <main className="p-6 text-sm text-red-600">Could not load company.</main>;
  }

  const c = data.company;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight" data-testid="company-name">
        {c.name}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">Company · created {new Date(c.createdAt).toLocaleDateString()}</p>

      <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
        <dt className="text-neutral-500">Name</dt>
        <dd>
          <InlineEdit value={c.name} onSave={(v) => update.mutateAsync({ name: v })} />
        </dd>
        <dt className="text-neutral-500">Domain</dt>
        <dd>
          <InlineEdit
            value={c.domain}
            placeholder="example.com"
            onSave={(v) => update.mutateAsync({ domain: v || undefined })}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Industry</dt>
        <dd>
          <InlineEdit
            value={c.industry}
            placeholder="—"
            onSave={(v) => update.mutateAsync({ industry: v || undefined })}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Website</dt>
        <dd>
          <InlineEdit
            value={c.website}
            placeholder="https://…"
            onSave={(v) => update.mutateAsync({ website: v || undefined })}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Description</dt>
        <dd>
          <InlineEdit
            value={c.description}
            placeholder="Add a note about this company"
            onSave={(v) => update.mutateAsync({ description: v || undefined })}
            muted
          />
        </dd>
      </dl>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck`
Run: `pnpm --filter @dealflow/web build`
Expected: Both succeed.

- [ ] **Step 5: Smoke in the dev server**

Start the web + api dev servers (if not running). Open `http://localhost:5173/app/companies`. Should redirect to /login if not signed in. Sign up, then return: you see the empty state. Click "New company", enter a name, submit. The company appears in the table. Click the name → detail page. Click "Industry" → type "SaaS" → press Enter. The page persists.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/companies apps/web/src/routes/app/companies apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /app/companies list + detail (inline edit) + create-company dialog"
```

---

## Task 11: Contacts pages (list + detail)

Mirrors Task 10 for contacts.

**Files:**
- Create: `apps/web/src/features/contacts/create-contact-dialog.tsx`
- Create: `apps/web/src/routes/app/contacts/index.tsx`
- Create: `apps/web/src/routes/app/contacts/$id.tsx`

- [ ] **Step 1: Write `apps/web/src/features/contacts/create-contact-dialog.tsx`**

```tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createContactBodySchema, type CreateContactInput } from '@dealflow/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateContact } from './api';

interface CreateContactDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateContactDialog({ trigger, open, onOpenChange }: CreateContactDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const mut = useCreateContact();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateContactInput>({ resolver: zodResolver(createContactBodySchema) });

  async function onSubmit(values: CreateContactInput) {
    await mut.mutateAsync(values);
    reset();
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" {...register('firstName')} autoFocus />
              {errors.firstName && <p className="text-sm text-red-600">{errors.firstName.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" {...register('lastName')} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...register('title')} placeholder="e.g., CEO" />
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create contact'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/routes/app/contacts/index.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EntityTable, type EntityColumn } from '@/components/entity-table';
import { CreateContactDialog } from '@/features/contacts/create-contact-dialog';
import { useContactsList } from '@/features/contacts/api';
import type { PublicContact } from '@dealflow/shared';

export const Route = createFileRoute('/app/contacts/')({
  component: ContactsListPage,
});

function ContactsListPage() {
  const [q, setQ] = useState('');
  const query = useContactsList(q || undefined);

  const columns: EntityColumn<PublicContact>[] = [
    {
      header: 'Name',
      cell: (c) => [c.firstName, c.lastName].filter(Boolean).join(' '),
    },
    { header: 'Email', cell: (c) => c.email ?? '—' },
    { header: 'Title', cell: (c) => c.title ?? '—' },
    {
      header: 'Created',
      cell: (c) => new Date(c.createdAt).toLocaleDateString(),
      className: 'text-right text-sm text-neutral-500',
    },
  ];

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <CreateContactDialog trigger={<Button>New contact</Button>} />
      </div>
      <div className="mb-3">
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>
      {query.isPending ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : query.error ? (
        <p className="text-sm text-red-600">Failed to load contacts.</p>
      ) : (
        <EntityTable
          columns={columns}
          rows={query.data!.items}
          rowHref={(c) => `/app/contacts/${c.id}`}
          emptyMessage="No contacts yet. Add your first one."
        />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/routes/app/contacts/$id.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { InlineEdit } from '@/components/inline-edit';
import { useContact, useUpdateContact } from '@/features/contacts/api';

export const Route = createFileRoute('/app/contacts/$id')({
  component: ContactDetailPage,
});

function ContactDetailPage() {
  const { id } = Route.useParams();
  const { data, isPending, error } = useContact(id);
  const update = useUpdateContact(id);

  if (isPending) return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  if (error || !data) {
    return <main className="p-6 text-sm text-red-600">Could not load contact.</main>;
  }

  const c = data.contact;
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed contact';

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight" data-testid="contact-name">
        {fullName}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Contact · created {new Date(c.createdAt).toLocaleDateString()}
      </p>

      <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
        <dt className="text-neutral-500">First name</dt>
        <dd>
          <InlineEdit value={c.firstName} onSave={(v) => update.mutateAsync({ firstName: v })} />
        </dd>
        <dt className="text-neutral-500">Last name</dt>
        <dd>
          <InlineEdit
            value={c.lastName}
            placeholder="—"
            onSave={(v) => update.mutateAsync({ lastName: v || undefined })}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Email</dt>
        <dd>
          <InlineEdit
            value={c.email}
            placeholder="user@example.com"
            onSave={(v) => update.mutateAsync({ email: v || undefined })}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Phone</dt>
        <dd>
          <InlineEdit
            value={c.phone}
            placeholder="—"
            onSave={(v) => update.mutateAsync({ phone: v || undefined })}
            muted
          />
        </dd>
        <dt className="text-neutral-500">Title</dt>
        <dd>
          <InlineEdit
            value={c.title}
            placeholder="—"
            onSave={(v) => update.mutateAsync({ title: v || undefined })}
            muted
          />
        </dd>
      </dl>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build + smoke**

Run: `pnpm --filter @dealflow/web typecheck`
Run: `pnpm --filter @dealflow/web build`

Smoke: navigate to `/app/contacts`, create a contact, click into detail, edit a field inline, refresh — value persists.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/contacts apps/web/src/routes/app/contacts apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /app/contacts list + detail (inline edit) + create-contact dialog"
```

---

## Task 12: Cmd-K command palette + wire into /app shell

**Files:**
- Create: `apps/web/src/components/command-palette.tsx`
- Modify: `apps/web/src/routes/app/_layout.tsx` — mount `<CommandPalette>` once for the whole /app subtree
- Add a navigation menu pointing to /app/companies and /app/contacts in the same layout

- [ ] **Step 1: Write `apps/web/src/components/command-palette.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { CreateCompanyDialog } from '@/features/companies/create-company-dialog';
import { CreateContactDialog } from '@/features/contacts/create-contact-dialog';

/**
 * Global Cmd/Ctrl-K palette. Holds command definitions inline for now;
 * Sub-Plans 4+ can extract a registry if the list grows past ~20 entries.
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [createContactOpen, setCreateContactOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Create">
            <CommandItem onSelect={() => run(() => setCreateContactOpen(true))}>
              Create contact
              <CommandShortcut>C C</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => setCreateCompanyOpen(true))}>
              Create company
              <CommandShortcut>C O</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => run(() => void navigate({ to: '/app/contacts' }))}>
              Contacts
              <CommandShortcut>G C</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate({ to: '/app/companies' }))}>
              Companies
              <CommandShortcut>G O</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate({ to: '/app' }))}>
              Home
              <CommandShortcut>G H</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <CreateCompanyDialog open={createCompanyOpen} onOpenChange={setCreateCompanyOpen} />
      <CreateContactDialog open={createContactOpen} onOpenChange={setCreateContactOpen} />
    </>
  );
}
```

- [ ] **Step 2: Modify `apps/web/src/routes/app/_layout.tsx` to mount the palette + a sidebar nav**

Read the existing file first; the goal is to:
- Import `CommandPalette` and render it inside the layout's root div.
- Add a simple left sidebar with two links: `Contacts` (`/app/contacts`), `Companies` (`/app/companies`), plus the existing header (DealFlow + email + sign out).

Final file content (full replacement):

```tsx
import { createFileRoute, Outlet, redirect, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { getMe, logout } from '@/lib/auth';
import { CommandPalette } from '@/components/command-palette';

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
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
    <div className="flex min-h-screen bg-white">
      <aside className="hidden w-48 shrink-0 border-r border-neutral-200 p-4 md:block">
        <nav className="flex flex-col gap-1 text-sm">
          <Link
            to="/app/contacts"
            className="rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
            activeProps={{ className: 'rounded px-2 py-1.5 bg-neutral-100 font-medium text-neutral-900' }}
          >
            Contacts
          </Link>
          <Link
            to="/app/companies"
            className="rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
            activeProps={{ className: 'rounded px-2 py-1.5 bg-neutral-100 font-medium text-neutral-900' }}
          >
            Companies
          </Link>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
          <span className="font-semibold tracking-tight">DealFlow</span>
          <div className="flex items-center gap-3 text-sm">
            <kbd className="hidden rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-xs text-neutral-500 md:inline">
              ⌘K
            </kbd>
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

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>

      <CommandPalette />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck`
Run: `pnpm --filter @dealflow/web build`

- [ ] **Step 4: Smoke**

In the dev server, sign in. Press **Cmd-K / Ctrl-K**. Palette opens. Type "co" — both "Create company" and "Companies" rank. Select "Create company". The dialog opens. Submit. The company list refreshes. Use the sidebar to navigate.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/command-palette.tsx apps/web/src/routes/app/_layout.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): Cmd-K palette + /app sidebar nav (contacts/companies)"
```

---

## Task 13: E2E test + full smoke + tag + push

**Files:**
- Create: `e2e/tests/contacts-companies.spec.ts`

- [ ] **Step 1: Write `e2e/tests/contacts-companies.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

test('signup, create company, create contact, both visible in lists', async ({ page }) => {
  const email = `e2e_cc_${Date.now()}@example.com`;

  // Signup
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('E2E User');
  await page.getByLabel('Organization name').fill('E2E Org');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app/);

  // Create a company via the dedicated UI
  await page.goto('/app/companies');
  await page.getByRole('button', { name: /new company/i }).click();
  await page.getByLabel('Name').fill('Beta Industries');
  await page.getByRole('button', { name: /create company/i }).click();
  await expect(page.getByRole('link', { name: 'Beta Industries' })).toBeVisible();

  // Create a contact via the dedicated UI
  await page.goto('/app/contacts');
  await page.getByRole('button', { name: /new contact/i }).click();
  await page.getByLabel('First name').fill('Alice');
  await page.getByLabel('Last name').fill('Smith');
  await page.getByLabel('Email').fill('alice@beta.com');
  await page.getByRole('button', { name: /create contact/i }).click();
  await expect(page.getByRole('link', { name: /Alice Smith/i })).toBeVisible();

  // Open Alice's detail page and inline-edit her title
  await page.getByRole('link', { name: /Alice Smith/i }).click();
  await expect(page).toHaveURL(/\/app\/contacts\//);
  await page.getByText('—').first(); // assert that an empty field exists somewhere
  // Inline-edit the title field (find the Title row's button, click, type, Enter)
  const titleRow = page.locator('dt:has-text("Title") + dd button');
  await titleRow.click();
  await page.locator('dt:has-text("Title") + dd input').fill('CEO');
  await page.keyboard.press('Enter');
  await expect(page.locator('dt:has-text("Title") + dd')).toContainText('CEO');
});

test('Cmd-K opens command palette and create-contact works from it', async ({ page }) => {
  const email = `e2e_cmdk_${Date.now()}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Cmd User');
  await page.getByLabel('Organization name').fill('Cmd Org');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app/);

  // Trigger Cmd-K
  await page.keyboard.press('Meta+K');
  await expect(page.getByPlaceholder('Type a command…')).toBeVisible();

  // Pick "Create contact"
  await page.getByRole('option', { name: /create contact/i }).click();
  await page.getByLabel('First name').fill('FromPalette');
  await page.getByRole('button', { name: /create contact/i }).click();

  // Verify it appears on the list page
  await page.goto('/app/contacts');
  await expect(page.getByRole('link', { name: /FromPalette/i })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E (servers auto-started by Playwright config)**

Run: `pnpm test:e2e`
Expected: All Playwright specs pass — the existing home + auth flow specs from prior sub-plans plus the two new ones here.

> **Heads-up on Cmd-K on Windows:** Playwright's `Meta+K` maps to the platform's primary modifier — on Windows that's Ctrl. The palette responds to either `Cmd-K` or `Ctrl-K` (we listen to both via `e.metaKey || e.ctrlKey`), so the test works cross-platform.

- [ ] **Step 3: Commit the E2E spec**

```bash
git add e2e/tests/contacts-companies.spec.ts
git commit -m "test(e2e): contacts + companies flow + Cmd-K palette"
```

- [ ] **Step 4: Full smoke**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

All five must pass.

- [ ] **Step 5: Tag the milestone + push**

```bash
git tag -a sub-plan-3-contacts-companies -m "Sub-Plan 3: Contacts & Companies CRUD + Cmd-K complete"
git push origin main
git push origin sub-plan-3-contacts-companies
```

---

## Done Criteria for Sub-Plan 3

- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck` all green.
- [ ] `pnpm test` green. Approximate count: **~75 tests** (Sub-Plan 2a's ~54 + 6 CompaniesRepo + 6 ContactsRepo + 6 companies routes + 6 contacts routes + 3 companies tenancy + 3 contacts tenancy = ~84; exact number can shift by ±3).
- [ ] `pnpm test:e2e` green. Playwright specs: home smoke + signup/logout + new contacts/companies flow + Cmd-K invocation.
- [ ] Manual smoke confirmed: signup → create a company → create a contact → click into details → inline-edit a field → refresh, value persists.
- [ ] Cmd-K opens the palette; "Create contact" and "Create company" both work; navigation commands work.
- [ ] Tag `sub-plan-3-contacts-companies` pushed to GitHub.

---

## What Sub-Plan 4 will build on this

- `deals`, `pipelines`, `pipeline_stages` tables. Deals reference `contacts.id` and `companies.id`.
- Drag-and-drop kanban view at `/app/deals` (TanStack Query optimistic mutations on stage changes).
- Default pipeline seeded on org creation (5 stages: Lead → Qualified → Proposal → Negotiation → Closed Won/Lost).
- Cmd-K gets "Create deal" + "Go to deals" commands.
- The `EntityTable`, `InlineEdit`, and `requireOrg` primitives from this plan are reused.

---

## Open questions (track, don't block)

1. **Contact-company link UI in `create-contact-dialog`.** Currently the create-contact form has no company picker. Sub-Plan 3 lets you link via the API (`companyId`) but not the UI — added in Sub-Plan 4 alongside deal-contact-company linkage so we design the picker once.
2. **Soft delete vs hard delete.** Currently DELETE is destructive. Spec §18 open question — defer to Phase 2 unless an early user explicitly asks.
3. **Pagination cursor format.** Using `createdAt.toISOString()` as the cursor is simple but doesn't tie-break on rows with identical timestamps. Acceptable for Phase 1 dev loads; revisit if collisions show up.
