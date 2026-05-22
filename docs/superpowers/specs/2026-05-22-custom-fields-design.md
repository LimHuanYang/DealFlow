# Custom Fields — Design Spec

**Status:** Approved 2026-05-22, ready for implementation planning.
**Sub-plan position:** Phase 1, sub-plan 9 (post-Reports & Dashboard).
**Author:** Lim Huan Yang + Claude (DealFlow).

## Goal

Let an org's users define arbitrary structured fields on Contacts, Companies, Deals, and Activities, beyond the built-in columns. The most-requested capability when evaluating CRMs — most prospects compare on it.

**v1 boundary:** custom fields are editable and visible on detail pages and create-dialogs only. List views (the contacts/companies/deals tables) stay untouched. Filtering, sorting, and column-config by custom field are explicitly deferred to v2.

## Scope

Custom fields are supported on **all four** entity types:

- `contact`
- `company`
- `deal`
- `activity` (both notes and tasks share one definition set)

Each entity has an independent set of definitions per org. A Contacts "Lead Source" field is distinct from a Deals "Lead Source" field — they share no storage and need separate definitions.

**Note on activities:** notes and tasks both live in the `activities` table and share the `activity` entity type for custom fields. A definition named "Call outcome" therefore appears on both notes and tasks. If users later want note-only or task-only definitions, splitting `activity` → `note` | `task` is a v2 schema change (cheap — just a constant rename + UI tab split, no data migration since the entity_type column already exists in the definitions table).

## Field types (10)

| Type key       | UI control               | Stored shape         | Server validation                    |
|----------------|--------------------------|----------------------|--------------------------------------|
| `text`         | `<Input>` (single-line)  | `string` ≤ 500       | length cap                           |
| `long_text`    | `<textarea>`             | `string` ≤ 5000      | length cap                           |
| `number`       | `<Input type=number>`    | `number` (finite)    | `Number.isFinite`                    |
| `date`         | `<Input type=date>`      | `string` (YYYY-MM-DD)| ISO date regex                       |
| `boolean`      | `<Checkbox>`             | `boolean`            | `z.boolean()`                        |
| `select`       | `<Select>`               | `string` (option key)| value ∈ defined options              |
| `multi_select` | chips / multi-select     | `string[]`           | every entry ∈ defined options        |
| `url`          | `<Input type=url>`       | `string`             | URL regex; rendered as clickable link|
| `email`        | `<Input type=email>`     | `string`             | email regex; rendered as `mailto:`   |
| `phone`        | `<Input type=tel>`       | `string`             | loose phone regex; rendered as `tel:`|

The 10 types share most rendering logic — type is just a discriminator on the definition row that drives input choice + validation.

## Storage — hybrid (definitions table + JSONB on each entity)

### `custom_field_definitions` (new table)

```sql
CREATE TABLE custom_field_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,         -- 'contact' | 'company' | 'deal' | 'activity'
  name            text NOT NULL,         -- display label, editable
  type            text NOT NULL,         -- one of the 10 type keys above
  options         jsonb,                 -- nullable; { values: [{key,label}] } for select/multi_select
  required        boolean NOT NULL DEFAULT false,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, name)
);

CREATE INDEX custom_field_definitions_org_entity_idx
  ON custom_field_definitions (organization_id, entity_type, position);
```

- Org-scoped tenant isolation via `organization_id`. Every read filters on it.
- `(organization_id, entity_type, name)` unique prevents duplicate "Lead Source" fields on the same entity.
- `position` is a soft ordering — gaps allowed, reorder rewrites a contiguous list.
- `options` is `null` for non-select types. For `select`/`multi_select` it's `{ values: [{ key: string, label: string }] }` — UUID-stable keys so labels can be renamed without rewriting stored values.

### JSONB columns on parent tables

```sql
ALTER TABLE contacts   ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE companies  ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE deals      ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE activities ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';
```

**Shape:** `{ "<field-definition-uuid>": <typed-value> }`. The key is the definition's UUID (stable across renames). The value matches the "Stored shape" column in the field-types table above.

**Why field UUIDs as keys, not slugs or names:** renaming "Lead Source" → "Source" must not orphan existing values. UUID is the only key that's robust against rename, re-case, and reorder.

**Orphan tolerance:** when a definition is deleted, the JSONB key for it is *not* cleaned up — it stays in the parent row but renders nowhere (no definition to look up). Harmless, and lets us defer a "definition restore" feature without losing data. The deletion dialog should be honest: "Data is preserved internally but a re-created field gets a new ID, so values won't reappear automatically."

## API surface

All routes are org-scoped via `requireOrg` preHandler. Schemas live in `@dealflow/shared/src/custom-fields.ts`.

### Definitions CRUD

- `GET /api/v1/custom-fields?entity=<contact|company|deal|activity>` — list definitions for that entity type. Response: `CustomFieldDefinition[]` sorted by `position`.
- `POST /api/v1/custom-fields` — body: `{ entityType, name, type, options?, required?, position? }`. Returns the created definition.
- `PATCH /api/v1/custom-fields/:id` — partial: `{ name?, options?, required?, position? }`. `type` and `entityType` are immutable post-create (would invalidate stored values).
- `DELETE /api/v1/custom-fields/:id` — hard delete. Orphan JSONB values are NOT touched.

### Entity routes get a `customFields` field

Existing endpoints extended:

- **GET / list endpoints** for `/contacts`, `/companies`, `/deals`, `/activities` — response shape gains `customFields: Record<string, unknown>`. Frontend cross-references with the definitions list to render.
- **POST (create) and PATCH (update)** for the same four entities accept an optional `customFields` body field. Server-side flow:
  1. Load active definitions for the requesting org + entity type.
  2. Validate every supplied key against a definition (unknown keys → 400).
  3. Type-coerce + validate each value against its definition's type (out-of-range → 400 with per-field error).
  4. If `required: true` on any definition and the entity is being created (or has no current value), enforce non-null.
  5. Merge into the existing JSONB column (`existing || patched`).

The merge happens in a shared helper (`packages/api/src/lib/custom-fields-merge.ts` or similar) — reused across all four entity repos to avoid drift.

## UI

### New Settings page: `/app/settings/custom-fields`

Linked from the main Settings page. Layout (from approved mockup):

- Top: breadcrumb `Settings → Custom Fields`.
- 4 tabs: Contacts · Companies · Deals · Activities. Active tab styling matches existing nav patterns.
- Per-tab: sortable list of definitions with `⠿` drag handle, name, type label, "Required" badge, `✎ Edit` and `🗑 Delete` row actions.
- `[+ Add field]` button top-right opens the editor dialog.
- Empty state: "No custom fields yet — click + Add field to create one."

Reorder uses `@dnd-kit` (already a project dependency from the deals board). Drop → batched PATCH to update affected `position` values.

### `<CustomFieldEditor>` dialog

Shared component for create + edit. Fields:

- Name (text, required, unique check via client + server)
- Type (select dropdown — disabled in edit mode since type changes break stored values)
- Type-specific config:
  - `select` / `multi_select`: options textarea (one per line) — each line becomes `{ key: kebab-case-from-label, label }`. Editing an existing field preserves keys so stored values don't orphan.
  - `number`: optional min/max (deferred to v2 — v1 is unbounded finite)
  - Others: no extra config
- Required toggle (checkbox)

Submit calls the appropriate POST or PATCH.

### `<CustomFieldsBlock>` component

Renders on each entity's detail page below the built-in details section. Embedded in the 4 create-dialogs too.

Behaviour:

- Fetches definitions for the entity type (cached query key per `(orgId, entityType)`).
- Renders one row per active definition in `position` order. Empty value → empty input (placeholder hints what to type).
- Inline-edit pattern matches existing detail pages: click to enter edit mode, blur or Enter to save via the entity PATCH endpoint with `{ customFields: { [defId]: newValue } }`. Server returns the updated entity; cache updates.
- On validation error from the API, surface the field-specific error message under the input.
- If a definition is deleted while the page is open, the row disappears on next definitions refetch.

### Wiring into existing screens

| Existing screen                          | Change                                                       |
|------------------------------------------|--------------------------------------------------------------|
| Settings page (`/app/settings`)          | Add "Custom Fields" link/section                             |
| Contact detail page                      | Add `<CustomFieldsBlock entityType="contact" />` below built-in fields |
| Company detail page                      | Add `<CustomFieldsBlock entityType="company" />`             |
| Deal detail page                         | Add `<CustomFieldsBlock entityType="deal" />`                |
| ActivityFeed item (in `<ActivityComposer>`)  | When an activity row enters edit mode, expand to show `<CustomFieldsBlock entityType="activity" />` below the body editor. Read-only display shows custom field values inline under the activity body. |
| `<CreateContactDialog>`                  | Embed block; submit includes `customFields` in POST body     |
| `<CreateCompanyDialog>`                  | Same                                                         |
| `<CreateDealDialog>`                     | Same                                                         |
| Activity create flow (`<ActivityComposer>`)  | Embed block before the Submit button; submit includes `customFields` |

**Activities-specific note:** activities are created and edited inline within `<ActivityFeed>` / `<ActivityComposer>` — there's no dedicated `/app/activities/$id` detail route. The custom-fields surface for activities is therefore the composer (for create) and the inline editor (for edit). The implementer should locate the existing composer + edit affordance in `apps/web/src/features/activities/` and embed `<CustomFieldsBlock>` in both places.

## Validation & edge cases

### Validation rules (server-side, Zod)

- Per-type validators as listed in the field-types table.
- `name` length 1-50; trimmed before save.
- Unknown `customFields` keys (no matching definition) → 400 with `details.<key>: 'unknown_field'`.
- `required: true` definitions: if absent on create, return 400; on update they may remain absent (no implicit clear).
- `select` / `multi_select`: values must be option keys, not labels.

### Deletion semantics

Hard delete. Confirmation dialog text:

> "Delete the custom field **{name}**? Values stored on existing {entities} will be hidden but not erased; if you re-create a field with the same name later it gets a new internal ID, so those values won't reappear automatically."

No automatic JSONB cleanup. The orphan keys are harmless (don't render) and let us add a "recover deleted field" feature later by un-deleting the definition row (deferred — v2).

### Rename + reorder

- **Renames** change `name` only. JSONB stays untouched because keys are UUIDs.
- **Reorder** is a batched PATCH that rewrites `position` for affected rows.
- **Type changes** are forbidden post-create — the editor disables the type dropdown when editing. If someone needs to "change type", they delete and re-create.

### Tenancy

- Every definition query filters by `organization_id`. Tested via integration tests.
- JSONB values can technically be arbitrary, but the validation pipeline rejects anything that doesn't match an active definition for the requesting org.

## Test strategy

### Backend integration tests (vitest + per-test Postgres, matching the dashboard pattern)

- `custom-fields.routes.test.ts`:
  - CRUD on definitions — happy paths for create / read / update / delete.
  - Tenant isolation: org A can't see org B's definitions.
  - Unique constraint on `(org, entity_type, name)`.
  - Type immutability: PATCH with new `type` rejected.
  - Position reorder is reflected on next list.
- `contacts.routes.test.ts` (extend existing):
  - PATCH with valid `customFields` merges + returns updated row.
  - PATCH with unknown field key → 400.
  - PATCH with wrong-type value → 400 (per type: text-too-long, number-NaN, date-bad-format, select-invalid-option, etc.).
  - Required field missing on create → 400.
- Mirror the above subset for companies, deals, activities.

### Frontend

- `<CustomFieldEditor>` — type-specific config sections render correctly.
- `<CustomFieldsBlock>` — renders one row per definition, inline-save round-trip.
- Smoke test: create a Contact custom field via Settings, then save a value on a contact detail page, then see it persist after refresh.

## Task estimate (~13 tasks)

1. Shared schemas (`packages/shared/src/custom-fields.ts`) — definition shape + value-validation helpers.
2. Drizzle migration: `custom_field_definitions` table + 4 JSONB columns + indexes.
3. Backend `CustomFieldsRepo` + CRUD routes (`/api/v1/custom-fields`).
4. Backend shared helper: `validateAndMergeCustomFields()` used by all 4 entity update paths.
5. Backend: extend `contacts`, `companies`, `deals`, `activities` PATCH + POST to validate & merge `customFields`. Extend their GET / list to return the column.
6. Frontend API hooks: `useCustomFields(entityType)`, `useCreateCustomField`, `useUpdateCustomField`, `useDeleteCustomField`.
7. New page `/app/settings/custom-fields` — 4 tabs + sortable table.
8. `<CustomFieldEditor>` dialog.
9. `<CustomFieldsBlock>` component (read + inline-save).
10. Wire `<CustomFieldsBlock>` into the 4 detail pages.
11. Wire `<CustomFieldsBlock>` into the 4 create-dialogs.
12. Cross-package typecheck + lint + format + manual smoke.
13. Tag `v0.1-custom-fields` + push.

## Out of scope (deferred to v2)

- Custom fields as list-view columns (configurable column display).
- Filter / sort by custom field.
- Number type min/max constraints.
- Recover-deleted-field flow.
- Bulk-import / API-level "is required on import" enforcement (the import sub-plan, if/when it lands, can handle this).
- Custom field history / audit log.
- File / attachment field type.

## Open questions

None — all design choices answered during brainstorming on 2026-05-22.
