# AI Natural-Language Search — Design Spec

> **Visual mockup:** `docs/superpowers/specs/2026-06-10-ai-nl-search-design-mockup.html` (open in a browser).
> **Date:** 2026-06-10 · **Status:** Approved (design) · **Scope:** P0 wedge feature for DealFlow (SEA SMB, solo-buildable).

## 1. Goal
Let a user type a plain-English / Bahasa / Manglish query (e.g. *"deals over RM50k closing this month with no activity in 2 weeks"*) into a command bar and get the exact filtered list — making DealFlow feel AI-native, with **no external services** (reuses the existing `@dealflow/ai` chain). Success: common deal/contact/company queries return correct, tenant-safe results, with the AI's interpretation shown transparently and editable.

## 2. UX
- **Global command bar**, opened by a keyboard shortcut from anywhere in the app.
  - **OS-aware shortcut (required):** show **`⌘K`** on macOS and **`Ctrl+K`** on Windows/Linux. Detect once: `const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)`. Bind `e.metaKey` on Mac, `e.ctrlKey` otherwise. The displayed glyph (in the trigger button, placeholder, and footer hints) and the bound modifier MUST match the OS. Same rule for the secondary **`⌘E` / `Ctrl+E`** ("edit as filters") hint.
  - Built on the shadcn **Command** component (`cmdk`).
- **Entity scope:** the bar searches the current entity context (Deals / Contacts / Companies); a small entity toggle lets the user switch. Default to the page they're on, else Deals.
- **Interpreted-filter chips (trust layer):** after the query runs, render the parsed filter as removable chips (e.g. `value > RM50,000` `×`). Removing a chip re-runs without it. A footer action (`⌘E`/`Ctrl+E`) drops into the existing manual filters pre-populated from the DSL.
- **Results** render in the existing list view/components for that entity. Footer shows result count + latency.
- **Errors:** if the AI can't map the query (or emits an invalid/over-broad filter), show "Couldn't understand that — try rephrasing, or use filters" and offer the manual-filter fallback. Never silently return everything.

## 3. Architecture (safe by design)
```
query ─▶ POST /api/v1/ai/nl-search {query, entity}
      ─▶ per-org AI provider (buildAIProvider) .nlFilter({query, entity})
      ─▶ AI returns a constrained FilterDSL (JSON only, from an allow-list)
      ─▶ server Zod-validates the DSL (reject unknown fields/operators)
      ─▶ translate DSL → existing entity list query (org-scoped, role-gated)
      ─▶ return { filter, interpretation, results }
```
**Invariant:** the AI never sees the DB and never emits SQL. It only produces a small JSON FilterDSL constrained to an allow-list of fields/operators per entity. The server validates with Zod and executes the **same** query path the manual filters use, so tenancy (org scope) and role/ownership gating are enforced server-side regardless of what the AI returns.

## 4. FilterDSL (allow-listed)
A discriminated union by `entity`, each a list of `{ field, op, value }` conditions (implicitly AND-ed in v1) plus optional `sort` + `limit`. Allow-listed fields:
- **deals:** `value` (gt/lt/between), `stage`, `ownerUserId` (`=me`), `expectedCloseDate` (relative: thisMonth / nextNDays / overdue), `status` (open/won/lost), `daysSinceActivity` (gt), `daysInStage` (gt), `companyId`, `createdAt` (lastNDays). sort: `value` | `expectedCloseDate`.
- **contacts:** `companyId`, `ownerUserId`, `city`, `daysSinceEmail`/`hasActivity`, `createdAt`, selected custom fields.
- **companies:** `ownerUserId`, `openDealCount` (=0 / gt0), `totalOpenValue` (gt/lt), `createdAt`, selected custom fields.

Relative dates (`thisMonth`, `lastNDays`, `overdue`) are resolved **server-side** to concrete ranges so the AI never computes dates. Unknown field/op → validation error.

## 5. Shared (`@dealflow/shared`)
- `nlSearchBodySchema` = `{ query: z.string().min(1).max(500), entity: z.enum(['deals','contacts','companies']) }`.
- `filterDslSchema` — the Zod allow-list (per-entity union above); exported type `FilterDsl`.
- `nlSearchResponseSchema` = `{ filter, interpretation: string, results: <entity DTO[]> }`.
- New error code: `NL_SEARCH_UNPARSEABLE`.

## 6. Backend (`apps/api`, `packages/ai`)
- **`packages/ai`:** implement `nlFilter(input)` in the real providers (Gemini primary; Anthropic/Grok same shape) — prompt the model to output ONLY a JSON FilterDSL for the given entity from the allow-list; parse + return `{ filter }`. The provider does not execute anything. (Noop/fallback keep throwing `AIDisabledError`.)
- **`apps/api/src/modules/ai/routes.ts`:** add `POST /api/v1/ai/nl-search` (mirrors the draft-email/summarize endpoints: `requireOrg`, build per-org provider via `OrgIntegrationsRepo`, or `aiProviderForOrg` test override). Flow: validate body → `provider.nlFilter` → **Zod-validate the returned DSL** (`filterDslSchema`) → on failure return `NL_SEARCH_UNPARSEABLE` → else translate DSL to the entity repo's existing list query (org-scoped) → return filter + interpretation + results. Build a human-readable `interpretation` string from the validated DSL.
- **Repos:** extend `deals`/`contacts`/`companies` list queries with the derived predicates the DSL needs (e.g. `daysSinceActivity`, `openDealCount`) **only where not already supported**; reuse existing filters otherwise. Keep all tenancy/role gating.

## 7. Frontend (`apps/web`)
- `features/search/` — `CommandBar.tsx` (shadcn Command dialog), `use-os-shortcut.ts` (returns `{ isMac, modLabel: '⌘'|'Ctrl', matches(e) }`), `api.ts` (`useNlSearch` mutation hitting `/ai/nl-search`), `interpreted-chips.tsx`.
- Mount the bar + global key listener in the app layout; trigger button in the header shows the OS-correct hint.
- Results reuse the existing list row components per entity; `⌘E`/`Ctrl+E` routes to the entity list page with filters pre-applied from the DSL.

## 8. Reuse (don't rebuild)
`nlFilter()` interface (`packages/ai/src/provider.ts:47`) · AI chain + per-org provider resolution (`apps/api/src/modules/ai/routes.ts`) · `OrgIntegrationsRepo` (per-org AI key) · deals/contacts/companies list repos + query params · existing list UI + TanStack query hooks · shadcn `Command`.

## 9. Scope
**In v1:** ⌘K/Ctrl+K command bar on Deals/Contacts/Companies; `nlFilter` provider impl (Gemini) + FilterDSL; `/ai/nl-search` endpoint + Zod allow-list validation; interpreted chips + manual fallback; BM/Manglish; results in existing list; tests.
**Out (later):** cross-entity joins; saved/shared views; semantic/embeddings search; NL over activities/tasks/emails; voice; OR-logic between conditions.

## 10. Testing
- **Shared:** `filterDslSchema` accepts valid DSLs, rejects unknown fields/operators + over-broad/empty.
- **Provider:** `nlFilter` builds the right prompt + parses a JSON DSL (mock the model); Noop throws.
- **API (schema-per-test):** `/ai/nl-search` — valid query → correct filtered results; org B cannot see org A rows (tenancy); invalid AI output → `NL_SEARCH_UNPARSEABLE`; member role respects ownership gating; relative dates resolve server-side.
- **Web:** `use-os-shortcut` returns ⌘ on Mac UA and Ctrl on Windows UA and binds the matching modifier; CommandBar renders chips from a DSL.

## 11. Risks
- **Hallucinated fields/values** → Zod allow-list rejects; prompt pins the schema; fallback to keyword/manual.
- **Ambiguous queries** → interpreted chips make the read visible + editable.
- **Cost/latency** → small fast model (Gemini Flash), cap query length, debounce; it's the AI tokens already used elsewhere.
- **Over-broad results** → require ≥1 condition or an explicit "all"; default `limit`.
