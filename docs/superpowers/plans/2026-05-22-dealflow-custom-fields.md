# Custom Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users define arbitrary structured fields (10 types — text, long_text, number, date, boolean, select, multi_select, url, email, phone) on contacts, companies, deals, notes, and tasks; edit + view those fields on detail pages and create-dialogs; and add a new `/app/activities/$id` detail page that hosts the custom-fields surface for individual notes and tasks.

**Architecture:** Hybrid storage — one `custom_field_definitions` table (org-scoped, per entity type) holds the metadata; each parent entity table (contacts, companies, deals, activities) gets a `custom_fields jsonb` column storing `{ <field-uuid>: <value> }`. A shared helper `validateAndMergeCustomFields()` validates inbound writes against the active definitions before merging. Notes and tasks share the `activities` JSONB column but have separate definition sets (`entity_type: 'note' | 'task'`) — the helper picks the right set based on the activity's `kind`.

**Tech Stack:** Drizzle ORM (Postgres), Fastify 5, Zod, vitest + per-test disposable Postgres for backend; React 19 + TanStack Router (file-based routes) + TanStack Query + Tailwind v4 + `@dnd-kit/sortable` (already in `apps/web`) for frontend.

**Source spec:** `docs/superpowers/specs/2026-05-22-custom-fields-design.md` — read before starting if you need design rationale.

---

## File Structure

**Shared (`packages/shared`):**
- Create: `src/custom-fields.ts` — `CustomFieldType`, `CustomFieldDefinition`, `customFieldValueSchema(definition)`, request/response schemas.
- Create: `src/custom-fields.test.ts`
- Modify: `src/index.ts` — re-export.

**DB (`packages/db`):**
- Create: `src/schema/custom-field-definitions.ts` — Drizzle table.
- Modify: `src/schema/contacts.ts`, `companies.ts`, `deals.ts`, `activities.ts` — add `custom_fields` jsonb column.
- Modify: `src/schema/index.ts` — re-export new table.
- Generated: a new migration SQL file under `drizzle/` once `pnpm --filter @dealflow/db generate` runs.

**API (`apps/api`):**
- Create: `src/lib/custom-fields-merge.ts` — `validateAndMergeCustomFields()` helper.
- Create: `test/lib/custom-fields-merge.test.ts`
- Create: `src/modules/custom-fields/repo.ts` — `CustomFieldsRepo` (CRUD on definitions, org-scoped).
- Create: `src/modules/custom-fields/routes.ts` — REST endpoints.
- Create: `test/modules/custom-fields/routes.test.ts`
- Modify: `src/server.ts` — register new routes.
- Modify: `src/modules/contacts/routes.ts` + `test/modules/contacts/routes.test.ts` — accept/return `customFields`.
- Modify: `src/modules/companies/routes.ts` + `test/modules/companies/routes.test.ts` — same.
- Modify: `src/modules/deals/routes.ts` + `test/modules/deals/routes.test.ts` — same.
- Modify: `src/modules/activities/routes.ts` + `test/modules/activities/activities.routes.test.ts` — same + add `GET /api/v1/activities/:id`.

**Web (`apps/web`):**
- Modify: `src/lib/query-keys.ts` — add `customFields.list(entity)` and `activities.detail(id)` keys.
- Create: `src/features/custom-fields/api.ts` — `useCustomFields`, `useCreateCustomField`, `useUpdateCustomField`, `useDeleteCustomField`.
- Create: `src/features/custom-fields/custom-field-editor.tsx` — create/edit dialog.
- Create: `src/features/custom-fields/custom-fields-block.tsx` — read + inline-edit per-entity block.
- Create: `src/features/custom-fields/custom-fields-settings.tsx` — page body (5 tabs + sortable list).
- Create: `src/routes/app.settings.custom-fields.tsx` — TanStack Router file route.
- Create: `src/routes/app.activities.$id.tsx` — activity detail page.
- Modify: `src/features/activities/api.ts` — add `useActivity(id)`.
- Modify: `src/routes/app.settings.tsx` — link to Custom Fields page.
- Modify: `src/routes/app.contacts.$id.tsx`, `app.companies.$id.tsx`, `app.deals.$id.tsx` — embed `<CustomFieldsBlock>`.
- Modify: `src/features/contacts/create-contact-dialog.tsx`, `create-company-dialog.tsx` (in `companies/`), `create-deal-dialog.tsx` (in `deals/`) — embed block.
- Modify: `src/features/activities/add-note-form.tsx`, `add-task-form.tsx` — embed block.
- Modify: `src/features/activities/activity-feed.tsx` — add link icon per row → `/app/activities/$id`.
- Modify: `src/routes/app.tasks.tsx` — make task title click navigate to detail.

---

## Task 1: Shared schemas + value validators

**Files:**
- Create: `packages/shared/src/custom-fields.ts`
- Create: `packages/shared/src/custom-fields.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/custom-fields.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  customFieldDefinitionSchema,
  customFieldEntityTypeSchema,
  customFieldTypeSchema,
  validateCustomFieldValue,
} from './custom-fields.js';

describe('customFieldEntityTypeSchema', () => {
  it.each(['contact', 'company', 'deal', 'note', 'task'])('accepts %s', (v) => {
    expect(() => customFieldEntityTypeSchema.parse(v)).not.toThrow();
  });
  it('rejects activity (split into note/task)', () => {
    expect(() => customFieldEntityTypeSchema.parse('activity')).toThrow();
  });
});

describe('customFieldTypeSchema', () => {
  const TYPES = ['text','long_text','number','date','boolean','select','multi_select','url','email','phone'];
  it.each(TYPES)('accepts %s', (t) => {
    expect(() => customFieldTypeSchema.parse(t)).not.toThrow();
  });
  it('rejects unknown type', () => {
    expect(() => customFieldTypeSchema.parse('file')).toThrow();
  });
});

describe('customFieldDefinitionSchema', () => {
  const base = {
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: '22222222-2222-2222-2222-222222222222',
    entityType: 'contact' as const,
    name: 'Lead Source',
    type: 'select' as const,
    options: { values: [{ key: 'referral', label: 'Referral' }] },
    required: false,
    position: 0,
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
  };
  it('accepts a select with options', () => {
    expect(() => customFieldDefinitionSchema.parse(base)).not.toThrow();
  });
  it('accepts text with no options', () => {
    expect(() =>
      customFieldDefinitionSchema.parse({ ...base, type: 'text', options: null }),
    ).not.toThrow();
  });
});

describe('validateCustomFieldValue', () => {
  const textDef = { type: 'text', options: null } as const;
  it('accepts a short string for text', () => {
    expect(validateCustomFieldValue(textDef, 'hello').ok).toBe(true);
  });
  it('rejects text > 500 chars', () => {
    const long = 'x'.repeat(501);
    expect(validateCustomFieldValue(textDef, long).ok).toBe(false);
  });
  it('rejects wrong type (number when text expected)', () => {
    expect(validateCustomFieldValue(textDef, 42).ok).toBe(false);
  });

  it('accepts a finite number', () => {
    expect(validateCustomFieldValue({ type: 'number', options: null }, 42.5).ok).toBe(true);
  });
  it('rejects NaN / Infinity for number', () => {
    expect(validateCustomFieldValue({ type: 'number', options: null }, NaN).ok).toBe(false);
    expect(validateCustomFieldValue({ type: 'number', options: null }, Infinity).ok).toBe(false);
  });

  it('accepts YYYY-MM-DD for date', () => {
    expect(validateCustomFieldValue({ type: 'date', options: null }, '2026-05-22').ok).toBe(true);
  });
  it('rejects bad date format', () => {
    expect(validateCustomFieldValue({ type: 'date', options: null }, '22-05-2026').ok).toBe(false);
  });

  it('accepts a valid option key for select', () => {
    const def = { type: 'select', options: { values: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] } } as const;
    expect(validateCustomFieldValue(def, 'a').ok).toBe(true);
  });
  it('rejects unknown option key for select', () => {
    const def = { type: 'select', options: { values: [{ key: 'a', label: 'A' }] } } as const;
    expect(validateCustomFieldValue(def, 'c').ok).toBe(false);
  });

  it('accepts array of valid option keys for multi_select', () => {
    const def = { type: 'multi_select', options: { values: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] } } as const;
    expect(validateCustomFieldValue(def, ['a', 'b']).ok).toBe(true);
  });
  it('rejects multi_select with unknown key', () => {
    const def = { type: 'multi_select', options: { values: [{ key: 'a', label: 'A' }] } } as const;
    expect(validateCustomFieldValue(def, ['a', 'z']).ok).toBe(false);
  });

  it('accepts email format', () => {
    expect(validateCustomFieldValue({ type: 'email', options: null }, 'a@b.com').ok).toBe(true);
  });
  it('rejects bad email', () => {
    expect(validateCustomFieldValue({ type: 'email', options: null }, 'a@b,com').ok).toBe(false);
  });

  it('null is always accepted (cleared field)', () => {
    expect(validateCustomFieldValue(textDef, null).ok).toBe(true);
    expect(validateCustomFieldValue({ type: 'number', options: null }, null).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter @dealflow/shared test -- custom-fields`
Expected: FAIL — Cannot find module './custom-fields.js'.

- [ ] **Step 3: Implement the schemas + validator**

Create `packages/shared/src/custom-fields.ts`:

```typescript
import { z } from 'zod';

export const CUSTOM_FIELD_ENTITY_TYPES = ['contact', 'company', 'deal', 'note', 'task'] as const;
export const customFieldEntityTypeSchema = z.enum(CUSTOM_FIELD_ENTITY_TYPES);
export type CustomFieldEntityType = z.infer<typeof customFieldEntityTypeSchema>;

export const CUSTOM_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  'url',
  'email',
  'phone',
] as const;
export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const customFieldOptionSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
});
export const customFieldOptionsSchema = z.object({
  values: z.array(customFieldOptionSchema).min(1),
});

export const customFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entityType: customFieldEntityTypeSchema,
  name: z.string().min(1).max(50),
  type: customFieldTypeSchema,
  options: customFieldOptionsSchema.nullable(),
  required: z.boolean(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export const createCustomFieldBodySchema = z.object({
  entityType: customFieldEntityTypeSchema,
  name: z.string().min(1).max(50),
  type: customFieldTypeSchema,
  options: customFieldOptionsSchema.nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldBodySchema>;

export const updateCustomFieldBodySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  options: customFieldOptionsSchema.nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldBodySchema>;

const URL_RE = /^https?:\/\/[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.,]{2,}$/;
const PHONE_RE = /^[+0-9 ()\-.]{6,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Per-type value validator. Returns `{ ok: true }` or `{ ok: false, error }`.
 * `null` is always accepted (represents "clear field"). Used both server-side
 * (in custom-fields-merge.ts) and client-side (inline form feedback).
 */
export function validateCustomFieldValue(
  def: Pick<CustomFieldDefinition, 'type' | 'options'>,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true };

  switch (def.type) {
    case 'text':
      if (typeof value !== 'string') return { ok: false, error: 'expected string' };
      if (value.length > 500) return { ok: false, error: 'max 500 characters' };
      return { ok: true };
    case 'long_text':
      if (typeof value !== 'string') return { ok: false, error: 'expected string' };
      if (value.length > 5000) return { ok: false, error: 'max 5000 characters' };
      return { ok: true };
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value))
        return { ok: false, error: 'expected finite number' };
      return { ok: true };
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value))
        return { ok: false, error: 'expected YYYY-MM-DD' };
      return { ok: true };
    case 'boolean':
      if (typeof value !== 'boolean') return { ok: false, error: 'expected boolean' };
      return { ok: true };
    case 'select': {
      if (typeof value !== 'string') return { ok: false, error: 'expected string' };
      const keys = def.options?.values.map((o) => o.key) ?? [];
      if (!keys.includes(value)) return { ok: false, error: 'not a valid option' };
      return { ok: true };
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return { ok: false, error: 'expected array' };
      const keys = def.options?.values.map((o) => o.key) ?? [];
      for (const v of value) {
        if (typeof v !== 'string' || !keys.includes(v))
          return { ok: false, error: 'one or more values are not valid options' };
      }
      return { ok: true };
    }
    case 'url':
      if (typeof value !== 'string' || !URL_RE.test(value))
        return { ok: false, error: 'expected http(s) URL' };
      return { ok: true };
    case 'email':
      if (typeof value !== 'string' || !EMAIL_RE.test(value))
        return { ok: false, error: 'expected an email address' };
      return { ok: true };
    case 'phone':
      if (typeof value !== 'string' || !PHONE_RE.test(value))
        return { ok: false, error: 'expected a phone number' };
      return { ok: true };
    default: {
      const _exhaustive: never = def.type;
      return { ok: false, error: `unknown type: ${_exhaustive}` };
    }
  }
}
```

- [ ] **Step 4: Re-export from shared index**

Edit `packages/shared/src/index.ts` — append:

```typescript
export * from './custom-fields.js';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @dealflow/shared test -- custom-fields`
Expected: PASS — all cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/custom-fields.ts packages/shared/src/custom-fields.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): custom-fields schemas + per-type value validator"
```

---

## Task 2: DB schema (definitions table + JSONB columns)

**Files:**
- Create: `packages/db/src/schema/custom-field-definitions.ts`
- Modify: `packages/db/src/schema/contacts.ts`
- Modify: `packages/db/src/schema/companies.ts`
- Modify: `packages/db/src/schema/deals.ts`
- Modify: `packages/db/src/schema/activities.ts`
- Modify: `packages/db/src/schema/index.ts`
- Generated: `packages/db/drizzle/000X_custom_fields.sql` (via drizzle-kit)

- [ ] **Step 1: Create the definitions table schema**

Create `packages/db/src/schema/custom-field-definitions.ts`:

```typescript
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
```

- [ ] **Step 2: Add `custom_fields` column to each entity schema**

For each of `packages/db/src/schema/contacts.ts`, `companies.ts`, `deals.ts`, `activities.ts`, add to the table definition:

```typescript
customFields: jsonb('custom_fields').notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
```

Place it after the last existing column (before `createdAt`/`updatedAt`). Import `jsonb` from `'drizzle-orm/pg-core'` if not already imported.

Example position in `contacts.ts` (after `ownerUserId`, before `createdAt`):

```typescript
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    customFields: jsonb('custom_fields').notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

Repeat for the other three schemas — same column, same default.

- [ ] **Step 3: Re-export new schema from index**

Edit `packages/db/src/schema/index.ts` — add a re-export line:

```typescript
export * from './custom-field-definitions';
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @dealflow/db generate`
Expected: a new file `packages/db/drizzle/000X_custom_fields.sql` (where X is the next number) is created, containing `CREATE TABLE custom_field_definitions...`, `ALTER TABLE contacts ADD COLUMN custom_fields...`, plus the unique/regular indexes. Inspect the SQL — it should match the design spec's DDL.

If the migration file looks correct, move on. If anything is off (e.g., NOT NULL DEFAULT didn't generate cleanly), edit the SQL file by hand.

- [ ] **Step 5: Apply the migration**

Run: `pnpm --filter @dealflow/db migrate` (or whatever the project's migrate script is — check `packages/db/package.json`). If there's no migrate script, run the SQL directly with `psql` against the local Postgres.

Verify: `pnpm db:psql -c "\d custom_field_definitions"` shows the new table and indexes. `\d contacts` shows the new `custom_fields jsonb` column.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/custom-field-definitions.ts packages/db/src/schema/contacts.ts packages/db/src/schema/companies.ts packages/db/src/schema/deals.ts packages/db/src/schema/activities.ts packages/db/src/schema/index.ts packages/db/drizzle/
git commit -m "feat(db): custom_field_definitions table + custom_fields jsonb on entities"
```

---

## Task 3: `validateAndMergeCustomFields()` helper

**Files:**
- Create: `apps/api/src/lib/custom-fields-merge.ts`
- Create: `apps/api/test/lib/custom-fields-merge.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/lib/custom-fields-merge.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../helpers/postgres.js';
import { validateAndMergeCustomFields } from '../../src/lib/custom-fields-merge.js';

describe('validateAndMergeCustomFields', () => {
  let testDb: TestDatabase;
  let orgId: string;
  let textFieldId: string;
  let selectFieldId: string;
  let requiredFieldId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Org', slug: `o-${Date.now()}`, defaultCurrency: 'USD' })
      .returning();
    orgId = org!.id;

    const [textField] = await testDb.db
      .insert(schema.customFieldDefinitions)
      .values({
        organizationId: orgId,
        entityType: 'contact',
        name: 'Notes',
        type: 'text',
        options: null,
        required: false,
        position: 0,
      })
      .returning();
    textFieldId = textField!.id;

    const [selectField] = await testDb.db
      .insert(schema.customFieldDefinitions)
      .values({
        organizationId: orgId,
        entityType: 'contact',
        name: 'Lead Source',
        type: 'select',
        options: { values: [{ key: 'referral', label: 'Referral' }, { key: 'web', label: 'Web' }] },
        required: false,
        position: 1,
      })
      .returning();
    selectFieldId = selectField!.id;

    const [requiredField] = await testDb.db
      .insert(schema.customFieldDefinitions)
      .values({
        organizationId: orgId,
        entityType: 'contact',
        name: 'Priority',
        type: 'number',
        options: null,
        required: true,
        position: 2,
      })
      .returning();
    requiredFieldId = requiredField!.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('merges a valid patch into the existing JSONB', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: { [textFieldId]: 'old' },
      patch: { [selectFieldId]: 'referral' },
      isCreate: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.merged).toEqual({
      [textFieldId]: 'old',
      [selectFieldId]: 'referral',
    });
  });

  it('rejects an unknown field key', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: {},
      patch: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'x' },
      isCreate: false,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a value that fails type validation', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: {},
      patch: { [selectFieldId]: 'bogus' },  // not in options
      isCreate: false,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects creation when a required field is missing', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: {},
      patch: { [textFieldId]: 'hi' },  // required Priority absent
      isCreate: true,
    });
    expect(result.ok).toBe(false);
  });

  it('allows update without touching the required field', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: { [requiredFieldId]: 5 },
      patch: { [textFieldId]: 'updated' },
      isCreate: false,
    });
    expect(result.ok).toBe(true);
  });

  it('passes through when patch is undefined', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: { [textFieldId]: 'keep' },
      patch: undefined,
      isCreate: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.merged).toEqual({ [textFieldId]: 'keep' });
  });

  it('rejects null on a required field at create time', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: {},
      patch: { [requiredFieldId]: null },
      isCreate: true,
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter @dealflow/api test -- custom-fields-merge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/lib/custom-fields-merge.ts`:

```typescript
import { and, eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  type CustomFieldEntityType,
  validateCustomFieldValue,
} from '@dealflow/shared';

export interface MergeArgs {
  orgId: string;
  entityType: CustomFieldEntityType;
  existing: Record<string, unknown>;
  patch: Record<string, unknown> | undefined;
  isCreate: boolean;
}

export type MergeResult =
  | { ok: true; merged: Record<string, unknown> }
  | { ok: false; status: 400; error: string; fieldErrors?: Record<string, string> };

/**
 * Validates an inbound `customFields` patch against the active definitions
 * for the org + entity type, then merges into `existing`. Returns the merged
 * JSONB on success or a structured 400 on failure.
 *
 * Behaviour:
 *   - Unknown field keys (no matching definition) → 400.
 *   - Type-invalid values (per shared `validateCustomFieldValue`) → 400.
 *   - `required:true` definitions absent at create time → 400.
 *   - Patch entries with `null` clear the field (set to null in merged JSONB).
 *   - When `patch` is undefined, returns `existing` unchanged.
 */
export async function validateAndMergeCustomFields(
  deps: { db: Database },
  args: MergeArgs,
): Promise<MergeResult> {
  if (!args.patch) return { ok: true, merged: args.existing };

  const defs = await deps.db
    .select()
    .from(schema.customFieldDefinitions)
    .where(
      and(
        eq(schema.customFieldDefinitions.organizationId, args.orgId),
        eq(schema.customFieldDefinitions.entityType, args.entityType),
      ),
    );
  const defById = new Map(defs.map((d) => [d.id, d]));

  const merged: Record<string, unknown> = { ...args.existing };
  const fieldErrors: Record<string, string> = {};

  for (const [key, value] of Object.entries(args.patch)) {
    const def = defById.get(key);
    if (!def) {
      fieldErrors[key] = 'unknown_field';
      continue;
    }
    const v = validateCustomFieldValue({ type: def.type as never, options: def.options }, value);
    if (!v.ok) {
      fieldErrors[key] = v.error;
      continue;
    }
    if (value === null) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  if (args.isCreate) {
    for (const def of defs) {
      if (!def.required) continue;
      const v = merged[def.id];
      if (v === null || v === undefined) {
        fieldErrors[def.id] = 'required';
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, error: 'Invalid custom fields', fieldErrors };
  }
  return { ok: true, merged };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @dealflow/api test -- custom-fields-merge`
Expected: PASS — 7/7.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/custom-fields-merge.ts apps/api/test/lib/custom-fields-merge.test.ts
git commit -m "feat(api): validateAndMergeCustomFields helper"
```

---

## Task 4: CustomFieldsRepo + REST endpoints

**Files:**
- Create: `apps/api/src/modules/custom-fields/repo.ts`
- Create: `apps/api/src/modules/custom-fields/routes.ts`
- Create: `apps/api/test/modules/custom-fields/routes.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write failing endpoint tests**

Create `apps/api/test/modules/custom-fields/routes.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Custom fields CRUD', () => {
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

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/custom-fields?entity=contact' });
    expect(res.statusCode).toBe(401);
  });

  it('round-trips a definition: create → list → patch → delete', async () => {
    const { cookie } = await signupTestUser(app);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'contact', name: 'Lead Source', type: 'select', options: { values: [{ key: 'web', label: 'Web' }] } },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.entityType).toBe('contact');
    expect(created.name).toBe('Lead Source');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/custom-fields?entity=contact',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/custom-fields/${created.id}`,
      headers: { cookie },
      payload: { name: 'Source', required: true },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('Source');
    expect(patch.json().required).toBe(true);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/custom-fields/${created.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    const listEmpty = await app.inject({
      method: 'GET',
      url: '/api/v1/custom-fields?entity=contact',
      headers: { cookie },
    });
    expect(listEmpty.json()).toEqual([]);
  });

  it('rejects duplicate (org, entityType, name)', async () => {
    const { cookie } = await signupTestUser(app);
    const payload = { entityType: 'deal' as const, name: 'Source', type: 'text' as const };
    const a = await app.inject({ method: 'POST', url: '/api/v1/custom-fields', headers: { cookie }, payload });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({ method: 'POST', url: '/api/v1/custom-fields', headers: { cookie }, payload });
    expect(b.statusCode).toBe(409);
  });

  it('enforces tenant isolation: orgA cannot list orgB definitions', async () => {
    const a = await signupTestUser(app);
    const b = await signupTestUser(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie: a.cookie },
      payload: { entityType: 'company', name: 'Tier', type: 'text' },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/custom-fields?entity=company',
      headers: { cookie: b.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);
  });

  it('rejects PATCH that tries to change type', async () => {
    const { cookie } = await signupTestUser(app);
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'note', name: 'Outcome', type: 'select', options: { values: [{ key: 'a', label: 'A' }] } },
    });
    const id = create.json().id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/custom-fields/${id}`,
      headers: { cookie },
      // @ts-expect-error type is intentionally not in the schema
      payload: { type: 'text' },
    });
    // Either 400 (Zod strips/rejects) or 200 + type unchanged. The route must
    // not allow type to mutate.
    if (patch.statusCode === 200) {
      expect(patch.json().type).toBe('select');
    } else {
      expect(patch.statusCode).toBe(400);
    }
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- custom-fields/routes`
Expected: FAIL (404 / module-not-found).

- [ ] **Step 3: Implement the repo**

Create `apps/api/src/modules/custom-fields/repo.ts`:

```typescript
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldEntityType,
  UpdateCustomFieldBody,
} from '@dealflow/shared';

export class CustomFieldsRepo {
  constructor(private readonly db: Database) {}

  async list(orgId: string, entityType: CustomFieldEntityType): Promise<CustomFieldDefinition[]> {
    const rows = await this.db
      .select()
      .from(schema.customFieldDefinitions)
      .where(
        and(
          eq(schema.customFieldDefinitions.organizationId, orgId),
          eq(schema.customFieldDefinitions.entityType, entityType),
        ),
      )
      .orderBy(asc(schema.customFieldDefinitions.position));
    return rows.map(toPublic);
  }

  async create(orgId: string, input: CreateCustomFieldBody): Promise<CustomFieldDefinition> {
    const [row] = await this.db
      .insert(schema.customFieldDefinitions)
      .values({
        organizationId: orgId,
        entityType: input.entityType,
        name: input.name.trim(),
        type: input.type,
        options: input.options ?? null,
        required: input.required ?? false,
        position: input.position ?? 0,
      })
      .returning();
    if (!row) throw new Error('Insert returned no row');
    return toPublic(row);
  }

  async update(
    orgId: string,
    id: string,
    patch: UpdateCustomFieldBody,
  ): Promise<CustomFieldDefinition | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.options !== undefined) set.options = patch.options;
    if (patch.required !== undefined) set.required = patch.required;
    if (patch.position !== undefined) set.position = patch.position;

    const [row] = await this.db
      .update(schema.customFieldDefinitions)
      .set(set)
      .where(
        and(
          eq(schema.customFieldDefinitions.organizationId, orgId),
          eq(schema.customFieldDefinitions.id, id),
        ),
      )
      .returning();
    return row ? toPublic(row) : null;
  }

  async delete(orgId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.customFieldDefinitions)
      .where(
        and(
          eq(schema.customFieldDefinitions.organizationId, orgId),
          eq(schema.customFieldDefinitions.id, id),
        ),
      )
      .returning({ id: schema.customFieldDefinitions.id });
    return rows.length > 0;
  }
}

function toPublic(row: typeof schema.customFieldDefinitions.$inferSelect): CustomFieldDefinition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    entityType: row.entityType as CustomFieldEntityType,
    name: row.name,
    type: row.type as CustomFieldDefinition['type'],
    options: row.options ?? null,
    required: row.required,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Implement the routes**

Create `apps/api/src/modules/custom-fields/routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@dealflow/db';
import {
  createCustomFieldBodySchema,
  customFieldEntityTypeSchema,
  ERROR_CODES,
  updateCustomFieldBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { CustomFieldsRepo } from './repo.js';

const idParamSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({ entity: customFieldEntityTypeSchema });

export interface CustomFieldsRoutesDeps {
  db: Database;
}

export async function registerCustomFieldsRoutes(
  app: FastifyInstance,
  deps: CustomFieldsRoutesDeps,
): Promise<void> {
  const repo = new CustomFieldsRepo(deps.db);

  app.get('/api/v1/custom-fields', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'entity query required' } });
    }
    const rows = await repo.list(req.session!.currentOrgId!, parsed.data.entity);
    return reply.send(rows);
  });

  app.post('/api/v1/custom-fields', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createCustomFieldBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid custom field',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    try {
      const created = await repo.create(req.session!.currentOrgId!, parsed.data);
      return reply.status(201).send(created);
    } catch (err) {
      if (err instanceof Error && /duplicate key/i.test(err.message)) {
        return reply.status(409).send({
          error: { code: ERROR_CODES.CONFLICT ?? 'CONFLICT', message: 'Field name already exists for this entity' },
        });
      }
      throw err;
    }
  });

  app.patch('/api/v1/custom-fields/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    const body = updateCustomFieldBodySchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid update' } });
    }
    const updated = await repo.update(req.session!.currentOrgId!, params.data.id, body.data);
    if (!updated) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Field not found' } });
    return reply.send(updated);
  });

  app.delete('/api/v1/custom-fields/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Bad id' } });
    const ok = await repo.delete(req.session!.currentOrgId!, params.data.id);
    if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Field not found' } });
    return reply.status(204).send();
  });
}
```

If `ERROR_CODES.CONFLICT` doesn't exist in `@dealflow/shared`, add it now (`packages/shared/src/error.ts`): `CONFLICT: 'CONFLICT'`. Commit that as a tiny separate change first if needed, or include in this task's commit.

- [ ] **Step 5: Register in server.ts**

Edit `apps/api/src/server.ts`. After `registerReportsRoutes`, append:

```typescript
    const { registerCustomFieldsRoutes } = await import('./modules/custom-fields/routes.js');
    await registerCustomFieldsRoutes(app, { db: opts.db });
```

- [ ] **Step 6: Run tests — verify all pass**

Run: `pnpm --filter @dealflow/api test -- custom-fields/routes`
Expected: PASS — 5/5.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/custom-fields/repo.ts apps/api/src/modules/custom-fields/routes.ts apps/api/test/modules/custom-fields/routes.test.ts apps/api/src/server.ts packages/shared/src/error.ts
git commit -m "feat(api): custom-fields CRUD endpoints (org-scoped)"
```

---

## Task 5: Wire customFields into contacts routes

**Files:**
- Modify: `apps/api/src/modules/contacts/routes.ts`
- Modify: `apps/api/test/modules/contacts/routes.test.ts` (or wherever the contacts route tests live)

- [ ] **Step 1: Append failing tests covering customFields**

Open the existing contacts route test file and append a new describe block:

```typescript
describe('Contacts customFields', () => {
  // Reuse the same beforeAll/afterAll pattern the file already uses.

  it('PATCH /contacts/:id merges valid customFields', async () => {
    const { cookie, orgId } = await signupTestUser(app);
    // Create a definition
    const def = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'contact', name: 'Lead Source', type: 'text' },
    });
    const fieldId = def.json().id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Sarah' },
    });
    const contactId = created.json().id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${contactId}`,
      headers: { cookie },
      payload: { customFields: { [fieldId]: 'Referral' } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().customFields).toEqual({ [fieldId]: 'Referral' });

    void orgId;
  });

  it('PATCH rejects unknown custom field key with 400', async () => {
    const { cookie } = await signupTestUser(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'X' },
    });
    const id = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
      payload: { customFields: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /contacts/:id returns customFields', async () => {
    const { cookie } = await signupTestUser(app);
    const def = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'contact', name: 'Notes', type: 'text' },
    });
    const fieldId = def.json().id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'X', customFields: { [fieldId]: 'hello' } },
    });
    const id = created.json().id;
    const got = await app.inject({ method: 'GET', url: `/api/v1/contacts/${id}`, headers: { cookie } });
    expect(got.json().customFields).toEqual({ [fieldId]: 'hello' });
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- contacts`
Expected: New tests fail (route still ignores `customFields`).

- [ ] **Step 3: Extend the contacts POST + PATCH route handlers**

In `apps/api/src/modules/contacts/routes.ts`:

1. Add to top imports:

```typescript
import { validateAndMergeCustomFields } from '../../lib/custom-fields-merge.js';
```

2. Find the existing POST and PATCH handlers. The body schemas (likely zod) need a new optional field `customFields: z.record(z.unknown()).optional()`. Add it to both schemas (or to the shared `createContactBodySchema` / `updateContactBodySchema` if they live in `packages/shared` — adjust there instead).

3. In the POST handler, after the body parses and BEFORE the insert, run:

```typescript
const merge = await validateAndMergeCustomFields(
  { db: deps.db },
  { orgId, entityType: 'contact', existing: {}, patch: parsed.data.customFields, isCreate: true },
);
if (!merge.ok) {
  return reply.status(merge.status).send({
    error: { code: ERROR_CODES.VALIDATION_FAILED, message: merge.error, details: merge.fieldErrors },
  });
}
// Pass merge.merged as `customFields` to the insert.
```

4. In the PATCH handler, load the existing contact first, then:

```typescript
const merge = await validateAndMergeCustomFields(
  { db: deps.db },
  { orgId, entityType: 'contact', existing: existing.customFields ?? {}, patch: parsed.data.customFields, isCreate: false },
);
if (!merge.ok) { /* same 400 as above */ }
// Set customFields: merge.merged on the update.
```

5. Update the GET / list response shapers to include `customFields` in the public projection.

The exact shape of the existing route is project-specific; the implementer should follow the existing pattern (likely a `publicContact()` helper) and just add `customFields: row.customFields ?? {}`.

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- contacts`
Expected: PASS — all (existing + new) green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts/ apps/api/test/modules/contacts/ packages/shared/src/contacts.ts
git commit -m "feat(api): contacts accept/return customFields"
```

---

## Task 6: Wire customFields into companies routes

**Files:**
- Modify: `apps/api/src/modules/companies/routes.ts`
- Modify: `apps/api/test/modules/companies/routes.test.ts`
- (Possibly) Modify: `packages/shared/src/companies.ts`

Same pattern as Task 5 — append 3 tests (PATCH merge, unknown-key 400, GET returns customFields) using `entityType: 'company'`, then add the body field + `validateAndMergeCustomFields` calls + shape updates.

- [ ] **Step 1: Append the same 3 tests, swapping `contact` → `company`, `firstName: 'Sarah'` → `name: 'Acme'`, etc.**

- [ ] **Step 2: Run — expect failures.**

Run: `pnpm --filter @dealflow/api test -- companies`

- [ ] **Step 3: Apply the same edits to `apps/api/src/modules/companies/routes.ts`** — body schemas, POST and PATCH handlers wrap with `validateAndMergeCustomFields({ orgId, entityType: 'company', ... })`, GET/list include `customFields` in the public projection.

- [ ] **Step 4: Run — verify pass.**

Run: `pnpm --filter @dealflow/api test -- companies`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/companies/ apps/api/test/modules/companies/ packages/shared/src/companies.ts
git commit -m "feat(api): companies accept/return customFields"
```

---

## Task 7: Wire customFields into deals routes

**Files:**
- Modify: `apps/api/src/modules/deals/routes.ts`
- Modify: `apps/api/test/modules/deals/routes.test.ts`
- (Possibly) Modify: `packages/shared/src/deals.ts`

- [ ] **Step 1: Append the same 3 tests with `entityType: 'deal'`.** Deal create payloads need `pipelineId`, `stageId`, `name`, `value` — copy the shape from existing deal tests in the file.

- [ ] **Step 2: Run — expect failures.**

- [ ] **Step 3: Apply same edits as Task 5/6 to `apps/api/src/modules/deals/routes.ts`** using `entityType: 'deal'`.

- [ ] **Step 4: Run — verify pass.**

Run: `pnpm --filter @dealflow/api test -- deals`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/deals/ apps/api/test/modules/deals/ packages/shared/src/deals.ts
git commit -m "feat(api): deals accept/return customFields"
```

---

## Task 8: Wire customFields into activities + new GET /api/v1/activities/:id

**Files:**
- Modify: `apps/api/src/modules/activities/routes.ts`
- Modify: `apps/api/test/modules/activities/activities.routes.test.ts`
- (Possibly) Modify: `packages/shared/src/activities.ts`

**Activity-specific:** the merge helper needs `entityType: kind === 'task' ? 'task' : 'note'`. For create, the body already has `kind`; for update, load the existing row first to read its `kind`.

- [ ] **Step 1: Append failing tests**

```typescript
describe('Activities customFields', () => {
  it('PATCH a note uses note custom field definitions', async () => {
    const { cookie } = await signupTestUser(app);
    const def = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'note', name: 'Outcome', type: 'text' },
    });
    const noteFieldId = def.json().id;

    // create a contact to anchor the note to
    const contact = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'X' },
    });
    const note = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      headers: { cookie },
      payload: { kind: 'note', body: 'Met today', contactId: contact.json().id },
    });
    const id = note.json().id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${id}`,
      headers: { cookie },
      payload: { customFields: { [noteFieldId]: 'Qualified' } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().customFields).toEqual({ [noteFieldId]: 'Qualified' });
  });

  it('a task field is invalid on a note', async () => {
    const { cookie } = await signupTestUser(app);
    const def = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'task', name: 'Effort', type: 'number' },
    });
    const taskFieldId = def.json().id;

    const contact = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'X' },
    });
    const note = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      headers: { cookie },
      payload: { kind: 'note', body: 'n', contactId: contact.json().id },
    });
    const id = note.json().id;
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${id}`,
      headers: { cookie },
      payload: { customFields: { [taskFieldId]: 3 } },
    });
    expect(updated.statusCode).toBe(400);
  });

  it('GET /api/v1/activities/:id returns the activity (new endpoint)', async () => {
    const { cookie } = await signupTestUser(app);
    const contact = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'X' },
    });
    const note = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      headers: { cookie },
      payload: { kind: 'note', body: 'one', contactId: contact.json().id },
    });
    const id = note.json().id;
    const got = await app.inject({ method: 'GET', url: `/api/v1/activities/${id}`, headers: { cookie } });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(id);
    expect(got.json().body).toBe('one');
  });

  it('GET /api/v1/activities/:id 404s for unknown id', async () => {
    const { cookie } = await signupTestUser(app);
    const got = await app.inject({
      method: 'GET',
      url: '/api/v1/activities/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
    });
    expect(got.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect failures.**

Run: `pnpm --filter @dealflow/api test -- activities/activities.routes`

- [ ] **Step 3: Extend the activities POST + PATCH handlers** with `validateAndMergeCustomFields({ ..., entityType: input.kind === 'task' ? 'task' : 'note' })`. For PATCH, the kind comes from the existing row.

- [ ] **Step 4: Add the new GET /:id handler** to `routes.ts`:

```typescript
app.get('/api/v1/activities/:id', { preHandler: requireOrg }, async (req, reply) => {
  const params = idParamSchema.safeParse(req.params);
  if (!params.success) return reply.status(400).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'bad id' } });
  const row = await repo.findById(req.session!.currentOrgId!, params.data.id);
  if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
  return reply.send(publicActivity(row));
});
```

(`idParamSchema` likely already exists in the file; `publicActivity` is the existing public shape — extend it to include `customFields`.)

- [ ] **Step 5: Run — verify pass.**

Run: `pnpm --filter @dealflow/api test -- activities/activities.routes`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/activities/routes.ts apps/api/test/modules/activities/activities.routes.test.ts packages/shared/src/activities.ts
git commit -m "feat(api): activities accept/return customFields + GET /:id endpoint"
```

---

## Task 9: Frontend API hooks (custom-fields + useActivity)

**Files:**
- Modify: `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/features/custom-fields/api.ts`
- Modify: `apps/web/src/features/activities/api.ts`

- [ ] **Step 1: Add query keys**

Edit `apps/web/src/lib/query-keys.ts` — inside the exported object, append before the closing brace:

```typescript
  customFields: {
    list: (entityType: string) => ['custom-fields', 'list', entityType] as const,
  },
```

Also extend `activities`:

```typescript
  activities: {
    forContact: (id: string) => ['activities', 'contact', id] as const,
    forCompany: (id: string) => ['activities', 'company', id] as const,
    forDeal: (id: string) => ['activities', 'deal', id] as const,
    detail: (id: string) => ['activities', 'detail', id] as const,
  },
```

- [ ] **Step 2: Custom-fields hooks**

Create `apps/web/src/features/custom-fields/api.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldEntityType,
  UpdateCustomFieldBody,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useCustomFields(entityType: CustomFieldEntityType) {
  return useQuery({
    queryKey: queryKeys.customFields.list(entityType),
    queryFn: () =>
      apiFetch<CustomFieldDefinition[]>(`/api/v1/custom-fields?entity=${entityType}`),
    staleTime: 60_000,
  });
}

export function useCreateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomFieldBody) =>
      apiFetch<CustomFieldDefinition>('/api/v1/custom-fields', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.customFields.list(created.entityType) });
    },
  });
}

export function useUpdateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateCustomFieldBody }) =>
      apiFetch<CustomFieldDefinition>(`/api/v1/custom-fields/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input.patch),
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.customFields.list(updated.entityType) });
    },
  });
}

export function useDeleteCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; entityType: CustomFieldEntityType }) =>
      apiFetch(`/api/v1/custom-fields/${input.id}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.customFields.list(vars.entityType) });
    },
  });
}
```

- [ ] **Step 3: useActivity hook**

Edit `apps/web/src/features/activities/api.ts`. Append:

```typescript
export function useActivity(id: string) {
  return useQuery({
    queryKey: queryKeys.activities.detail(id),
    queryFn: () => apiFetch<Activity>(`/api/v1/activities/${id}`),
    enabled: !!id,
  });
}
```

(`Activity` is the existing shape from the file — if it's not exported, export it as a side-effect of this change.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/query-keys.ts apps/web/src/features/custom-fields/api.ts apps/web/src/features/activities/api.ts
git commit -m "feat(web): TanStack Query hooks for custom-fields + useActivity"
```

---

## Task 10: `<CustomFieldEditor>` dialog

**Files:**
- Create: `apps/web/src/features/custom-fields/custom-field-editor.tsx`

- [ ] **Step 1: Implement the dialog**

Create `apps/web/src/features/custom-fields/custom-field-editor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldDefinition,
  type CustomFieldEntityType,
  type CustomFieldType,
} from '@dealflow/shared';
import { useCreateCustomField, useUpdateCustomField } from './api';

interface Props {
  open: boolean;
  onClose: () => void;
  entityType: CustomFieldEntityType;
  /** When set, the dialog edits this definition instead of creating a new one. */
  existing?: CustomFieldDefinition;
}

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  boolean: 'Checkbox',
  select: 'Single select',
  multi_select: 'Multi-select',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
};

function kebab(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'option';
}

export function CustomFieldEditor({ open, onClose, entityType, existing }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);

  const create = useCreateCustomField();
  const update = useUpdateCustomField();
  const isEdit = !!existing;

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? '');
      setType(existing?.type ?? 'text');
      setOptionsText(
        (existing?.options?.values ?? []).map((v) => v.label).join('\n'),
      );
      setRequired(existing?.required ?? false);
    }
  }, [open, existing]);

  const needsOptions = type === 'select' || type === 'multi_select';

  async function onSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const options = needsOptions
      ? { values: optionsText.split('\n').map((l) => l.trim()).filter(Boolean).map((label) => ({ key: kebab(label), label })) }
      : null;

    if (isEdit) {
      await update.mutateAsync({ id: existing.id, patch: { name: trimmed, options, required } });
    } else {
      await create.mutateAsync({ entityType, name: trimmed, type, options, required });
    }
    onClose();
  }

  const submitting = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit custom field' : `Add a custom field for ${entityType}s`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="cf-name" className="text-xs">Field name</Label>
            <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lead Source" />
          </div>

          <div>
            <Label htmlFor="cf-type" className="text-xs">Type</Label>
            <select
              id="cf-type"
              disabled={isEdit}
              value={type}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
              className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-50"
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
            {isEdit && (
              <p className="mt-1 text-[11px] text-neutral-400">Type can't change after creation.</p>
            )}
          </div>

          {needsOptions && (
            <div>
              <Label htmlFor="cf-options" className="text-xs">Options (one per line)</Label>
              <textarea
                id="cf-options"
                rows={5}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={'Referral\nLinkedIn\nCold outreach'}
                className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={onSubmit} disabled={!name.trim() || submitting}>
            {submitting ? 'Saving…' : 'Save field'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/custom-fields/custom-field-editor.tsx
git commit -m "feat(web): CustomFieldEditor dialog"
```

---

## Task 11: `<CustomFieldsBlock>` component

**Files:**
- Create: `apps/web/src/features/custom-fields/custom-fields-block.tsx`

Renders one row per active definition. Supports two modes: **read-only display** (default) and **inline edit** (when the parent passes `editable={true}` + an `onChange` handler). Inside create-dialogs, the parent owns the state and the block is fully controlled.

- [ ] **Step 1: Implement the block**

Create `apps/web/src/features/custom-fields/custom-fields-block.tsx`:

```tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldType,
} from '@dealflow/shared';
import { useCustomFields } from './api';

interface Props {
  entityType: CustomFieldEntityType;
  /** Current values keyed by definition.id */
  values: Record<string, unknown>;
  /** Called when a single field changes. Pass `null` to clear. */
  onChange: (fieldId: string, value: unknown) => void;
  /** When true, header label + section divider render. */
  showHeader?: boolean;
}

export function CustomFieldsBlock({ entityType, values, onChange, showHeader = true }: Props) {
  const q = useCustomFields(entityType);
  if (q.isPending) return null;
  const defs = q.data ?? [];
  if (defs.length === 0) return null;

  return (
    <section className="space-y-3" data-testid={`custom-fields-${entityType}`}>
      {showHeader && (
        <div className="text-xs uppercase tracking-wide text-neutral-400">Custom fields</div>
      )}
      {defs.map((def) => (
        <FieldRow key={def.id} def={def} value={values[def.id]} onChange={(v) => onChange(def.id, v)} />
      ))}
    </section>
  );
}

function FieldRow({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div>
      <Label htmlFor={`cf-${def.id}`} className="text-xs">
        {def.name}
        {def.required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <FieldInput def={def} value={value} onChange={onChange} id={`cf-${def.id}`} />
    </div>
  );
}

function FieldInput({
  def,
  value,
  onChange,
  id,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  id: string;
}) {
  const t: CustomFieldType = def.type;
  if (t === 'long_text') {
    return (
      <textarea
        id={id}
        rows={3}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
      />
    );
  }
  if (t === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (t === 'select') {
    return (
      <select
        id={id}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
      >
        <option value="">— Select —</option>
        {def.options?.values.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (t === 'multi_select') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-1">
        {def.options?.values.map((o) => {
          const on = arr.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange(on ? arr.filter((k) => k !== o.key) : [...arr, o.key])}
              className={`rounded-md border px-2 py-1 text-xs ${on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700'}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  const htmlType = t === 'number' ? 'number' : t === 'date' ? 'date' : t === 'email' ? 'email' : t === 'url' ? 'url' : t === 'phone' ? 'tel' : 'text';
  return (
    <Input
      id={id}
      type={htmlType}
      value={value == null ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        if (t === 'number') return onChange(Number(raw));
        onChange(raw);
      }}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/custom-fields/custom-fields-block.tsx
git commit -m "feat(web): CustomFieldsBlock — type-aware inputs per definition"
```

---

## Task 12: Settings → Custom Fields page

**Files:**
- Create: `apps/web/src/features/custom-fields/custom-fields-settings.tsx`
- Create: `apps/web/src/routes/app.settings.custom-fields.tsx`
- Modify: `apps/web/src/routes/app.settings.tsx`

- [ ] **Step 1: Build the settings page body**

Create `apps/web/src/features/custom-fields/custom-fields-settings.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CUSTOM_FIELD_ENTITY_TYPES, type CustomFieldDefinition, type CustomFieldEntityType } from '@dealflow/shared';
import { CustomFieldEditor } from './custom-field-editor';
import { useCustomFields, useDeleteCustomField } from './api';

const TABS: { key: CustomFieldEntityType; label: string }[] = [
  { key: 'contact',  label: 'Contacts'   },
  { key: 'company',  label: 'Companies'  },
  { key: 'deal',     label: 'Deals'      },
  { key: 'note',     label: 'Notes'      },
  { key: 'task',     label: 'Tasks'      },
];

export function CustomFieldsSettings() {
  const [tab, setTab] = useState<CustomFieldEntityType>(TABS[0]!.key);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | undefined>(undefined);
  const list = useCustomFields(tab);
  const del = useDeleteCustomField();
  void CUSTOM_FIELD_ENTITY_TYPES; // silence unused

  return (
    <main className="p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Custom fields</h1>
        <p className="text-sm text-neutral-500">Define your own fields per entity. Up to 50 chars per name.</p>
      </header>

      <div className="mb-3 flex items-center justify-between border-b border-neutral-200">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                tab === t.key
                  ? 'border-neutral-900 font-medium text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => { setEditing(undefined); setEditorOpen(true); }}>
          + Add field
        </Button>
      </div>

      {list.isPending && <p className="text-sm text-neutral-500">Loading…</p>}
      {list.data && list.data.length === 0 && (
        <p className="text-sm text-neutral-400">No custom fields yet — click + Add field to create one.</p>
      )}

      {list.data && list.data.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
          {list.data.map((def) => (
            <li key={def.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-900">{def.name}</div>
                <div className="text-xs text-neutral-500">
                  {def.type}{def.required ? ' · required' : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { setEditing(def); setEditorOpen(true); }}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(`Delete "${def.name}"? Values stored on existing ${tab}s will be hidden but not erased.`)) return;
                    await del.mutateAsync({ id: def.id, entityType: tab });
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CustomFieldEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        entityType={tab}
        existing={editing}
      />
    </main>
  );
}
```

- [ ] **Step 2: Add the file route**

Create `apps/web/src/routes/app.settings.custom-fields.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { CustomFieldsSettings } from '@/features/custom-fields/custom-fields-settings';

export const Route = createFileRoute('/app/settings/custom-fields')({
  component: CustomFieldsSettings,
});
```

- [ ] **Step 3: Link from main Settings page**

Edit `apps/web/src/routes/app.settings.tsx`. Find a reasonable spot (e.g., below the existing AI / SMTP sections) and add a link:

```tsx
import { Link } from '@tanstack/react-router';

// inside the page body
<section className="mt-4 rounded-md border border-neutral-200 p-4">
  <h2 className="mb-1 text-base font-medium">Custom fields</h2>
  <p className="mb-2 text-sm text-neutral-500">Define structured fields beyond the built-in columns on contacts, companies, deals, notes, and tasks.</p>
  <Link to="/app/settings/custom-fields" className="text-sm text-neutral-900 underline">
    Manage custom fields →
  </Link>
</section>
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean (route tree regenerated).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/custom-fields/custom-fields-settings.tsx apps/web/src/routes/app.settings.custom-fields.tsx apps/web/src/routes/app.settings.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /app/settings/custom-fields page with 5 entity tabs"
```

---

## Task 13: Wire `<CustomFieldsBlock>` into the 3 entity detail pages

**Files:**
- Modify: `apps/web/src/routes/app.contacts.$id.tsx`
- Modify: `apps/web/src/routes/app.companies.$id.tsx`
- Modify: `apps/web/src/routes/app.deals.$id.tsx`

For each of the three files, the change is the same pattern:

- [ ] **Step 1: For each detail page, import the block + extend the local edit state to include `customFields`**

Example for contacts (`app.contacts.$id.tsx`):

```tsx
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';

// inside the component, add to the local form state (or alongside the existing
// useState for the contact patch — match the existing pattern in the file):
const [customFieldsDraft, setCustomFieldsDraft] = useState<Record<string, unknown>>({});

// when the contact loads, seed the draft from contact.customFields:
useEffect(() => {
  if (contact.data?.customFields) setCustomFieldsDraft(contact.data.customFields);
}, [contact.data?.customFields]);

// render below the existing details block, before activity feed:
<CustomFieldsBlock
  entityType="contact"
  values={customFieldsDraft}
  onChange={(fieldId, value) => {
    setCustomFieldsDraft((prev) => ({ ...prev, [fieldId]: value }));
    // Inline-save: PATCH the contact with only the changed field. Use the
    // existing useUpdateContact() mutation from features/contacts/api.ts.
    updateContact.mutate({ id: contact.data!.id, patch: { customFields: { [fieldId]: value } } });
  }}
/>
```

- [ ] **Step 2: Repeat for companies (`app.companies.$id.tsx`) and deals (`app.deals.$id.tsx`)**, swapping `entityType` and the mutation hook accordingly.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/app.contacts.\$id.tsx apps/web/src/routes/app.companies.\$id.tsx apps/web/src/routes/app.deals.\$id.tsx
git commit -m "feat(web): embed CustomFieldsBlock on contact/company/deal detail pages"
```

---

## Task 14: Wire `<CustomFieldsBlock>` into create-dialogs

**Files:**
- Modify: `apps/web/src/features/contacts/create-contact-dialog.tsx`
- Modify: `apps/web/src/features/companies/create-company-dialog.tsx`
- Modify: `apps/web/src/features/deals/create-deal-dialog.tsx`
- Modify: `apps/web/src/features/activities/add-note-form.tsx`
- Modify: `apps/web/src/features/activities/add-task-form.tsx`

Each of these already has a form state and a submit handler. The change is: add a `customFields` state field, render the block above the submit button, include `customFields` in the POST body.

- [ ] **Step 1: For each file, add `customFields` to the local state + JSX**

Example for `create-contact-dialog.tsx`:

```tsx
const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

// in the JSX, before the submit button:
<CustomFieldsBlock
  entityType="contact"
  values={customFields}
  onChange={(fieldId, value) => setCustomFields((prev) => ({ ...prev, [fieldId]: value }))}
/>

// in the submit handler, include customFields in the POST body:
await createContact.mutateAsync({ /* existing fields */, customFields });
```

For `add-note-form.tsx`: use `entityType="note"`. For `add-task-form.tsx`: use `entityType="task"`. For the company/deal create dialogs, use `"company"` / `"deal"`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/contacts/create-contact-dialog.tsx apps/web/src/features/companies/create-company-dialog.tsx apps/web/src/features/deals/create-deal-dialog.tsx apps/web/src/features/activities/add-note-form.tsx apps/web/src/features/activities/add-task-form.tsx
git commit -m "feat(web): embed CustomFieldsBlock in create-dialogs + activity composers"
```

---

## Task 15: Activity detail page + ActivityFeed/tasks-list link

**Files:**
- Create: `apps/web/src/routes/app.activities.$id.tsx`
- Modify: `apps/web/src/features/activities/activity-feed.tsx`
- Modify: `apps/web/src/routes/app.tasks.tsx`

- [ ] **Step 1: Build the activity detail page**

Create `apps/web/src/routes/app.activities.$id.tsx`:

```tsx
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useActivity } from '@/features/activities/api';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';
import { apiFetch } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/app/activities/$id')({
  component: ActivityDetailPage,
});

function ActivityDetailPage() {
  const { id } = Route.useParams();
  const q = useActivity(id);
  const qc = useQueryClient();
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (q.data?.customFields) setCustomFields(q.data.customFields);
  }, [q.data?.customFields]);

  if (q.isPending) return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  if (q.isError || !q.data) return <main className="p-8 text-sm text-red-600">Activity not found.</main>;

  const a = q.data;
  const entityType = a.kind === 'task' ? 'task' : 'note';

  async function onCustomFieldChange(fieldId: string, value: unknown) {
    setCustomFields((prev) => ({ ...prev, [fieldId]: value }));
    await apiFetch(`/api/v1/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ customFields: { [fieldId]: value } }),
    });
    qc.invalidateQueries({ queryKey: queryKeys.activities.detail(id) });
  }

  async function onMarkDone() {
    await apiFetch(`/api/v1/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    });
    qc.invalidateQueries({ queryKey: queryKeys.activities.detail(id) });
  }

  return (
    <main className="space-y-6 p-8">
      <header>
        <Link to="/app/tasks" className="text-sm text-neutral-500 hover:underline">← Back</Link>
        <h1 className="mt-2 flex items-center justify-between text-2xl font-semibold tracking-tight">
          <span>
            {a.kind === 'task' ? 'Task' : 'Note'}
            {a.dueAt && <span className="ml-2 text-sm font-normal text-neutral-500">· Due {a.dueAt.slice(0, 10)}</span>}
          </span>
          {a.kind === 'task' && a.status !== 'done' && (
            <Button size="sm" onClick={onMarkDone}>Mark done</Button>
          )}
        </h1>
        <pre className="mt-3 whitespace-pre-wrap rounded-md border border-neutral-200 bg-white p-3 text-sm">
          {a.body}
        </pre>
      </header>

      <section>
        <CustomFieldsBlock
          entityType={entityType}
          values={customFields}
          onChange={onCustomFieldChange}
        />
      </section>

      <section className="text-xs text-neutral-400">
        Created {new Date(a.createdAt).toLocaleString()}
        {a.completedAt && <> · Completed {new Date(a.completedAt).toLocaleString()}</>}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Add a link icon in ActivityFeed rows**

Edit `apps/web/src/features/activities/activity-feed.tsx`. For each rendered activity row, add a small link to `/app/activities/$id`:

```tsx
import { Link } from '@tanstack/react-router';

// next to the existing actions on each row:
<Link
  to="/app/activities/$id"
  params={{ id: activity.id }}
  className="text-xs text-neutral-400 hover:text-neutral-700"
>
  Open ↗
</Link>
```

- [ ] **Step 3: Make task title click navigate to detail**

Edit `apps/web/src/routes/app.tasks.tsx`. Wrap each task title with a `<Link>` to the detail page:

```tsx
<Link to="/app/activities/$id" params={{ id: task.id }} className="font-medium hover:underline">
  {task.body}
</Link>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/app.activities.\$id.tsx apps/web/src/features/activities/activity-feed.tsx apps/web/src/routes/app.tasks.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /app/activities/\$id detail page + feed/tasks links"
```

---

## Task 16: Cross-package validation + tag

**Files:** none new.

- [ ] **Step 1: Full test matrix**

Run: `pnpm -r test`
Expected: all packages green. Known pre-existing `tasks.routes.test.ts` flake may surface — re-run once; if still flaky, log and move on (unrelated).

- [ ] **Step 2: Typecheck + lint + format**

```bash
pnpm -r typecheck
pnpm lint
pnpm format:check || pnpm format
```

Expected: typecheck/lint clean, format pass produces no surprising changes.

- [ ] **Step 3: Manual smoke test**

Start the stack (`pnpm dev`). Sign up a fresh user. Then:

1. Settings → Custom Fields. Create a "Lead Source" select on Contacts with 3 options.
2. Create a contact. The create dialog shows Lead Source — pick "Referral", save.
3. Open the contact detail page — Lead Source shows "Referral", inline-editable.
4. Reload. The value persists.
5. Settings → Custom Fields → Notes. Create an "Outcome" text field.
6. Open a contact, add a note. The note form shows Outcome — fill it. Save.
7. From the activity feed row, click "Open ↗" → lands on `/app/activities/$id` showing the note body + Outcome field with the saved value.
8. From `/app/tasks`, click a task title → lands on detail page. Custom fields for tasks render. Try editing one — saves inline.
9. Delete a field from Settings. Confirm the dialog text mentions "values hidden but not erased." Field disappears from create dialog + detail page.

If anything is off, fix it before tagging.

- [ ] **Step 4: Stage formatter changes if any + commit**

```bash
git add -A
git diff --cached --stat
git commit -m "chore: lint + format after custom fields" || echo "nothing to commit"
```

- [ ] **Step 5: Tag + push**

```bash
git tag -a v0.1-custom-fields -m "Custom Fields sub-plan complete"
git push origin main
git push origin v0.1-custom-fields
```

---

## Deferred to a follow-up (not in this plan)

- **Drag-to-reorder fields** in the Settings page. The spec mentions a `⠿` drag handle backed by `@dnd-kit/sortable`. This plan ships ordered display only (sorted by `position` on the server) but no in-UI reordering — fields display in creation order. A user who wants reorder today can delete + re-create in the desired sequence. A follow-up of ~3 tasks (drag UI, batch-position PATCH endpoint, integration tests) lands this properly. Call it out as a known v1 gap when demoing.

## Implementer notes

- **Drizzle migrations on Windows**: if `pnpm --filter @dealflow/db generate` complains about missing pg-tools, run from the repo root with the Postgres bin on PATH (the project's CLAUDE.md / README explains the local Postgres setup).
- **TanStack Router file routes**: any new `app.*.tsx` route file requires regenerating `routeTree.gen.ts` — typecheck and build both do this automatically. If you see "route not found" errors after creating a new file, re-run `pnpm --filter @dealflow/web typecheck` once.
- **JSONB merge semantics**: when a PATCH sends only one custom field, the merge helper preserves all other keys. Server tests verify this.
- **No filter/sort/list-column work in this plan** — that's deferred to v2 (see spec's "Out of scope").
- **Activity composer is split** into `add-note-form.tsx` and `add-task-form.tsx` (no single `<ActivityComposer>` file). Wire `<CustomFieldsBlock entityType="note" />` into the note form and `entityType="task"` into the task form.
- **The merge helper is the source of truth** for validation; don't duplicate it in route handlers. Pass the patch in unchanged from the body schema.
