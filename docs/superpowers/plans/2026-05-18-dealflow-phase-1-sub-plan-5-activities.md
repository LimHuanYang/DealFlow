# DealFlow Phase 1 Sub-Plan 5: Activities (Notes + Tasks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a unified Activities feature — notes and tasks — that lives on every contact, company, and deal as a timeline, plus a dedicated `/app/tasks` page for follow-up management.

**Architecture:** Single `activities` table with a `kind` discriminator (`'note' | 'task'`) and a polymorphic parent link (exactly one of `contact_id` / `company_id` / `deal_id` set, enforced by a CHECK constraint). Notes have only `body`; tasks add `status` (open/done), `due_at`, `completed_at`. An activity feed component renders chronologically on each entity detail page. Tasks also surface in a global `/app/tasks` page with filters (open / done / overdue / due today).

**Tech Stack:** Drizzle ORM + Postgres (single new table + CHECK constraint), Fastify routes with `requireOrg` guard, zod for schemas, React 19 + TanStack Query + Tailwind v4 + shadcn primitives. No new deps.

**Scope decisions (final):**
- **Kinds:** `note` and `task` only. Calls / meetings / emails defer to Sub-Plan 2b (email) and a future Sub-Plan (voice/CTI).
- **Parent link:** activity belongs to exactly ONE of contact/company/deal (CHECK constraint enforces). Simpler than a many-to-many join table; matches how 90% of CRM activities are used.
- **Authorship:** `owner_user_id` = creator = assignee for v1 (you can only assign tasks to yourself). A separate `assignee_user_id` can land later.
- **Permissions:** any org member can read, edit, complete, or delete any activity (consistent with the existing contacts/companies/deals pattern; tighten via roles later).
- **Cascades:** deleting a contact/company/deal cascades its activities (`ON DELETE CASCADE`).
- **Time:** `due_at` is `timestamp with time zone` — the form takes a date input, but storage stays a timestamp so we can add time-of-day later without a migration.

---

## File Structure

### New files
- `packages/db/src/schema/activities.ts` — Drizzle schema
- `packages/db/migrations/0005_create_activities.sql` — hand-written DDL
- `packages/shared/src/activities.ts` — public types, zod schemas, kind/status enums
- `apps/api/src/modules/activities/activities.repo.ts` — DB access layer
- `apps/api/src/modules/activities/routes.ts` — HTTP routes
- `apps/api/test/modules/activities/activities.repo.test.ts` — unit tests
- `apps/api/test/modules/activities/activities.routes.test.ts` — integration tests
- `apps/api/test/modules/activities/activities.tenancy.test.ts` — cross-tenant isolation
- `apps/web/src/features/activities/api.ts` — TanStack Query hooks
- `apps/web/src/features/activities/activity-feed.tsx` — timeline component
- `apps/web/src/features/activities/add-note-form.tsx` — inline note composer
- `apps/web/src/features/activities/add-task-form.tsx` — inline task composer
- `apps/web/src/features/activities/task-item.tsx` — single task row (used by feed + /tasks page)
- `apps/web/src/routes/app.tasks.tsx` — `/app/tasks` route
- `apps/web/e2e/activities.spec.ts` — smoke E2E

### Modified files
- `packages/db/src/schema/index.ts` — re-export `activities`
- `packages/db/migrations/meta/_journal.json` — add idx 5
- `packages/shared/src/index.ts` — re-export `activities`
- `apps/api/src/server.ts` — register activities routes
- `apps/web/src/lib/query-keys.ts` — add `activities` and `tasks` keys
- `apps/web/src/routes/app.contacts.$id.tsx` — embed `<ActivityFeed>`
- `apps/web/src/routes/app.companies.$id.tsx` — embed `<ActivityFeed>`
- `apps/web/src/routes/app.deals.$id.tsx` — embed `<ActivityFeed>`
- `apps/web/src/routes/app.tsx` — add `/app/tasks` sidebar link

---

## API surface

| Method | Path                              | Purpose                                          |
| ------ | --------------------------------- | ------------------------------------------------ |
| POST   | `/api/v1/activities`              | Create a note or task                            |
| GET    | `/api/v1/activities?<parent>=:id` | List activities for ONE parent (contact/company/deal) |
| GET    | `/api/v1/tasks`                   | List tasks across the org, with filters          |
| PATCH  | `/api/v1/activities/:id`          | Edit body / due_at / mark done (status)          |
| DELETE | `/api/v1/activities/:id`          | Delete                                           |

All routes use `requireOrg`. The parent filter on GET `/activities` accepts exactly one of `contactId` / `companyId` / `dealId`; missing or multiple → 400.

---

### Task 1: Schema + migration

**Files:**
- Create: `packages/db/src/schema/activities.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0005_create_activities.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Define Drizzle schema**

Create `packages/db/src/schema/activities.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

    // Exactly one of these is set (enforced by CHECK).
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),

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
```

- [ ] **Step 2: Re-export from schema barrel**

Edit `packages/db/src/schema/index.ts`. Append:

```typescript
export * from './activities';
```

- [ ] **Step 3: Hand-write the SQL migration**

Create `packages/db/migrations/0005_create_activities.sql`:

```sql
-- Sub-Plan 5: Activities (notes + tasks).
--
-- One unified table for both kinds. Discriminated by `kind` ('note' | 'task').
-- Task-only columns (status, due_at, completed_at) are nullable so notes can
-- leave them NULL. Parent link is polymorphic: exactly one of contact_id,
-- company_id, deal_id must be set (CHECK constraint enforces).
--
-- Cascading deletes: removing a parent entity removes its activities.
CREATE TABLE IF NOT EXISTS "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "owner_user_id" uuid,
  "kind" text NOT NULL,
  "body" text NOT NULL,
  "status" text,
  "due_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "contact_id" uuid,
  "company_id" uuid,
  "deal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "activities_one_parent_check" CHECK (
    (CASE WHEN "contact_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "company_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "deal_id"    IS NOT NULL THEN 1 ELSE 0 END)
  ) = 1
);
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_deal_id_deals_id_fk"
  FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_org_kind_idx" ON "activities" ("organization_id","kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_org_due_at_idx" ON "activities" ("organization_id","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_contact_idx" ON "activities" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_company_idx" ON "activities" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_deal_idx" ON "activities" ("deal_id");
```

- [ ] **Step 4: Register migration in journal**

Edit `packages/db/migrations/meta/_journal.json` — append an entry to `entries` (after idx 4):

```json
    {
      "idx": 5,
      "version": "7",
      "when": 1779200000000,
      "tag": "0005_create_activities",
      "breakpoints": true
    }
```

- [ ] **Step 5: Apply the migration locally**

Run: `pnpm --filter @dealflow/db db:migrate`

Expected: `[✓] migrations applied successfully!`

- [ ] **Step 6: Verify the table exists**

Run a small Node script in the db package, or query via psql if available:

```bash
pnpm --filter @dealflow/db exec node -e "import('postgres').then(({default:postgres})=>{const sql=postgres('postgres://postgres:postgres@localhost:5432/dealflow');sql\`SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name='activities' ORDER BY ordinal_position\`.then(rows=>{console.log(rows);return sql.end();})})"
```

Expected: 13 rows (id, organization_id, owner_user_id, kind, body, status, due_at, completed_at, contact_id, company_id, deal_id, created_at, updated_at).

- [ ] **Step 7: Verify typecheck**

Run: `pnpm --filter @dealflow/db typecheck`

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/activities.ts packages/db/src/schema/index.ts packages/db/migrations/0005_create_activities.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): create activities table (0005)"
```

---

### Task 2: Shared types + zod schemas

**Files:**
- Create: `packages/shared/src/activities.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/activities.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/activities.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  createActivityBodySchema,
  updateActivityBodySchema,
  listTasksQuerySchema,
  ACTIVITY_KINDS,
  TASK_STATUSES,
} from './activities.js';

describe('createActivityBodySchema', () => {
  it('accepts a minimal note attached to a contact', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'note',
      body: 'Met at conference',
      contactId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a task with a due date attached to a deal', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'task',
      body: 'Send proposal',
      dealId: '00000000-0000-0000-0000-000000000001',
      dueAt: '2026-06-01',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'call',
      body: 'x',
      contactId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r.success).toBe(false);
  });

  it('rejects payload with NO parent', () => {
    const r = createActivityBodySchema.safeParse({ kind: 'note', body: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects payload with TWO parents', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'note',
      body: 'x',
      contactId: '00000000-0000-0000-0000-000000000001',
      companyId: '00000000-0000-0000-0000-000000000002',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty body', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'note',
      body: '',
      contactId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r.success).toBe(false);
  });

  it('rejects bad uuid', () => {
    const r = createActivityBodySchema.safeParse({
      kind: 'note',
      body: 'x',
      contactId: 'not-a-uuid',
    });
    expect(r.success).toBe(false);
  });
});

describe('updateActivityBodySchema', () => {
  it('accepts an empty patch', () => {
    const r = updateActivityBodySchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts partial body and status', () => {
    const r = updateActivityBodySchema.safeParse({ body: 'edit', status: 'done' });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const r = updateActivityBodySchema.safeParse({ status: 'archived' });
    expect(r.success).toBe(false);
  });

  it('accepts null dueAt (clearing the due date)', () => {
    const r = updateActivityBodySchema.safeParse({ dueAt: null });
    expect(r.success).toBe(true);
  });
});

describe('listTasksQuerySchema', () => {
  it('accepts empty query (defaults to status=open, due=all)', () => {
    const r = listTasksQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('open');
      expect(r.data.due).toBe('all');
    }
  });

  it('accepts status=done', () => {
    const r = listTasksQuerySchema.safeParse({ status: 'done' });
    expect(r.success).toBe(true);
  });

  it('accepts due=overdue, today, upcoming', () => {
    expect(listTasksQuerySchema.safeParse({ due: 'overdue' }).success).toBe(true);
    expect(listTasksQuerySchema.safeParse({ due: 'today' }).success).toBe(true);
    expect(listTasksQuerySchema.safeParse({ due: 'upcoming' }).success).toBe(true);
  });

  it('rejects unknown filter values', () => {
    expect(listTasksQuerySchema.safeParse({ status: 'foo' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ due: 'bar' }).success).toBe(false);
  });
});

describe('ACTIVITY_KINDS / TASK_STATUSES', () => {
  it('ACTIVITY_KINDS is exactly ["note","task"]', () => {
    expect([...ACTIVITY_KINDS]).toEqual(['note', 'task']);
  });
  it('TASK_STATUSES is exactly ["open","done"]', () => {
    expect([...TASK_STATUSES]).toEqual(['open', 'done']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dealflow/shared test activities`

Expected: FAIL — `Cannot find module './activities.js'`.

- [ ] **Step 3: Implement shared types + schemas**

Create `packages/shared/src/activities.ts`:

```typescript
import { z } from 'zod';

export const ACTIVITY_KINDS = ['note', 'task'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const TASK_STATUSES = ['open', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const uuid = z.string().uuid();

// "Date-only" input: the HTML <input type="date"> sends 'YYYY-MM-DD'. We also
// accept full ISO timestamps for API symmetry. The API layer converts the
// final value to a JS Date before storage.
const dueAtInput = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  z.string().datetime(),
]);

/**
 * Body for POST /api/v1/activities. Exactly one of `contactId`, `companyId`,
 * `dealId` must be set — refined below.
 */
export const createActivityBodySchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    body: z.string().min(1).max(8000),
    contactId: uuid.optional(),
    companyId: uuid.optional(),
    dealId: uuid.optional(),
    dueAt: dueAtInput.optional(),
  })
  .refine(
    (v) => {
      const n =
        (v.contactId ? 1 : 0) + (v.companyId ? 1 : 0) + (v.dealId ? 1 : 0);
      return n === 1;
    },
    {
      message: 'Set exactly one of contactId, companyId, dealId',
      path: ['contactId'],
    },
  );
export type CreateActivityInput = z.infer<typeof createActivityBodySchema>;

/**
 * Body for PATCH /api/v1/activities/:id.
 *
 * `dueAt: null` is allowed to clear an existing due date. `status` set to
 * 'done' will cause the API layer to also stamp `completed_at = now()`.
 */
export const updateActivityBodySchema = z.object({
  body: z.string().min(1).max(8000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueAt: dueAtInput.nullable().optional(),
});
export type UpdateActivityInput = z.infer<typeof updateActivityBodySchema>;

/**
 * Query for GET /api/v1/tasks.
 *   status: 'open' (default) | 'done'
 *   due: 'all' (default) | 'overdue' | 'today' | 'upcoming'
 */
export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).default('open'),
  due: z.enum(['all', 'overdue', 'today', 'upcoming']).default('all'),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export interface PublicActivity {
  id: string;
  kind: ActivityKind;
  body: string;
  status: TaskStatus | null;
  dueAt: string | null; // ISO 8601 string when set
  completedAt: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Re-export from shared index**

Edit `packages/shared/src/index.ts`. Append:

```typescript
export * from './activities.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @dealflow/shared test activities`

Expected: All ~15 cases PASS.

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @dealflow/shared typecheck`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/activities.ts packages/shared/src/activities.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): activity + task types and zod schemas"
```

---

### Task 3: ActivitiesRepo + unit tests

**Files:**
- Create: `apps/api/src/modules/activities/activities.repo.ts`
- Create: `apps/api/test/modules/activities/activities.repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/modules/activities/activities.repo.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { ActivitiesRepo } from '../../../src/modules/activities/activities.repo.js';
import { ContactsRepo } from '../../../src/modules/contacts/contacts.repo.js';

describe('ActivitiesRepo', () => {
  let testDb: TestDatabase;
  let repo: ActivitiesRepo;
  let contacts: ContactsRepo;
  let orgId: string;
  let userId: string;
  let contactId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();

    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;

    const [user] = await testDb.db
      .insert(schema.users)
      .values({ email: `u${Date.now()}@example.com`, name: 'U', passwordHash: 'x' })
      .returning();
    userId = user!.id;

    repo = new ActivitiesRepo(testDb.db);
    contacts = new ContactsRepo(testDb.db);

    const c = await contacts.create(orgId, { firstName: 'Alice' });
    contactId = c.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('creates a note attached to a contact', async () => {
    const note = await repo.create(orgId, userId, {
      kind: 'note',
      body: 'Met at conference',
      contactId,
    });
    expect(note.kind).toBe('note');
    expect(note.body).toBe('Met at conference');
    expect(note.contactId).toBe(contactId);
    expect(note.status).toBeNull();
    expect(note.dueAt).toBeNull();
    expect(note.ownerUserId).toBe(userId);
  });

  it('creates a task with status=open by default', async () => {
    const task = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'Follow up',
      contactId,
    });
    expect(task.kind).toBe('task');
    expect(task.status).toBe('open');
    expect(task.dueAt).toBeNull();
  });

  it('creates a task with a YYYY-MM-DD dueAt', async () => {
    const task = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'Send proposal',
      contactId,
      dueAt: '2026-06-15',
    });
    expect(task.dueAt).toBeInstanceOf(Date);
    expect(task.dueAt!.toISOString().startsWith('2026-06-15')).toBe(true);
  });

  it('listForParent returns activities for a contact, newest first', async () => {
    const list = await repo.listForParent(orgId, { contactId });
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        list[i]!.createdAt.getTime(),
      );
    }
  });

  it('findById returns null for a different org', async () => {
    const note = await repo.create(orgId, userId, {
      kind: 'note',
      body: 'xx',
      contactId,
    });
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    expect(await repo.findById(otherOrg!.id, note.id)).toBeNull();
  });

  it('update merges body and bumps updatedAt', async () => {
    const note = await repo.create(orgId, userId, {
      kind: 'note',
      body: 'before',
      contactId,
    });
    const updated = await repo.update(orgId, note.id, { body: 'after' });
    expect(updated?.body).toBe('after');
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(note.updatedAt.getTime());
  });

  it('marking a task done stamps completedAt automatically', async () => {
    const task = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'Close it',
      contactId,
    });
    const done = await repo.update(orgId, task.id, { status: 'done' });
    expect(done?.status).toBe('done');
    expect(done?.completedAt).toBeInstanceOf(Date);
  });

  it('marking a task back to open clears completedAt', async () => {
    const task = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'Reopen me',
      contactId,
    });
    await repo.update(orgId, task.id, { status: 'done' });
    const reopened = await repo.update(orgId, task.id, { status: 'open' });
    expect(reopened?.status).toBe('open');
    expect(reopened?.completedAt).toBeNull();
  });

  it('delete returns true on hit, false on miss', async () => {
    const note = await repo.create(orgId, userId, {
      kind: 'note',
      body: 'temp',
      contactId,
    });
    expect(await repo.delete(orgId, note.id)).toBe(true);
    expect(await repo.delete(orgId, note.id)).toBe(false);
  });

  it('listTasks filters by status (open vs done)', async () => {
    const t1 = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'open-1',
      contactId,
    });
    const t2 = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'done-1',
      contactId,
    });
    await repo.update(orgId, t2.id, { status: 'done' });

    const open = await repo.listTasks(orgId, { status: 'open', due: 'all' });
    const done = await repo.listTasks(orgId, { status: 'done', due: 'all' });
    expect(open.find((t) => t.id === t1.id)).toBeDefined();
    expect(open.find((t) => t.id === t2.id)).toBeUndefined();
    expect(done.find((t) => t.id === t2.id)).toBeDefined();
  });

  it('listTasks filters by due=overdue', async () => {
    const overdueTask = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'overdue',
      contactId,
      dueAt: '2020-01-01',
    });
    const futureTask = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'future',
      contactId,
      dueAt: '2099-01-01',
    });
    const overdue = await repo.listTasks(orgId, { status: 'open', due: 'overdue' });
    expect(overdue.find((t) => t.id === overdueTask.id)).toBeDefined();
    expect(overdue.find((t) => t.id === futureTask.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dealflow/api test activities.repo`

Expected: FAIL — `Cannot find module '.../activities.repo.js'`.

- [ ] **Step 3: Implement the repo**

Create `apps/api/src/modules/activities/activities.repo.ts`:

```typescript
import { and, desc, eq, gt, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type {
  CreateActivityInput,
  ListTasksQuery,
  UpdateActivityInput,
} from '@dealflow/shared';

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
    input: CreateActivityInput,
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dealflow/api test activities.repo`

Expected: All ~10 cases PASS.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm --filter @dealflow/api typecheck`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/activities/activities.repo.ts apps/api/test/modules/activities/activities.repo.test.ts
git commit -m "feat(api): ActivitiesRepo with note + task CRUD"
```

---

### Task 4: Activities CRUD routes + tests

**Files:**
- Create: `apps/api/src/modules/activities/routes.ts`
- Create: `apps/api/test/modules/activities/activities.routes.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/modules/activities/activities.routes.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

interface ActivityBody {
  activity: { id: string; kind: string; body: string; contactId: string | null };
}

async function createContact(
  app: FastifyInstance,
  cookie: string,
  firstName: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    payload: { firstName },
    headers: { cookie },
  });
  if (res.statusCode !== 201) throw new Error(`contact create failed: ${res.body}`);
  return (res.json() as { contact: { id: string } }).contact.id;
}

describe('POST /api/v1/activities', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Alice');
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'x', contactId },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a note on a contact', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'First note', contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as ActivityBody;
    expect(body.activity.kind).toBe('note');
    expect(body.activity.body).toBe('First note');
    expect(body.activity.contactId).toBe(contactId);
  });

  it('400 when no parent is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'x' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 when two parents are provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        kind: 'note',
        body: 'x',
        contactId,
        companyId: '00000000-0000-0000-0000-000000000001',
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 when parent contact does not exist in this org', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        kind: 'note',
        body: 'x',
        contactId: '00000000-0000-0000-0000-000000000001',
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/activities?contactId=:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Bob');

    // Seed three activities (two notes + one task) on the contact
    for (const body of ['n1', 'n2']) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/activities',
        payload: { kind: 'note', body, contactId },
        headers: { cookie },
      });
    }
    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'task', body: 't1', contactId },
      headers: { cookie },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns activities ordered newest first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/activities?contactId=${contactId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { body: string; createdAt: string }[] };
    expect(body.items.length).toBe(3);
    // newest first
    expect(body.items[0]!.body).toBe('t1');
    expect(body.items[2]!.body).toBe('n1');
  });

  it('400 when no parent filter given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activities',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 when two parent filters given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/activities?contactId=${contactId}&dealId=${contactId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/v1/activities/:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;
  let noteId: string;
  let taskId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Carol');

    const noteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'before', contactId },
      headers: { cookie },
    });
    noteId = (noteRes.json() as ActivityBody).activity.id;

    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'task', body: 'do it', contactId },
      headers: { cookie },
    });
    taskId = (taskRes.json() as ActivityBody).activity.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('edits a note body', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${noteId}`,
      payload: { body: 'after' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ActivityBody).activity.body).toBe('after');
  });

  it('marks a task done and stamps completedAt', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${taskId}`,
      payload: { status: 'done' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      activity: { status: string; completedAt: string | null };
    };
    expect(body.activity.status).toBe('done');
    expect(body.activity.completedAt).not.toBeNull();
  });

  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/activities/00000000-0000-0000-0000-000000000001',
      payload: { body: 'x' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 on bad status enum value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${taskId}`,
      payload: { status: 'archived' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/activities/:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Dan');
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('204 on hit, 404 on miss', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'temp', contactId },
      headers: { cookie },
    });
    const id = (create.json() as ActivityBody).activity.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${id}`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dealflow/api test activities.routes`

Expected: FAIL — routes not registered.

- [ ] **Step 3: Implement the routes**

Create `apps/api/src/modules/activities/routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Database, schema as schemaType } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  ERROR_CODES,
  createActivityBodySchema,
  updateActivityBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ActivitiesRepo } from './activities.repo.js';

const idParamSchema = z.object({ id: z.string().uuid() });

const listQuerySchema = z
  .object({
    contactId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
  })
  .refine(
    (v) => (v.contactId ? 1 : 0) + (v.companyId ? 1 : 0) + (v.dealId ? 1 : 0) === 1,
    { message: 'Set exactly one of contactId, companyId, dealId' },
  );

function publicActivity(row: typeof schemaType.activities.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    contactId: row.contactId,
    companyId: row.companyId,
    dealId: row.dealId,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Verify the parent entity (contact/company/deal) lives in this org. Returns
 * `true` if the parent exists in `orgId`, otherwise `false`. Performs a
 * single-row existence query per call.
 */
async function parentExistsInOrg(
  db: Database,
  orgId: string,
  parent: { contactId?: string; companyId?: string; dealId?: string },
): Promise<boolean> {
  if (parent.contactId) {
    const [row] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, orgId),
          eq(schema.contacts.id, parent.contactId),
        ),
      )
      .limit(1);
    return !!row;
  }
  if (parent.companyId) {
    const [row] = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.organizationId, orgId),
          eq(schema.companies.id, parent.companyId),
        ),
      )
      .limit(1);
    return !!row;
  }
  if (parent.dealId) {
    const [row] = await db
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(
        and(eq(schema.deals.organizationId, orgId), eq(schema.deals.id, parent.dealId)),
      )
      .limit(1);
    return !!row;
  }
  return false;
}

export async function registerActivitiesRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const repo = new ActivitiesRepo(deps.db);

  app.post('/api/v1/activities', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createActivityBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid activity payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const ok = await parentExistsInOrg(deps.db, orgId, parsed.data);
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Parent entity not found' } });
    }
    const created = await repo.create(orgId, req.user!.id, parsed.data);
    return reply.status(201).send({ activity: publicActivity(created) });
  });

  app.get('/api/v1/activities', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Provide exactly one of contactId, companyId, dealId',
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const rows = await repo.listForParent(orgId, parsed.data);
    return reply.send({ items: rows.map(publicActivity) });
  });

  app.patch('/api/v1/activities/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const body = updateActivityBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid patch' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const updated = await repo.update(orgId, params.data.id, body.data);
    if (!updated) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Activity not found' } });
    }
    return reply.send({ activity: publicActivity(updated) });
  });

  app.delete('/api/v1/activities/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const ok = await repo.delete(orgId, params.data.id);
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Activity not found' } });
    }
    return reply.status(204).send();
  });
}
```

- [ ] **Step 4: Register routes in server.ts**

Edit `apps/api/src/server.ts`. Inside `if (opts.db)`, after the existing `registerOrganizationsRoutes` line, add:

```typescript
    const { registerActivitiesRoutes } = await import('./modules/activities/routes.js');
    await registerActivitiesRoutes(app, { db: opts.db });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @dealflow/api test activities.routes`

Expected: All ~12 cases PASS.

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @dealflow/api typecheck`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/activities/routes.ts apps/api/test/modules/activities/activities.routes.test.ts apps/api/src/server.ts
git commit -m "feat(api): activities CRUD routes (notes + tasks)"
```

---

### Task 5: GET /api/v1/tasks (task filter endpoint)

**Files:**
- Modify: `apps/api/src/modules/activities/routes.ts`
- Create: `apps/api/test/modules/activities/tasks.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/modules/activities/tasks.routes.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

async function createContact(
  app: FastifyInstance,
  cookie: string,
  firstName: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    payload: { firstName },
    headers: { cookie },
  });
  return (res.json() as { contact: { id: string } }).contact.id;
}

async function createTask(
  app: FastifyInstance,
  cookie: string,
  contactId: string,
  body: string,
  dueAt?: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/activities',
    payload: { kind: 'task', body, contactId, ...(dueAt ? { dueAt } : {}) },
    headers: { cookie },
  });
  return (res.json() as { activity: { id: string } }).activity.id;
}

describe('GET /api/v1/tasks', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;

  let overdueId: string;
  let todayId: string;
  let upcomingId: string;
  let doneId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Erin');

    overdueId = await createTask(app, cookie, contactId, 'overdue', '2020-01-01');
    const today = new Date().toISOString().slice(0, 10);
    todayId = await createTask(app, cookie, contactId, 'today', today);
    upcomingId = await createTask(app, cookie, contactId, 'upcoming', '2099-01-01');
    doneId = await createTask(app, cookie, contactId, 'done', '2099-01-02');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${doneId}`,
      payload: { status: 'done' },
      headers: { cookie },
    });

    // Notes should NOT appear in /tasks
    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'a note', contactId },
      headers: { cookie },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('defaults to status=open (excludes notes and done tasks)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { id: string; kind: string }[] }).items;
    expect(items.every((i) => i.kind === 'task')).toBe(true);
    const ids = items.map((i) => i.id);
    expect(ids).toContain(overdueId);
    expect(ids).toContain(todayId);
    expect(ids).toContain(upcomingId);
    expect(ids).not.toContain(doneId);
  });

  it('status=done returns only completed tasks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?status=done',
      headers: { cookie },
    });
    const items = (res.json() as { items: { id: string }[] }).items;
    const ids = items.map((i) => i.id);
    expect(ids).toContain(doneId);
    expect(ids).not.toContain(overdueId);
  });

  it('due=overdue returns only past-due open tasks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?due=overdue',
      headers: { cookie },
    });
    const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toContain(overdueId);
    expect(ids).not.toContain(upcomingId);
    expect(ids).not.toContain(todayId);
  });

  it('due=today returns only tasks due today', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?due=today',
      headers: { cookie },
    });
    const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toContain(todayId);
    expect(ids).not.toContain(overdueId);
    expect(ids).not.toContain(upcomingId);
  });

  it('400 on unknown filter values', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?due=junk',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dealflow/api test tasks.routes`

Expected: FAIL — `/api/v1/tasks` returns 404.

- [ ] **Step 3: Add the route handler**

Edit `apps/api/src/modules/activities/routes.ts`. Add the import near the top:

```typescript
import {
  ERROR_CODES,
  createActivityBodySchema,
  listTasksQuerySchema,
  updateActivityBodySchema,
} from '@dealflow/shared';
```

Then inside `registerActivitiesRoutes`, after the existing routes, add:

```typescript
  app.get('/api/v1/tasks', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = listTasksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid task filter',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const rows = await repo.listTasks(orgId, parsed.data);
    return reply.send({ items: rows.map(publicActivity) });
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dealflow/api test tasks.routes`

Expected: All 5 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/activities/routes.ts apps/api/test/modules/activities/tasks.routes.test.ts
git commit -m "feat(api): GET /api/v1/tasks with status + due filters"
```

---

### Task 6: Tenancy test for activities

**Files:**
- Create: `apps/api/test/modules/activities/activities.tenancy.test.ts`

- [ ] **Step 1: Write the test (passes immediately if the repo is org-scoped, which Task 3 ensured)**

Create `apps/api/test/modules/activities/activities.tenancy.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Activities tenancy', () => {
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

  it('Org B cannot read Org A activities', async () => {
    const a = await signupTestUser(app, { orgName: 'OrgA' });
    const b = await signupTestUser(app, { orgName: 'OrgB' });

    // Org A creates a contact + a note on that contact
    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Alice' },
      headers: { cookie: a.cookie },
    });
    const contactId = (contactRes.json() as { contact: { id: string } }).contact.id;

    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'private', contactId },
      headers: { cookie: a.cookie },
    });

    // Org B tries to list activities for Org A's contact id → 0 items
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/activities?contactId=${contactId}`,
      headers: { cookie: b.cookie },
    });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as { items: unknown[] }).items.length).toBe(0);
  });

  it('Org B cannot PATCH or DELETE Org A activity', async () => {
    const a = await signupTestUser(app, { orgName: 'OrgC' });
    const b = await signupTestUser(app, { orgName: 'OrgD' });

    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Bob' },
      headers: { cookie: a.cookie },
    });
    const contactId = (contactRes.json() as { contact: { id: string } }).contact.id;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'task', body: 'private task', contactId },
      headers: { cookie: a.cookie },
    });
    const activityId = (createRes.json() as { activity: { id: string } }).activity.id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${activityId}`,
      payload: { body: 'edited by B' },
      headers: { cookie: b.cookie },
    });
    expect(patchRes.statusCode).toBe(404);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${activityId}`,
      headers: { cookie: b.cookie },
    });
    expect(delRes.statusCode).toBe(404);
  });

  it('Org B GET /api/v1/tasks does not see Org A tasks', async () => {
    const a = await signupTestUser(app, { orgName: 'OrgE' });
    const b = await signupTestUser(app, { orgName: 'OrgF' });

    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Carl' },
      headers: { cookie: a.cookie },
    });
    const contactId = (contactRes.json() as { contact: { id: string } }).contact.id;

    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'task', body: 'A only', contactId },
      headers: { cookie: a.cookie },
    });

    const bRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { cookie: b.cookie },
    });
    expect((bRes.json() as { items: { body: string }[] }).items.find((i) => i.body === 'A only')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @dealflow/api test activities.tenancy`

Expected: All 3 cases PASS (the repo already filters by orgId in every query).

- [ ] **Step 3: Run the full API suite to catch any regression**

Run: `pnpm --filter @dealflow/api test`

Expected: All passing (~157 tests now: 142 baseline + ~15 new from Tasks 2–6).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/modules/activities/activities.tenancy.test.ts
git commit -m "test(api): activities cross-tenant isolation"
```

---

### Task 7: Web query keys + activities API hooks

**Files:**
- Modify: `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/features/activities/api.ts`

- [ ] **Step 1: Add activities + tasks keys**

Edit `apps/web/src/lib/query-keys.ts`. Append entries to the `queryKeys` object:

```typescript
export const queryKeys = {
  me: ['auth', 'me'] as const,
  organization: ['organization', 'current'] as const,
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
  pipelines: {
    all: ['pipelines'] as const,
  },
  deals: {
    all: ['deals'] as const,
    list: (pipelineId?: string, status?: string) =>
      ['deals', 'list', { pipelineId: pipelineId ?? '', status: status ?? '' }] as const,
    detail: (id: string) => ['deals', 'detail', id] as const,
  },
  activities: {
    forContact: (id: string) => ['activities', 'contact', id] as const,
    forCompany: (id: string) => ['activities', 'company', id] as const,
    forDeal: (id: string) => ['activities', 'deal', id] as const,
  },
  tasks: {
    list: (status: string, due: string) => ['tasks', 'list', { status, due }] as const,
  },
};
```

- [ ] **Step 2: Build the hooks**

Create `apps/web/src/features/activities/api.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateActivityInput,
  ListTasksQuery,
  PublicActivity,
  UpdateActivityInput,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

interface ActivitiesListResponse {
  items: PublicActivity[];
}

interface ActivityResponse {
  activity: PublicActivity;
}

type ParentFilter =
  | { contactId: string }
  | { companyId: string }
  | { dealId: string };

function parentQueryString(p: ParentFilter): string {
  if ('contactId' in p) return `contactId=${p.contactId}`;
  if ('companyId' in p) return `companyId=${p.companyId}`;
  return `dealId=${p.dealId}`;
}

function parentQueryKey(p: ParentFilter) {
  if ('contactId' in p) return queryKeys.activities.forContact(p.contactId);
  if ('companyId' in p) return queryKeys.activities.forCompany(p.companyId);
  return queryKeys.activities.forDeal(p.dealId);
}

export function useActivitiesFor(parent: ParentFilter) {
  return useQuery({
    queryKey: parentQueryKey(parent),
    queryFn: () =>
      apiFetch<ActivitiesListResponse>(`/api/v1/activities?${parentQueryString(parent)}`),
  });
}

export function useCreateActivity(parent: ParentFilter) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) =>
      apiFetch<ActivityResponse>('/api/v1/activities', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: parentQueryKey(parent) });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateActivity(parent: ParentFilter) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateActivityInput }) =>
      apiFetch<ActivityResponse>(`/api/v1/activities/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: parentQueryKey(parent) });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteActivity(parent: ParentFilter) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/activities/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: parentQueryKey(parent) });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/** Used by the global /app/tasks page. */
export function useTasks(query: ListTasksQuery) {
  return useQuery({
    queryKey: queryKeys.tasks.list(query.status, query.due),
    queryFn: () =>
      apiFetch<ActivitiesListResponse>(
        `/api/v1/tasks?status=${query.status}&due=${query.due}`,
      ),
  });
}

/**
 * Mutations for the /app/tasks page where parent context isn't available.
 * Invalidates the tasks key (any filter) plus all activities keys so feeds
 * on entity detail pages stay fresh.
 */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateActivityInput }) =>
      apiFetch<ActivityResponse>(`/api/v1/activities/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/query-keys.ts apps/web/src/features/activities/api.ts
git commit -m "feat(web): activities + tasks query hooks"
```

---

### Task 8: AddNoteForm + AddTaskForm components

**Files:**
- Create: `apps/web/src/features/activities/add-note-form.tsx`
- Create: `apps/web/src/features/activities/add-task-form.tsx`

- [ ] **Step 1: Build AddNoteForm**

Create `apps/web/src/features/activities/add-note-form.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCreateActivity } from './api';

type ParentFilter =
  | { contactId: string }
  | { companyId: string }
  | { dealId: string };

interface AddNoteFormProps {
  parent: ParentFilter;
}

export function AddNoteForm({ parent }: AddNoteFormProps) {
  const [body, setBody] = useState('');
  const create = useCreateActivity(parent);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    await create.mutateAsync({ kind: 'note', body: trimmed, ...parent });
    setBody('');
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note…"
        rows={3}
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
        data-testid="add-note-textarea"
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" size="sm" disabled={!body.trim() || create.isPending}>
          {create.isPending ? 'Adding…' : 'Add note'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Build AddTaskForm**

Create `apps/web/src/features/activities/add-task-form.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateActivity } from './api';

type ParentFilter =
  | { contactId: string }
  | { companyId: string }
  | { dealId: string };

interface AddTaskFormProps {
  parent: ParentFilter;
}

export function AddTaskForm({ parent }: AddTaskFormProps) {
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const create = useCreateActivity(parent);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    await create.mutateAsync({
      kind: 'task',
      body: trimmed,
      ...(dueAt ? { dueAt } : {}),
      ...parent,
    });
    setBody('');
    setDueAt('');
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What needs doing?"
        data-testid="add-task-input"
      />
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="max-w-[160px]"
          data-testid="add-task-due"
        />
        <Button type="submit" size="sm" disabled={!body.trim() || create.isPending}>
          {create.isPending ? 'Adding…' : 'Add task'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/activities/add-note-form.tsx apps/web/src/features/activities/add-task-form.tsx
git commit -m "feat(web): AddNoteForm and AddTaskForm composers"
```

---

### Task 9: TaskItem component

**Files:**
- Create: `apps/web/src/features/activities/task-item.tsx`

- [ ] **Step 1: Build TaskItem**

Create `apps/web/src/features/activities/task-item.tsx`:

```typescript
import type { PublicActivity, UpdateActivityInput } from '@dealflow/shared';

interface TaskItemProps {
  task: PublicActivity;
  onToggleDone: (id: string, patch: UpdateActivityInput) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
  /** Optional context label rendered after the body (e.g. contact name). */
  contextLabel?: React.ReactNode;
}

/**
 * A single task row. Used inside the activity feed (per entity) and on the
 * `/app/tasks` page. The checkbox toggles status='done'/'open'; the row also
 * highlights overdue tasks in red.
 */
export function TaskItem({ task, onToggleDone, onDelete, contextLabel }: TaskItemProps) {
  const done = task.status === 'done';
  const overdue =
    !done && task.dueAt !== null && new Date(task.dueAt).getTime() < startOfToday();

  return (
    <div className="flex items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={done}
        onChange={async (e) => {
          await onToggleDone(task.id, { status: e.target.checked ? 'done' : 'open' });
        }}
        className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-300"
        data-testid={`task-checkbox-${task.id}`}
      />
      <div className="min-w-0 flex-1">
        <p
          className={
            done ? 'text-sm text-neutral-400 line-through' : 'text-sm text-neutral-900'
          }
        >
          {task.body}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
          {task.dueAt && (
            <span className={overdue ? 'text-red-600' : ''}>
              Due {formatDate(task.dueAt)}
            </span>
          )}
          {contextLabel && <span>· {contextLabel}</span>}
        </div>
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={() => void onDelete(task.id)}
          className="text-xs text-neutral-400 hover:text-red-600"
          aria-label="Delete task"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/activities/task-item.tsx
git commit -m "feat(web): TaskItem row component"
```

---

### Task 10: ActivityFeed component

**Files:**
- Create: `apps/web/src/features/activities/activity-feed.tsx`

- [ ] **Step 1: Build ActivityFeed**

Create `apps/web/src/features/activities/activity-feed.tsx`:

```typescript
import { useState } from 'react';
import type { PublicActivity } from '@dealflow/shared';
import { Button } from '@/components/ui/button';
import {
  useActivitiesFor,
  useDeleteActivity,
  useUpdateActivity,
} from './api';
import { AddNoteForm } from './add-note-form';
import { AddTaskForm } from './add-task-form';
import { TaskItem } from './task-item';

type ParentFilter =
  | { contactId: string }
  | { companyId: string }
  | { dealId: string };

interface ActivityFeedProps {
  parent: ParentFilter;
}

type Composer = 'none' | 'note' | 'task';

export function ActivityFeed({ parent }: ActivityFeedProps) {
  const list = useActivitiesFor(parent);
  const update = useUpdateActivity(parent);
  const del = useDeleteActivity(parent);
  const [composer, setComposer] = useState<Composer>('none');

  return (
    <section className="mt-8" data-testid="activity-feed">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium">Activity</h2>
        <div className="flex items-center gap-2">
          <Button
            variant={composer === 'note' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setComposer(composer === 'note' ? 'none' : 'note')}
          >
            Note
          </Button>
          <Button
            variant={composer === 'task' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setComposer(composer === 'task' ? 'none' : 'task')}
          >
            Task
          </Button>
        </div>
      </div>

      {composer === 'note' && (
        <div className="mb-4 rounded-md border border-neutral-200 p-3">
          <AddNoteForm parent={parent} />
        </div>
      )}
      {composer === 'task' && (
        <div className="mb-4 rounded-md border border-neutral-200 p-3">
          <AddTaskForm parent={parent} />
        </div>
      )}

      {list.isPending && <p className="text-sm text-neutral-500">Loading activity…</p>}
      {list.error && <p className="text-sm text-red-600">Couldn't load activity.</p>}
      {list.data?.items.length === 0 && !list.isPending && (
        <p className="text-sm italic text-neutral-400">No activity yet.</p>
      )}

      <ul className="divide-y divide-neutral-200">
        {list.data?.items.map((a) => (
          <li key={a.id} className="py-3">
            <ActivityRow
              activity={a}
              onToggleDone={(id, patch) => update.mutateAsync({ id, patch })}
              onDelete={(id) => del.mutateAsync(id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ActivityRowProps {
  activity: PublicActivity;
  onToggleDone: (id: string, patch: { status: 'open' | 'done' }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

function ActivityRow({ activity, onToggleDone, onDelete }: ActivityRowProps) {
  if (activity.kind === 'task') {
    return (
      <TaskItem
        task={activity}
        onToggleDone={(id, patch) =>
          onToggleDone(id, patch as { status: 'open' | 'done' })
        }
        onDelete={onDelete}
      />
    );
  }
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm text-neutral-800">{activity.body}</p>
        <p className="mt-1 text-xs text-neutral-500">
          Note · {new Date(activity.createdAt).toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void onDelete(activity.id)}
        className="text-xs text-neutral-400 hover:text-red-600"
        aria-label="Delete note"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/activities/activity-feed.tsx
git commit -m "feat(web): ActivityFeed timeline component"
```

---

### Task 11: Embed ActivityFeed on contact/company/deal detail pages

**Files:**
- Modify: `apps/web/src/routes/app.contacts.$id.tsx`
- Modify: `apps/web/src/routes/app.companies.$id.tsx`
- Modify: `apps/web/src/routes/app.deals.$id.tsx`

- [ ] **Step 1: Add the feed to the contact detail page**

Edit `apps/web/src/routes/app.contacts.$id.tsx`. Add the import near the top:

```typescript
import { ActivityFeed } from '@/features/activities/activity-feed';
```

Then inside `ContactDetailPage`, just before the closing `</main>`, add:

```tsx
      <ActivityFeed parent={{ contactId: c.id }} />
```

- [ ] **Step 2: Add the feed to the company detail page**

Edit `apps/web/src/routes/app.companies.$id.tsx`. Add the import:

```typescript
import { ActivityFeed } from '@/features/activities/activity-feed';
```

Inside `CompanyDetailPage`, just before the closing `</main>`, add:

```tsx
      <ActivityFeed parent={{ companyId: c.id }} />
```

(Variable name may be `c` or `company` — match whatever the existing file uses.)

- [ ] **Step 3: Add the feed to the deal detail page**

Edit `apps/web/src/routes/app.deals.$id.tsx`. Add the import:

```typescript
import { ActivityFeed } from '@/features/activities/activity-feed';
```

Inside `DealDetailPage`, just before the closing `</main>`, add:

```tsx
      <ActivityFeed parent={{ dealId: d.id }} />
```

- [ ] **Step 4: Verify typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck` (then `pnpm --filter @dealflow/web build`)

Expected: No errors. Build succeeds.

- [ ] **Step 5: Manual smoke test**

Start dev servers (`pnpm dev`), log in, open a contact, company, and deal in turn. Each should render:
- An "Activity" heading at the bottom
- Two buttons: Note and Task
- An empty-state message "No activity yet."

Click "Note", type something, submit → it should appear in the feed. Click "Task", type + pick a date, submit → it should appear with a checkbox and the due date.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/app.contacts.$id.tsx apps/web/src/routes/app.companies.$id.tsx apps/web/src/routes/app.deals.$id.tsx
git commit -m "feat(web): embed ActivityFeed on contact/company/deal detail pages"
```

---

### Task 12: /app/tasks page + sidebar link

**Files:**
- Create: `apps/web/src/routes/app.tasks.tsx`
- Modify: `apps/web/src/routes/app.tsx`

- [ ] **Step 1: Build the Tasks page**

Create `apps/web/src/routes/app.tasks.tsx`:

```typescript
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import type { ListTasksQuery, TaskStatus } from '@dealflow/shared';
import { useTasks, useUpdateTask } from '@/features/activities/api';
import { TaskItem } from '@/features/activities/task-item';

export const Route = createFileRoute('/app/tasks')({
  component: TasksPage,
});

type DueFilter = ListTasksQuery['due'];

const STATUS_TABS: { key: TaskStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
];

const DUE_FILTERS: { key: DueFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
];

function TasksPage() {
  const [status, setStatus] = useState<TaskStatus>('open');
  const [due, setDue] = useState<DueFilter>('all');
  const tasks = useTasks({ status, due });
  const update = useUpdateTask();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Tasks</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Open follow-ups across all your contacts, companies, and deals.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-4 border-b border-neutral-200 pb-3">
        <div className="flex gap-1" role="tablist" aria-label="Task status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => setStatus(t.key)}
              className={
                status === t.key
                  ? 'rounded px-3 py-1 text-sm font-medium bg-neutral-100 text-neutral-900'
                  : 'rounded px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Due filter">
          {DUE_FILTERS.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={due === d.key}
              onClick={() => setDue(d.key)}
              className={
                due === d.key
                  ? 'rounded px-3 py-1 text-sm font-medium bg-neutral-100 text-neutral-900'
                  : 'rounded px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50'
              }
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {tasks.isPending && <p className="text-sm text-neutral-500">Loading…</p>}
      {tasks.error && <p className="text-sm text-red-600">Couldn't load tasks.</p>}
      {tasks.data?.items.length === 0 && !tasks.isPending && (
        <p className="text-sm italic text-neutral-400">No tasks match this filter.</p>
      )}

      <ul className="divide-y divide-neutral-200">
        {tasks.data?.items.map((task) => (
          <li key={task.id}>
            <TaskItem
              task={task}
              onToggleDone={(id, patch) => update.mutateAsync({ id, patch })}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Add Tasks link to the sidebar**

Edit `apps/web/src/routes/app.tsx`. The current sidebar has 4 Links (Contacts, Companies, Deals, Settings). Insert a Tasks Link between Deals and Settings:

```tsx
          <Link
            to="/app/tasks"
            className="rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
            activeProps={{
              className: 'rounded px-2 py-1.5 bg-neutral-100 font-medium text-neutral-900',
            }}
          >
            Tasks
          </Link>
```

- [ ] **Step 3: Regenerate route tree + typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

Expected: The route tree picks up `/app/tasks` automatically (or `tsr generate` runs and the test passes). No errors.

- [ ] **Step 4: Build**

Run: `pnpm --filter @dealflow/web build`

Expected: Success.

- [ ] **Step 5: Manual smoke test**

Visit `/app/tasks`. Should show:
- "Tasks" heading + subtitle
- Two tab rows: status (Open / Done) and due (All / Overdue / Today / Upcoming)
- A list of tasks (empty until you create one via a contact/company/deal detail page)

Create a task on a contact, then return to /app/tasks — it should appear. Toggle the checkbox → it moves to the Done tab.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/app.tasks.tsx apps/web/src/routes/app.tsx
```

If `routeTree.gen.ts` was regenerated, also add it:

```bash
git add apps/web/src/routeTree.gen.ts
```

```bash
git commit -m "feat(web): /app/tasks page + sidebar link"
```

---

### Task 13: E2E smoke + full validation + tag

**Files:**
- Create: `apps/web/e2e/activities.spec.ts`

- [ ] **Step 1: Write the E2E spec**

Create `apps/web/e2e/activities.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('add a note and a task to a new contact, then complete the task on /app/tasks', async ({
  page,
}) => {
  const email = `e2e.activities.${Date.now()}@example.com`;
  const password = 'CorrectHorseBatteryStaple1';

  // Sign up a fresh user (also creates the org).
  await page.goto('/signup');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByLabel(/your name/i).fill('E2E User');
  await page.getByLabel(/company name/i).fill(`E2E Co ${Date.now()}`);
  await page.getByRole('button', { name: /sign up/i }).click();

  // Create a contact.
  await page.goto('/app/contacts');
  await page.getByRole('button', { name: /new contact/i }).click();
  await page.getByLabel(/first name/i).fill('E2E Contact');
  await page.getByRole('button', { name: /create/i }).click();
  await page.getByRole('link', { name: /E2E Contact/i }).click();

  // Wait for the feed to render its empty state.
  await expect(page.getByTestId('activity-feed')).toBeVisible();
  await expect(page.getByText(/no activity yet/i)).toBeVisible();

  // Add a note.
  await page.getByRole('button', { name: /^note$/i }).click();
  await page.getByTestId('add-note-textarea').fill('Met at conference');
  await page.getByRole('button', { name: /^add note$/i }).click();
  await expect(page.getByText('Met at conference')).toBeVisible();

  // Add a task with a far-future due date.
  await page.getByRole('button', { name: /^task$/i }).click();
  await page.getByTestId('add-task-input').fill('Send proposal');
  await page.getByTestId('add-task-due').fill('2099-12-31');
  await page.getByRole('button', { name: /^add task$/i }).click();
  await expect(page.getByText('Send proposal')).toBeVisible();

  // Visit /app/tasks and complete the task.
  await page.goto('/app/tasks');
  await expect(page.getByText('Send proposal')).toBeVisible();
  await page.getByRole('checkbox').first().check();

  // After completing, switch to the Done tab — the task should be there.
  await page.getByRole('tab', { name: /^done$/i }).click();
  await expect(page.getByText('Send proposal')).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E**

Run: `pnpm --filter @dealflow/web e2e -- activities`

(Or whichever invocation the existing e2e config uses; if just `pnpm e2e`, that's fine.)

Expected: 1 test passes (allow a few seconds for the dev server to spin up).

If the run fails because of dialog/button label mismatches, read the actual error and adjust the selectors to match the existing UI. Do not change UI to fit the test — change the test to fit the UI.

- [ ] **Step 3: Format**

Run: `pnpm format`

Expected: Clean (or formats a few files; if so, stage and include in the next commit, or as a `style: format` commit).

- [ ] **Step 4: Lint**

Run: `pnpm lint`

Expected: Zero errors, zero warnings.

- [ ] **Step 5: Typecheck (all workspaces)**

Run: `pnpm typecheck`

Expected: All clean.

- [ ] **Step 6: Full test suite**

Run: `pnpm test`

Expected: 142 baseline + ~30 new unit/integration tests = ~172 total, all passing.

- [ ] **Step 7: Push**

```bash
git push origin main
```

- [ ] **Step 8: Tag**

```bash
git tag -a sub-plan-5-activities -m "Sub-Plan 5: Activities (notes + tasks) — feed on contact/company/deal detail, /app/tasks page"
git push origin sub-plan-5-activities
```

- [ ] **Step 9: Commit the E2E spec**

```bash
git add apps/web/e2e/activities.spec.ts
git commit -m "test(e2e): activity feed + tasks page smoke"
git push origin main
```

(The order of commit-then-tag-then-push-then-commit-E2E is intentional: only tag once the validation suite is green, and the E2E spec lands as its own commit for traceability.)

---

## Self-Review (executed by plan author)

**Spec coverage:**
- "Activities feature with notes + tasks" → Tasks 1–10 ✓
- "Activity feed on every contact/company/deal" → Task 11 ✓
- "/app/tasks page for managing tasks" → Task 12 ✓
- Tenancy isolation → Task 6 ✓
- E2E smoke → Task 13 ✓

**Placeholder scan:** No "TBD", no "handle edge cases", no "similar to Task N". Every code block is complete and copy-paste-ready.

**Type consistency:**
- `ActivityKind = 'note' | 'task'` is defined once in `@dealflow/shared` and `@dealflow/db/schema/activities.ts` — both files agree.
- `TaskStatus = 'open' | 'done'` likewise.
- `PublicActivity` shape (id, kind, body, status, dueAt, completedAt, contactId, companyId, dealId, ownerUserId, createdAt, updatedAt) is identical between the API response (`publicActivity` mapper in routes) and the web consumer.
- `parent: { contactId } | { companyId } | { dealId }` discriminated union is used identically in `useActivitiesFor`, `useCreateActivity`, `useUpdateActivity`, `useDeleteActivity`, `AddNoteForm`, `AddTaskForm`, `ActivityFeed`.
- `useUpdateActivity` and `useUpdateTask` both PATCH to `/api/v1/activities/:id` with `UpdateActivityInput` — same wire format, different cache-invalidation strategies (per-parent vs. global).
- Query keys: `activities.forContact(id)`, `activities.forCompany(id)`, `activities.forDeal(id)`, `tasks.list(status, due)` are all defined in `query-keys.ts` and referenced via `queryKeys.*` in hooks.

**Known follow-ups (deliberately out of scope):**
1. Separate `assignee_user_id` from `owner_user_id` (per-task assignment).
2. Calls / meetings / email activities (Sub-Plan 2b + future).
3. Reminders / notifications.
4. Task badge in sidebar showing overdue count.
5. Activity pinning / sorting beyond newest-first.
6. Validate `currency` against catalog on deals (carry-over follow-up from previous sub-plan).
