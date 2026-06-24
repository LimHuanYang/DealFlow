# AI Natural-Language Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ⌘K/Ctrl+K command bar where a user types plain-English/Bahasa queries and gets the exact filtered list — the AI emits a constrained FilterDSL, the server Zod-validates it and runs an org-scoped query.

**Architecture:** `query → POST /api/v1/ai/nl-search → per-org AI provider.nlFilter → constrained FilterDSL (JSON) → Zod allow-list validate → org-scoped Drizzle query → results + interpretation`. The AI never sees the DB or emits SQL.

**Tech Stack:** Fastify + Drizzle + Supabase + Vitest; `@dealflow/ai` (Gemini); React 19 + TanStack Query + shadcn `cmdk` (already installed); Zod (`@dealflow/shared`).

**Spec:** `docs/superpowers/specs/2026-06-10-ai-nl-search-design.md` · **Mockup:** `…-ai-nl-search-design-mockup.html`

---

## File Structure
- **Create** `packages/shared/src/nl-search.ts` (+ `.test.ts`) — FilterDSL + request/response schemas.
- **Modify** `packages/shared/src/index.ts`, `packages/shared/src/error.ts` (add `NL_SEARCH_UNPARSEABLE`).
- **Modify** `packages/ai/src/provider.ts` (type `NlFilterOutput.filter` as `FilterDsl`), `packages/ai/src/providers/gemini.ts` (+ `.test.ts`) — implement `nlFilter`.
- **Create** `apps/api/src/modules/ai/nl-search.ts` (+ test `apps/api/test/modules/ai/nl-search.test.ts`) — DSL→Drizzle translation + executor.
- **Modify** `apps/api/src/modules/ai/routes.ts` — add `POST /api/v1/ai/nl-search`.
- **Create** `apps/web/src/features/search/use-os-shortcut.ts` (+ test), `command-bar.tsx`, `interpreted-chips.tsx`, `api.ts`.
- **Modify** the app layout to mount `<CommandBar/>`.

> **Scope note:** Tasks 1–5 implement the **Deals** entity end-to-end (vertical slice). Task 6 replicates the query translator for **Contacts** + **Companies**. This ships value fast and proves the pattern before fanning out.

---

## Task 1: Shared FilterDSL + schemas

**Files:** Create `packages/shared/src/nl-search.ts`, `packages/shared/src/nl-search.test.ts`; Modify `packages/shared/src/index.ts`, `error.ts`.

- [ ] **Step 1: Write failing test** (`nl-search.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { dealsFilterSchema, nlSearchBodySchema } from './nl-search.js';

describe('dealsFilterSchema', () => {
  it('accepts a valid deals filter', () => {
    const r = dealsFilterSchema.safeParse({
      entity: 'deals',
      conditions: [
        { field: 'value', op: 'gt', value: 50000 },
        { field: 'expectedCloseDate', op: 'within', value: 'thisMonth' },
        { field: 'daysSinceActivity', op: 'gt', value: 14 },
      ],
      sort: { field: 'value', dir: 'desc' },
      limit: 50,
    });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown field', () => {
    expect(dealsFilterSchema.safeParse({ entity: 'deals', conditions: [{ field: 'secret', op: 'gt', value: 1 }] }).success).toBe(false);
  });
  it('rejects an empty conditions array (no over-broad "everything")', () => {
    expect(dealsFilterSchema.safeParse({ entity: 'deals', conditions: [] }).success).toBe(false);
  });
});

describe('nlSearchBodySchema', () => {
  it('requires a non-empty query and a known entity', () => {
    expect(nlSearchBodySchema.safeParse({ query: 'big deals', entity: 'deals' }).success).toBe(true);
    expect(nlSearchBodySchema.safeParse({ query: '', entity: 'deals' }).success).toBe(false);
    expect(nlSearchBodySchema.safeParse({ query: 'x', entity: 'invoices' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @dealflow/shared test nl-search` — Expected: cannot find `./nl-search.js`.

- [ ] **Step 3: Implement** `nl-search.ts`:
```typescript
import { z } from 'zod';

const dealCondition = z.discriminatedUnion('field', [
  z.object({ field: z.literal('value'), op: z.enum(['gt', 'lt', 'between']), value: z.union([z.number(), z.tuple([z.number(), z.number()])]) }),
  z.object({ field: z.literal('stage'), op: z.literal('eq'), value: z.string().min(1) }),
  z.object({ field: z.literal('ownerUserId'), op: z.literal('eq'), value: z.string().min(1) }), // 'me' or a uuid
  z.object({ field: z.literal('status'), op: z.literal('eq'), value: z.enum(['open', 'won', 'lost']) }),
  z.object({ field: z.literal('expectedCloseDate'), op: z.literal('within'), value: z.union([z.enum(['thisMonth', 'overdue']), z.object({ nextDays: z.number().int().positive() })]) }),
  z.object({ field: z.literal('daysSinceActivity'), op: z.literal('gt'), value: z.number().int().nonnegative() }),
  z.object({ field: z.literal('createdAt'), op: z.literal('within'), value: z.object({ lastDays: z.number().int().positive() }) }),
]);

export const dealsFilterSchema = z.object({
  entity: z.literal('deals'),
  conditions: z.array(dealCondition).min(1).max(8),
  sort: z.object({ field: z.enum(['value', 'expectedCloseDate', 'createdAt']), dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

// Contacts/Companies added in Task 6 — union grows then.
export const filterDslSchema = dealsFilterSchema;
export type FilterDsl = z.infer<typeof filterDslSchema>;

export const nlSearchBodySchema = z.object({
  query: z.string().min(1).max(500),
  entity: z.enum(['deals', 'contacts', 'companies']),
});
export type NlSearchBody = z.infer<typeof nlSearchBodySchema>;
```

- [ ] **Step 4: Add error code** in `error.ts` (inside `ERROR_CODES`): `NL_SEARCH_UNPARSEABLE: 'NL_SEARCH_UNPARSEABLE',`

- [ ] **Step 5: Export** in `index.ts`: `export * from './nl-search.js';`

- [ ] **Step 6: Run → pass.** `pnpm --filter @dealflow/shared test nl-search` (3+2 cases) + `pnpm --filter @dealflow/shared typecheck`.

- [ ] **Step 7: Commit.** `git add packages/shared && git commit -m "feat(shared): NL-search FilterDSL + request schemas"`

---

## Task 2: Implement `nlFilter` in the AI provider (Gemini)

**Files:** Modify `packages/ai/src/provider.ts` (type the output), `packages/ai/src/providers/gemini.ts`; Test `packages/ai/src/providers/gemini.test.ts`.

- [ ] **Step 1: Type the output.** In `provider.ts` change `NlFilterOutput` to `{ filter: FilterDsl }` — import `type { FilterDsl } from '@dealflow/shared'` and replace the `unknown` on line 29.

- [ ] **Step 2: Write failing test** (add to `gemini.test.ts`):
```typescript
it('nlFilter prompts for a JSON FilterDSL and parses the model output', async () => {
  const fakeModel = vi.fn(async () => JSON.stringify({ entity: 'deals', conditions: [{ field: 'value', op: 'gt', value: 50000 }] }));
  const provider = new GeminiAIProvider({ apiKey: 'k', model: 'gemini-2.5-flash', generate: fakeModel });
  const out = await provider.nlFilter({ query: 'deals over 50k', entity: 'deals' });
  expect(out.filter).toEqual({ entity: 'deals', conditions: [{ field: 'value', op: 'gt', value: 50000 }] });
  const prompt = fakeModel.mock.calls[0][0] as string;
  expect(prompt).toContain('deals over 50k');
  expect(prompt.toLowerCase()).toContain('json');
});
```
(Match the existing `GeminiAIProvider` constructor/generate seam used by the other gemini tests — mirror how `draftEmail` is tested in this file.)

- [ ] **Step 3: Run → fail.** `pnpm --filter @dealflow/ai test gemini` — Expected: nlFilter still throws / returns wrong shape.

- [ ] **Step 4: Implement** `nlFilter` in `gemini.ts` (replace the stub at ~line 66): build a prompt that (a) states the allowed fields/ops per entity, (b) gives the user query, (c) instructs "output ONLY a JSON object matching the schema, no prose", call the model, `JSON.parse` (strip code fences), return `{ filter: parsed }`. Do NOT validate here — the route Zod-validates. Keep the SEA/Manglish instruction ("interpret Malay/Manglish sales phrasing").

- [ ] **Step 5: Run → pass.** `pnpm --filter @dealflow/ai test gemini` + `pnpm --filter @dealflow/ai typecheck`.

- [ ] **Step 6: Commit.** `git add packages/ai packages/shared && git commit -m "feat(ai): implement nlFilter (Gemini) -> JSON FilterDSL"`

---

## Task 3: Endpoint + DSL→Drizzle executor (Deals)

**Files:** Create `apps/api/src/modules/ai/nl-search.ts`; Modify `apps/api/src/modules/ai/routes.ts`; Test `apps/api/test/modules/ai/nl-search.test.ts`.

- [ ] **Step 1: Write the pure-translator failing test** (`nl-search.test.ts`, unit part):
```typescript
import { describe, it, expect } from 'vitest';
import { buildDealsWhere } from '../../../src/modules/ai/nl-search.js';
import { schema } from '@dealflow/db';

it('buildDealsWhere maps value>50000 + thisMonth to predicates (org-scoped)', () => {
  const { sqlChunks } = buildDealsWhere(
    { entity: 'deals', conditions: [{ field: 'value', op: 'gt', value: 50000 }, { field: 'expectedCloseDate', op: 'within', value: 'thisMonth' }] },
    { orgId: 'org-1', userId: 'u-1', now: new Date('2026-06-10T00:00:00Z') },
  );
  // org filter is always present; at least 2 extra predicates added
  expect(sqlChunks.length).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @dealflow/api exec vitest run test/modules/ai/nl-search.test.ts` — module missing.

- [ ] **Step 3: Implement** `nl-search.ts`: export `buildDealsWhere(filter, { orgId, userId, now })` returning `{ sqlChunks }` (array of Drizzle conditions, always starting with `eq(schema.deals.organizationId, orgId)`), translating each condition: `value` → `gt/lt/between(schema.deals.value, …)`; `stage` → join/eq on stage name; `ownerUserId 'me'` → `eq(ownerUserId, userId)`; `status` → eq; `expectedCloseDate within thisMonth/overdue/nextDays` → resolve to date range **server-side** from `now`; `daysSinceActivity gt N` → subquery/`lastActivityAt < now-N`; `createdAt within lastDays` → range. Also export `runNlSearch(db, filter, ctx)` that `and(...sqlChunks)`, applies sort/limit, queries `schema.deals`, returns the public deal DTO[]; and `describeFilter(filter): string` for the interpretation. Resolve relative dates from `ctx.now` (injectable for tests).

- [ ] **Step 4: Run → pass.** Re-run the unit test.

- [ ] **Step 5: Write the route integration test** (schema-per-test):
```typescript
it('POST /ai/nl-search returns org-scoped filtered deals', async () => {
  const { app, db } = await setup(); // buildTestApp with aiProviderForOrg override returning a fixed FilterDSL
  // seed: org with 2 deals (one value 76000, one 1000) ...
  const res = await app.inject({ method: 'POST', url: '/api/v1/ai/nl-search',
    headers: { cookie }, payload: { query: 'deals over 50k', entity: 'deals' } });
  expect(res.statusCode).toBe(200);
  expect(res.json().results).toHaveLength(1);
  expect(res.json().interpretation).toContain('value');
});
it('invalid AI output -> NL_SEARCH_UNPARSEABLE', async () => { /* aiProviderForOrg returns {filter:{bad}} */ });
it('org B cannot see org A deals (tenancy)', async () => { /* seed two orgs */ });
```
Use `buildTestApp`'s `aiProviderForOrg` override to return a deterministic `nlFilter` result (no real model in tests).

- [ ] **Step 6: Add the route** in `routes.ts` mirroring `draft-email`: `app.post('/api/v1/ai/nl-search', { preHandler: requireOrg }, …)` → parse `nlSearchBodySchema` → resolve provider → `provider.nlFilter` → `filterDslSchema.safeParse(out.filter)` → on fail `reply.code(422).send({ error: { code: ERROR_CODES.NL_SEARCH_UNPARSEABLE, … } })` → else `runNlSearch(db, filter, { orgId, userId, now: new Date() })` → `reply.send({ filter, interpretation: describeFilter(filter), results })`.

- [ ] **Step 7: Run → pass** (`vitest run test/modules/ai/nl-search.test.ts`) + `pnpm --filter @dealflow/api typecheck`.

- [ ] **Step 8: Commit.** `git add apps/api && git commit -m "feat(api): /ai/nl-search endpoint + deals DSL->query (org-scoped, validated)"`

---

## Task 4: Web — OS-aware shortcut + command bar (Deals)

**Files:** Create `apps/web/src/features/search/use-os-shortcut.ts` (+ `.test.ts`), `command-bar.tsx`, `interpreted-chips.tsx`, `api.ts`; Modify the app layout.

- [ ] **Step 1: Write failing test for the OS hook** (`use-os-shortcut.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { resolveShortcut } from './use-os-shortcut.js';

it('shows ⌘ + binds metaKey on macOS', () => {
  const s = resolveShortcut('MacIntel');
  expect(s.modLabel).toBe('⌘');
  expect(s.matches({ key: 'k', metaKey: true, ctrlKey: false })).toBe(true);
  expect(s.matches({ key: 'k', metaKey: false, ctrlKey: true })).toBe(false);
});
it('shows Ctrl + binds ctrlKey on Windows/Linux', () => {
  const s = resolveShortcut('Win32');
  expect(s.modLabel).toBe('Ctrl');
  expect(s.matches({ key: 'k', metaKey: false, ctrlKey: true })).toBe(true);
  expect(s.matches({ key: 'k', metaKey: true, ctrlKey: false })).toBe(false);
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @dealflow/web exec vitest run src/features/search/use-os-shortcut.test.ts`.

- [ ] **Step 3: Implement** `use-os-shortcut.ts`:
```typescript
export function resolveShortcut(platform: string) {
  const isMac = /Mac|iPhone|iPad/i.test(platform);
  return {
    isMac,
    modLabel: isMac ? '⌘' : 'Ctrl',
    keyLabel: isMac ? '⌘K' : 'Ctrl+K',
    matches: (e: { key: string; metaKey: boolean; ctrlKey: boolean }) =>
      e.key.toLowerCase() === 'k' && (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey),
  };
}
export function useOsShortcut() {
  return resolveShortcut(typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : '');
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Build the command bar** (`command-bar.tsx`): use the existing shadcn `@/components/ui/command` (`cmdk`); a `CommandDialog` toggled by a global `keydown` listener using `useOsShortcut().matches(e)` (preventDefault); an input → on submit calls `useNlSearch`; render `InterpretedChips` from the response `filter` + the `results` list; the trigger button + footer show `shortcut.keyLabel`. `api.ts`: `useNlSearch()` mutation → `apiFetch('/api/v1/ai/nl-search', { method:'POST', body })`. `interpreted-chips.tsx`: render each condition as a removable chip from `describeFilter`-style labels.

- [ ] **Step 6: Mount** `<CommandBar/>` in the authenticated app layout (e.g. `apps/web/src/routes/app.tsx` or the shell) so ⌘K/Ctrl+K works app-wide.

- [ ] **Step 7: Typecheck + live check.** `pnpm --filter @dealflow/web exec tsc --noEmit`; with the stack up, press Ctrl+K, run "deals over 50k", confirm chips + results.

- [ ] **Step 8: Commit.** `git add apps/web && git commit -m "feat(web): ⌘K/Ctrl+K AI search command bar (OS-aware shortcut)"`

---

## Task 5: Contacts + Companies (replicate the slice)

**Files:** Modify `packages/shared/src/nl-search.ts` (add `contactsFilterSchema`, `companiesFilterSchema`; make `filterDslSchema` a discriminated union by `entity`); `apps/api/src/modules/ai/nl-search.ts` (`buildContactsWhere`, `buildCompaniesWhere`, dispatch by entity); the Gemini prompt (per-entity field list); the command bar entity toggle.

- [ ] **Step 1–N (TDD each):** mirror Tasks 1+3 for contacts (`companyId`, `ownerUserId`, `city`, `daysSinceEmail`, `createdAt`) and companies (`ownerUserId`, `openDealCount`, `totalOpenValue`, `createdAt`). Add schema tests, translator unit tests, and one route test per entity (incl. tenancy). Update `runNlSearch`/`describeFilter` to dispatch on `filter.entity`. Commit per entity.

---

## Task 6: Cross-package validation + tag

- [ ] **Step 1:** `pnpm -r typecheck` → clean.
- [ ] **Step 2:** `pnpm --filter @dealflow/shared test` + `pnpm --filter @dealflow/ai test` + `pnpm --filter @dealflow/api exec vitest run test/modules/ai` → green.
- [ ] **Step 3:** Live smoke: Ctrl+K (Win) / ⌘K (Mac) → 3 queries across deals/contacts/companies → correct results + chips; a nonsense query → graceful "couldn't understand" (NL_SEARCH_UNPARSEABLE).
- [ ] **Step 4:** Commit + `git tag -a ai-nl-search -m "AI natural-language search (command bar)"` + push.

---

## Self-Review
**Spec coverage:** §2 UX/OS-shortcut → T4 (resolveShortcut + tests, both OS); §3 architecture → T3; §4 FilterDSL → T1 (deals) + T5 (contacts/companies); §5 shared schemas → T1; §6 backend (provider + endpoint) → T2 + T3; §7 frontend → T4; §8 reuse → cmdk/command.tsx confirmed present, ai/routes pattern reused; §9 scope → T1-5 in, joins/saved-views out; §10 testing → each task TDD + T6; §11 risks → Zod validate (T1/T3), chips (T4), relative-date server-side (T3), min-1-condition (T1).
**Placeholder scan:** the only deferred specifics are the exact Drizzle column refs + the Gemini constructor seam, both pinned to "mirror the existing `draftEmail`/list pattern in the named file" — concrete, not TBD. OS-shortcut (the explicit ask) is fully coded + tested.
**Type consistency:** `FilterDsl` (T1) consumed by `NlFilterOutput` (T2), `filterDslSchema.safeParse` (T3), `buildDealsWhere`/`runNlSearch`/`describeFilter` (T3) used by the route (T3) and reused in T5; `resolveShortcut` shape (T4) matches its test.
