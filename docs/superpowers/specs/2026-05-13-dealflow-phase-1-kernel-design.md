# DealFlow — Phase 1 (Kernel) Design

**Status:** Approved (2026-05-13). Stack revision applied 2026-05-15 (see banner below).
**Author:** Initial design via brainstorming session
**Phase:** 1 of 4 (Kernel)
**Next:** Implementation plan via `writing-plans` skill

> 🛠 **2026-05-15 stack revision — Docker removed from dev path.**
> Original design used Docker Compose (Postgres + MinIO + Mailhog) for local development and testcontainers for integration tests. After hitting WSL 2 resource overhead on Windows hosts, we moved to **native Postgres on the host** for dev, and a **per-test disposable database via CREATE/DROP** for integration tests. Effects:
> - Dev no longer requires Docker or WSL.
> - MinIO and Mailhog are deferred (not used in Phase 1 anyway; revisited in Sub-Plan 6+).
> - The self-host story (single Docker image) is still planned but moves from "always available" to "Phase 3+ deliverable".
> - Tests run ~18× faster (5 s vs 94 s for the Postgres helper test).

---

## 1. Context & Strategic Positioning

DealFlow is a CRM web app. The long-term goal is to serve solo founders, agencies, B2B sales teams, and self-hosted/privacy-first companies through a single product with phased feature growth. The Phase 1 *kernel* is the foundation all four audiences share: contacts, companies, deals, pipeline, activities, notes, and auth — built with two non-negotiable differentiators baked in from day one.

**The wedge (what makes DealFlow win):**

1. **Speed & keyboard-first UX.** Every action is reachable via Cmd-K. Inline edit everywhere. Optimistic updates. Page transitions under 100ms. Pitch: *"HubSpot feels like a mainframe. DealFlow feels like Linear."*
2. **AI-native.** AI is in the kernel, not bolted on. Summarize notes, draft follow-ups, natural-language filtering, contact extraction from pasted text.

Phase 1 ships the kernel + these two differentiators. Phases 2–4 expand into email sync, calendar, automation, reporting, custom objects, integrations, mobile, marketplace, and SSO.

---

## 2. Goals & Non-Goals

### Phase 1 Goals (acceptance criteria)

1. **Multi-tenant isolation works.** Two organizations can sign up, invite teammates, and provably cannot see each other's data. Verified by automated tenancy tests on every endpoint.
2. **Core CRM workflow works.** A user can create contacts + companies + deals, move deals through pipeline stages on a kanban (drag-drop, optimistic), log activities and notes, and set tasks.
3. **AI works for 4 actions:** summarize note, draft follow-up email, natural-language filter, extract contact from text.
4. **Cmd-K command palette runs every primary action.**
5. **Both deployment modes work** from the same codebase, both pass the same test suite:
   - SaaS mode: many orgs per DB, billing routes present (stubbed), AI required.
   - Self-host mode: single org per DB, billing hidden, AI optional.

### Non-Goals (Phase 2+)

Explicitly out of scope for Phase 1 — do not add until Phase 1 is shipped and validated:

- Email sync (IMAP/Gmail/Outlook), calendar sync, meeting scheduler.
- Workflow / automation builder.
- Reporting dashboards (beyond simple pipeline-value totals).
- Custom fields / custom object types.
- Mobile app.
- Public webhooks, marketplace, third-party integrations (Slack, Stripe, etc.).
- SSO / SAML, magic links, Microsoft OAuth (Google OAuth only in Phase 1).
- Billing & subscriptions (routes are stubbed in SaaS mode).

---

## 3. Stack Decisions

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS | Modern, fast, fetch built-in, native test runner available. |
| Backend framework | Fastify 5 | Fastest mainstream Node framework; schema-first validation aligns with Zod. |
| Language | TypeScript 5 (strict) | Shared types across api + web via `packages/shared`. |
| ORM / DB client | Drizzle ORM | SQL-first, lightweight, no codegen step; smaller self-host footprint than Prisma. |
| Database | Postgres 16 | Mature, rich (JSONB, FTS, generated columns), single store for everything Phase 1 needs. |
| Validation / schemas | Zod | Single source of truth: validate at API boundary, infer TS types client-side. |
| Auth — hashing | argon2id (`@node-rs/argon2`) | OWASP recommendation; native bindings, fast. |
| Auth — sessions | Postgres-backed, HttpOnly secure cookies | No external auth dep; identical for SaaS + self-host. |
| OAuth | Google only (Phase 1) | The B2B OAuth users actually want. Microsoft/magic links in Phase 2. |
| Frontend build | Vite | Fast dev, modern. |
| Frontend framework | React 19 | Largest talent pool, mature ecosystem, shadcn/ui. |
| Routing | TanStack Router | Type-safe routes, loaders, search params. |
| Data fetching | TanStack Query | Optimistic mutations, cache invalidation primitives. |
| Styling | Tailwind v4 | Standard for shadcn/ui. |
| Components | shadcn/ui (Radix-based) | Owned components, accessible, professional out-of-the-box. |
| Background jobs | pg-boss | Postgres-backed; one infrastructure piece for self-host. |
| File storage | S3-compatible API | AWS S3 (SaaS) / MinIO (self-host); identical client code. *(Deferred to Sub-Plan 6+.)* |
| Email out | Nodemailer + SMTP | Pluggable: Resend/SES (SaaS) / customer SMTP (self-host). *(Deferred to Sub-Plan 2+.)* |
| AI providers | Anthropic + OpenAI behind abstraction | `AI_PROVIDER=anthropic\|openai\|none`. |
| Unit tests | Vitest | Fast, ESM-native. |
| API integration tests | Vitest + Fastify `inject` | In-process, fast, no port binding. |
| Integration test DB | Native Postgres + per-test-file disposable DB | `CREATE DATABASE dealflow_test_<random>` in `beforeAll`, `DROP` in `afterAll`. ~5 s/file. |
| E2E tests | Playwright | The 5 critical user paths only. |
| Package manager | pnpm | Workspaces; faster + disk-efficient than npm. |
| Dev runtime | Native Postgres 16 on host | Replaces the original Docker Compose dev environment. |
| Self-host packaging | Docker image | Built and shipped in Sub-Plan 7 / Phase 3+; not required for dev. |

**Two notable choices to flag explicitly:**

- **Drizzle over Prisma.** Drizzle's smaller runtime + lack of codegen helps self-host. Complex CRM queries (pipeline aggregations, stalled-deal detection, deal-velocity analytics) are cleaner in SQL than in Prisma's query DSL.
- **pg-boss over BullMQ.** BullMQ requires Redis. Keeping the job queue inside Postgres means self-host needs only Postgres + the app. Throughput is more than sufficient for CRM workloads.

---

## 4. Repository Layout

```
dealflow/
├── apps/
│   ├── api/                  # Fastify backend (deployable)
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── plugins/      # auth, multi-tenancy, error handler, rate limit
│   │   │   ├── modules/      # one folder per domain: auth, orgs, contacts,
│   │   │   │                 #   companies, deals, pipelines, activities,
│   │   │   │                 #   notes, tasks, ai, files
│   │   │   └── lib/
│   │   └── package.json
│   └── web/                  # Vite React SPA (deployable)
│       ├── src/
│       │   ├── routes/       # TanStack Router file-based routes
│       │   ├── features/     # one folder per domain (mirrors api modules)
│       │   ├── components/   # shared UI (shadcn primitives + composed)
│       │   ├── lib/          # api client, query keys, cmd-k registry
│       │   └── main.tsx
│       └── package.json
├── packages/
│   ├── db/                   # Drizzle schema, migrations, seed
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── index.ts
│   ├── shared/               # Zod schemas + TS types shared api ↔ web
│   │   └── src/
│   │       ├── auth.ts
│   │       ├── contacts.ts
│   │       ├── deals.ts
│   │       └── ...
│   └── ai/                   # AI provider abstraction
│       └── src/
│           ├── provider.ts   # interface
│           ├── anthropic.ts
│           ├── openai.ts
│           └── noop.ts       # for AI_PROVIDER=none
├── infra/
│   ├── docker/
│   │   ├── api.Dockerfile
│   │   ├── web.Dockerfile
│   │   └── selfhost.Dockerfile   # all-in-one image: api + web (built static)
│   └── compose/
│       ├── docker-compose.dev.yml      # postgres + minio + mailhog
│       └── docker-compose.selfhost.yml # postgres + dealflow image
├── docs/
│   └── superpowers/specs/    # design docs (this file lives here)
├── .gitignore
├── package.json              # workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 5. Deployment Modes (SaaS + Self-Host)

One codebase, one env var:

```
DEPLOYMENT_MODE=saas        # default
DEPLOYMENT_MODE=self-host
```

**Behavioral differences (all driven by this single flag):**

| Behavior | SaaS | Self-Host |
|---|---|---|
| `POST /auth/signup` | Always creates a new organization. | Creates THE org on first call; returns 403 on subsequent calls. |
| Joining additional users | Always via invite. | Always via invite (after first signup). |
| Billing routes (`/billing/*`) | Mounted (stubbed in Phase 1). | Not mounted. |
| Default `AI_PROVIDER` | Required (`anthropic` or `openai`). | Defaults to `none`; opt-in by setting env var. |
| Default `STORAGE_DRIVER` | `s3` (AWS env vars required). | `s3` pointing at bundled MinIO (default `localhost:9000`). |
| Default `EMAIL_DRIVER` | `smtp` (Resend/SES SMTP). | `smtp` (customer-supplied) or `none` (signup uses logged tokens). |
| Telemetry / analytics | Enabled (anonymized). | Disabled by default; opt-in only. |

The schema is **identical** between modes. The `organizations` table exists in both — self-host just has exactly one row.

---

## 6. Data Model

16 tables. Every tenant-scoped table includes `organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, with an index on `(organization_id, ...)` for the common query.

### 6.1 Identity & tenancy

**`organizations`**
- `id` (uuid, pk)
- `name` (text)
- `slug` (text, unique) — URL-safe identifier
- `plan` (text) — `free` / `pro` / `enterprise` (Phase 1: all `free`)
- `created_at`, `updated_at`

**`users`** *(global; users can belong to multiple orgs)*
- `id` (uuid, pk)
- `email` (citext, unique)
- `email_verified_at` (timestamptz, nullable)
- `name` (text)
- `password_hash` (text, nullable — null when OAuth-only)
- `avatar_url` (text, nullable)
- `created_at`, `updated_at`

**`org_members`** *(join table; row-level tenancy primitive)*
- `organization_id` (uuid, fk)
- `user_id` (uuid, fk)
- `role` (text) — `owner` / `admin` / `member`
- `joined_at`
- PK: `(organization_id, user_id)`

**`sessions`**
- `id` (text, pk) — random 256-bit token, the cookie value
- `user_id` (uuid, fk)
- `current_org_id` (uuid, fk) — which org the user is "in" right now
- `expires_at`, `created_at`, `last_used_at`
- `user_agent`, `ip` (for security UI later)

**`oauth_accounts`**
- `user_id` (uuid, fk)
- `provider` (text) — `google` in Phase 1
- `provider_user_id` (text)
- `created_at`
- PK: `(provider, provider_user_id)`

**`invitations`**
- `id` (uuid, pk)
- `organization_id` (uuid, fk)
- `email` (citext)
- `role` (text)
- `token` (text, unique)
- `invited_by` (uuid, fk users)
- `expires_at`, `accepted_at` (nullable), `created_at`

### 6.2 CRM core

**`companies`**
- `id` (uuid, pk)
- `organization_id` (uuid, fk, indexed)
- `name` (text)
- `domain` (text, nullable)
- `industry`, `size`, `website`, `description` (text, nullable)
- `owner_user_id` (uuid, fk, nullable)
- `created_at`, `updated_at`
- Index: `(organization_id, name)`, `(organization_id, domain)`

**`contacts`**
- `id` (uuid, pk)
- `organization_id` (uuid, fk, indexed)
- `company_id` (uuid, fk, nullable)
- `first_name`, `last_name`, `email`, `phone`, `title` (text)
- `owner_user_id` (uuid, fk, nullable)
- `created_at`, `updated_at`
- Index: `(organization_id, email)`, `(organization_id, company_id)`

**`pipelines`**
- `id` (uuid, pk)
- `organization_id` (uuid, fk, indexed)
- `name` (text) — e.g. "Sales", "Renewals"
- `is_default` (bool)
- `created_at`, `updated_at`

**`pipeline_stages`**
- `id` (uuid, pk)
- `pipeline_id` (uuid, fk)
- `organization_id` (uuid, fk, indexed) — denormalized for fast tenancy checks
- `name` (text)
- `order_index` (int)
- `win_probability` (int, 0–100, nullable)
- `is_won` (bool, default false)
- `is_lost` (bool, default false)

**`deals`**
- `id` (uuid, pk)
- `organization_id` (uuid, fk, indexed)
- `pipeline_id` (uuid, fk)
- `stage_id` (uuid, fk)
- `name` (text)
- `value` (numeric(14,2))
- `currency` (text, default 'USD')
- `primary_contact_id` (uuid, fk, nullable)
- `company_id` (uuid, fk, nullable)
- `owner_user_id` (uuid, fk, nullable)
- `expected_close_date` (date, nullable)
- `status` (text) — `open` / `won` / `lost`
- `position_in_stage` (numeric) — for kanban ordering
- `created_at`, `updated_at`, `closed_at` (nullable)
- Index: `(organization_id, pipeline_id, stage_id, position_in_stage)` for kanban query.

**`activities`** *(unified log of interactions)*
- `id` (uuid, pk)
- `organization_id` (uuid, fk, indexed)
- `kind` (text) — `call` / `email` / `meeting` / `note`
- `subject` (text)
- `body` (text)
- `occurred_at` (timestamptz)
- `created_by_user_id` (uuid, fk)
- `deal_id`, `contact_id`, `company_id` (uuid, fk, all nullable — at least one set)
- `created_at`

**`tasks`**
- `id` (uuid, pk)
- `organization_id` (uuid, fk, indexed)
- `title` (text)
- `description` (text, nullable)
- `due_at` (timestamptz, nullable)
- `completed_at` (timestamptz, nullable)
- `assigned_to_user_id` (uuid, fk, nullable)
- `deal_id`, `contact_id`, `company_id` (uuid, fk, all nullable)
- `created_at`, `updated_at`

**`notes`** *(rich-text notes; activities of kind='note' reference the same idea but notes are first-class for the contact/company page)*
- `id` (uuid, pk)
- `organization_id` (uuid, fk, indexed)
- `body_md` (text) — markdown
- `created_by_user_id` (uuid, fk)
- `deal_id`, `contact_id`, `company_id` (uuid, fk, all nullable)
- `created_at`, `updated_at`

> Design note: `notes` and `activities(kind='note')` overlap. Decision: `notes` is the canonical rich-text note attached to an entity. `activities` log non-note interactions (calls/emails/meetings) and optionally short note-like comments. The UI surfaces both in the entity timeline.

### 6.3 Infrastructure

**`audit_log`**
- `id` (bigserial, pk)
- `organization_id` (uuid, fk, indexed)
- `actor_user_id` (uuid, fk, nullable)
- `action` (text) — e.g. `deal.create`, `deal.stage.change`, `user.invite`
- `entity_type`, `entity_id`
- `metadata` (jsonb)
- `created_at`

**`ai_jobs`**
- `id` (uuid, pk)
- `organization_id` (uuid, fk, indexed)
- `user_id` (uuid, fk)
- `kind` (text) — `summarize_note` / `draft_email` / `nl_filter` / `extract_contact`
- `input` (jsonb)
- `output` (jsonb, nullable)
- `status` (text) — `queued` / `running` / `succeeded` / `failed`
- `error` (text, nullable)
- `provider` (text) — `anthropic` / `openai`
- `model` (text)
- `tokens_in`, `tokens_out` (int) — cost tracking
- `created_at`, `started_at`, `finished_at`

---

## 7. Multi-Tenancy Enforcement

Tenancy is enforced at the data-access layer, not relied on at the route handler.

**Rules:**

1. Every tenant-scoped table has `organization_id NOT NULL`.
2. The DB layer exposes a `withOrg(orgId)` factory that returns a scoped repository. All queries go through it. Example:
   ```ts
   const repo = withOrg(req.user.currentOrgId);
   await repo.deals.list({ pipelineId });
   // Drizzle layer auto-applies WHERE organization_id = $orgId.
   ```
3. No "raw" queries are allowed in route handlers — lint rule + code review.
4. Tenancy is asserted by **integration tests**, not just trusted: every endpoint has a "cross-tenant access denied" test that creates Org A + Org B, signs in as A, attempts to access B's resource by ID, expects 404. A test util `assertTenantIsolation(endpoint)` generates these tests for every route automatically (table-driven).

**Optional defense in depth:** Postgres Row-Level Security (RLS) on tenant-scoped tables, using a `current_organization_id` session GUC. Deferred to Phase 2; the `withOrg` repository pattern + tests are sufficient for Phase 1 and easier to reason about.

---

## 8. API Design

### Conventions

- **Style:** REST + JSON.
- **Base path:** `/api/v1` (versioning headroom; never breaks once shipped).
- **Auth:** HttpOnly cookie carries session id; CSRF protection via double-submit cookie for state-changing methods.
- **Validation:** Every route declares a Zod schema for body, query, and params. Fastify `schemaErrorFormatter` returns errors in the standard envelope.
- **Errors:**
  ```json
  { "error": { "code": "VALIDATION_FAILED", "message": "...", "details": { "field": "..." } } }
  ```
  HTTP codes: 400 / 401 / 403 / 404 / 409 / 422 / 429 / 500.
- **Pagination:** Cursor-based (`?cursor=&limit=`) for lists. Defaults: 50, max 200.
- **Rate limit:** Per IP (60/min unauth, 600/min auth) + per session (1200/min). AI endpoints separate bucket (20/min per user).
- **Idempotency:** Mutations accept an optional `Idempotency-Key` header; deduped server-side for 24h.

### Route surface (Phase 1)

```
POST   /api/v1/auth/signup
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
POST   /api/v1/auth/oauth/google/start
GET    /api/v1/auth/oauth/google/callback
POST   /api/v1/auth/verify-email
POST   /api/v1/auth/request-password-reset
POST   /api/v1/auth/reset-password

GET    /api/v1/orgs                            # orgs the current user belongs to
POST   /api/v1/orgs                            # create new org (SaaS only)
POST   /api/v1/orgs/:id/switch                 # set current_org_id on session
GET    /api/v1/orgs/:id/members
POST   /api/v1/orgs/:id/invitations
POST   /api/v1/invitations/:token/accept

GET    /api/v1/contacts        POST /api/v1/contacts
GET    /api/v1/contacts/:id    PATCH /api/v1/contacts/:id    DELETE /api/v1/contacts/:id

GET    /api/v1/companies       POST /api/v1/companies
GET    /api/v1/companies/:id   PATCH /api/v1/companies/:id   DELETE /api/v1/companies/:id

GET    /api/v1/pipelines       POST /api/v1/pipelines
GET    /api/v1/pipelines/:id   PATCH /api/v1/pipelines/:id   DELETE /api/v1/pipelines/:id
POST   /api/v1/pipelines/:id/stages
PATCH  /api/v1/pipeline-stages/:id
DELETE /api/v1/pipeline-stages/:id
POST   /api/v1/pipeline-stages/reorder

GET    /api/v1/deals           POST /api/v1/deals
GET    /api/v1/deals/:id       PATCH /api/v1/deals/:id       DELETE /api/v1/deals/:id
POST   /api/v1/deals/:id/move-stage     # body: { stageId, positionInStage }

GET    /api/v1/activities      POST /api/v1/activities
GET    /api/v1/notes           POST /api/v1/notes
GET    /api/v1/tasks           POST /api/v1/tasks   PATCH /api/v1/tasks/:id

POST   /api/v1/ai/summarize-note          # body: { text } → { summary }
POST   /api/v1/ai/draft-email             # body: { dealId, intent }
POST   /api/v1/ai/nl-filter               # body: { query, entity }
POST   /api/v1/ai/extract-contact         # body: { text } → { firstName, lastName, email, ... }
GET    /api/v1/ai/jobs/:id                # poll for async results
```

---

## 9. Authentication & Sessions

**Sign-up (SaaS):**
1. `POST /auth/signup` with email + password + org name.
2. Server: argon2id-hash password, insert `users`, insert `organizations`, insert `org_members(role=owner)`, create `sessions` row, send verification email (queued via pg-boss), set cookie.

**Sign-up (Self-Host, first call):**
Same as SaaS, but server checks that no organizations exist yet. Subsequent signup attempts return 403 with code `SELF_HOST_ALREADY_INITIALIZED`.

**Login:**
1. `POST /auth/login` with email + password.
2. Server: lookup user, argon2id-verify, create session, set cookie.

**Google OAuth:**
1. Client hits `POST /auth/oauth/google/start` → server returns redirect URL with state + PKCE.
2. Google redirects to `GET /auth/oauth/google/callback?code=&state=`.
3. Server: exchange code, fetch userinfo, find-or-create user, find-or-create `oauth_accounts` row, create session.

**Cookie:**
- Name: `dealflow_session`.
- `HttpOnly; Secure; SameSite=Lax; Path=/`.
- Value: opaque 256-bit token; row in `sessions` table holds metadata.
- Rolling 30-day expiry (`last_used_at` updated on each authed request; expiry pushed forward).

**CSRF:** State-changing endpoints (POST/PATCH/DELETE) require a header `X-CSRF-Token` matching a non-HttpOnly cookie `dealflow_csrf` (double-submit pattern). Generated at login.

---

## 10. Frontend Architecture

### Routes (TanStack Router)

```
/                              → redirect to /app or /login
/login
/signup
/invitations/:token            → accept invitation flow
/verify-email/:token

/app                           → layout (sidebar + topbar + Cmd-K)
  /inbox                       → unified activity feed
  /contacts                    → list (table)
  /contacts/:id                → contact detail
  /companies                   → list
  /companies/:id               → company detail
  /deals                       → kanban (default) + table toggle
  /deals/:id                   → deal detail
  /tasks                       → my tasks
  /settings
    /profile
    /organization
    /members
    /pipelines
```

### State & data

- **Server state:** TanStack Query. Query keys are colocated in `lib/queryKeys.ts`. Mutations use `onMutate` for optimistic updates and `onError` for rollback.
- **Client state:** React state + small Zustand stores for ephemeral UI (cmd-k open, sidebar collapsed, kanban drag state).
- **Forms:** react-hook-form + Zod resolver, schema imported from `packages/shared`.
- **API client:** Thin `fetch` wrapper that handles cookies, CSRF, error parsing, and JSON. No third-party SDK.

### Speed budget (enforced)

- TTI < 1.5s on a cold load over good network.
- Route transitions < 100ms (TanStack Router prefetch on hover/intent).
- Kanban drag → server confirm < 200ms p95 (optimistic update is instant; we just verify server doesn't lag).
- Tracked in `apps/web/perf-budget.json`; Playwright tests assert.

---

## 11. Keyboard-First UX Patterns

This is the differentiator, not a finishing touch. Implemented from day one.

### Cmd-K command palette

Component: `<CommandPalette>` (built on shadcn's `Command` / `cmdk`).

Behavior:
- Opens on Cmd-K / Ctrl-K from anywhere.
- Lists *commands* (registered by features) + *navigation* (jump to contact/deal/company) + *recents*.
- Commands are typed and discoverable:
  ```ts
  registerCommand({
    id: 'deal.create',
    name: 'Create deal',
    keywords: ['new', 'add'],
    shortcut: 'C D',
    action: ({ open }) => open('/app/deals/new'),
  });
  ```
- Every **primary action** MUST be registered. A "primary action" is any state-changing operation on a top-level entity (create/edit/delete a contact, company, deal, pipeline, stage, activity, note, task, invitation, member) plus navigation to top-level pages. Lint rule enforces presence on feature mount.

### Global shortcuts (Phase 1)

| Keys | Action |
|---|---|
| `Cmd/Ctrl-K` | Open command palette |
| `G then C` | Go to contacts |
| `G then D` | Go to deals |
| `G then I` | Go to inbox |
| `C then D` | Create deal |
| `C then C` | Create contact |
| `C then N` | Create note (on current entity page) |
| `/` | Focus search |
| `Esc` | Close modal / palette |
| `?` | Show shortcuts cheat sheet |

### Inline editing

Every field on detail pages is click-to-edit. No modal forms for single-field changes. Saves on blur. Optimistic + rollback on error.

---

## 12. AI Integration

### Provider abstraction (`packages/ai`)

```ts
interface AIProvider {
  summarizeNote(input: { text: string }): Promise<{ summary: string }>;
  draftEmail(input: { dealContext: DealContext; intent: string }): Promise<{ subject: string; body: string }>;
  nlFilter(input: { query: string; entity: 'deals' | 'contacts' | 'companies' }): Promise<{ filter: FilterDSL }>;
  extractContact(input: { text: string }): Promise<Partial<Contact>>;
}
```

Implementations: `anthropic.ts`, `openai.ts`, `noop.ts` (throws "AI disabled" for self-host without provider).

### Execution model

All AI calls run as **`pg-boss` jobs**, not synchronous. Route handler creates an `ai_jobs` row + queues, returns `202 Accepted` with `{ jobId }`. Client polls `GET /ai/jobs/:id` (or, Phase 2, subscribes via SSE).

Reasons: keeps p99 API latency predictable, lets us retry on provider blips, gives a cost-tracking ledger row per call.

### Natural-language filter (the interesting one)

Pipeline:
1. Client sends `{ query: "deals over $10k stalled 14 days", entity: "deals" }`.
2. Server prompts model with the schema of `deals` + allowed operators.
3. Model returns a structured FilterDSL JSON (validated by Zod).
4. Server compiles FilterDSL → Drizzle WHERE clause (allow-listed columns + operators only — **never** raw SQL from model output).
5. Returns filter ID + preview count; client uses filter ID to actually fetch results.

### Cost & abuse controls

- Per-org daily token cap (configurable; SaaS default 100k tokens/day on free plan).
- Per-user rate limit (20 AI calls/min).
- `ai_jobs` rollup query feeds a usage display in settings.

---

## 13. Background Jobs

`pg-boss` schemas in the same Postgres DB. Queues:

| Queue | Use |
|---|---|
| `email.send` | Outbound emails (verification, password reset, invitations). |
| `ai.execute` | Run AI provider calls. |
| `audit.persist` | Async audit log writes (fire-and-forget from hot paths). |
| `cleanup.sessions` | Hourly: delete expired sessions. |
| `cleanup.invitations` | Hourly: expire stale invitations. |

Workers run in the same `api` process by default; can be split to a separate worker process via `pnpm start:worker` for SaaS scale.

---

## 14. File Storage

Single S3-compatible client (`@aws-sdk/client-s3`) configured via env:

```
STORAGE_DRIVER=s3
S3_ENDPOINT=...
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

SaaS: AWS S3. Self-host: MinIO bundled in `docker-compose.selfhost.yml`. Code is identical.

Phase 1 usage: contact/company avatar uploads only. Wire is in place for future use (deal attachments, etc).

---

## 15. Email Sending

Nodemailer + SMTP. Templates rendered via MJML → HTML at build time, stored in `apps/api/src/emails/`.

Phase 1 emails:
- Verify email
- Password reset
- Organization invitation
- Welcome (post-verification)

SaaS: SMTP creds for Resend or SES. Self-host: customer-provided SMTP or `EMAIL_DRIVER=console` (logs tokens to stdout — for dev/testing only).

---

## 16. Testing Strategy

TDD where it matters; not dogma where it doesn't.

| Layer | Tool | What we test |
|---|---|---|
| Unit | Vitest | Pure domain logic (filter compilation, win-probability math, kanban reordering math, AI prompt builders). |
| API integration | Vitest + Fastify `inject` | Every endpoint × auth state × tenancy. Real Postgres via testcontainers (one shared container, fresh schema per test file). |
| Integration DB | Native Postgres + per-file disposable DB | `startTestPostgres()` returns a Drizzle handle pointed at `dealflow_test_<random>`; `stop()` drops it. |
| Tenancy | Vitest + table-driven helper | `assertTenantIsolation(endpoint)` auto-generates a cross-tenant test for every endpoint. Required. |
| E2E | Playwright | Only the 5 critical paths: signup, create deal, move stage, invite teammate, AI summarize. |
| Visual regression | Deferred to Phase 2. | — |

CI runs unit + integration on every PR; E2E on `main` and pre-merge.

---

## 17. Phase 1 Acceptance Criteria (binary)

Phase 1 is "done" when **all** of these pass on `main`:

- [ ] `pnpm test` runs unit + integration suites with 0 failures.
- [ ] `pnpm test:e2e` runs the 5 critical Playwright scenarios with 0 failures, in both SaaS and self-host modes.
- [ ] `assertTenantIsolation` covers every route under `/api/v1/...` (auto-checked; lint fails if a route is missed).
- [ ] `docker compose -f infra/compose/docker-compose.dev.yml up` brings up a working dev environment from a clean clone with one command.
- [ ] `docker build -f infra/docker/selfhost.Dockerfile -t dealflow .` produces an image that, combined with `docker-compose.selfhost.yml`, runs the full app with Postgres + MinIO.
- [ ] Cmd-K registry contains entries for every primary action (lint rule).
- [ ] 4 AI actions return real, useful output against Anthropic + OpenAI; `noop` provider correctly rejects.
- [ ] Perf budget assertions pass.

---

## 18. Open Questions (track, don't block)

These are flagged for resolution during implementation; they do **not** block starting:

1. **Default pipeline seed.** What stages does the default "Sales" pipeline have on org creation? Proposal: `Lead → Qualified → Proposal → Negotiation → Closed Won / Closed Lost`. Confirm during impl.
2. **Currency handling.** Phase 1: per-deal currency, displayed as-is. No FX conversion. Org-level default currency in settings. Confirm.
3. **Soft delete vs hard delete.** Phase 1: hard delete on contacts/companies/deals (with audit log). Soft delete added in Phase 2 if needed. Confirm.
4. **AI model defaults.** Anthropic: `claude-sonnet-4-5` for everything except `extractContact` (cheaper model OK). OpenAI: `gpt-4.1` equivalent. Final pick during impl.
5. **Self-host telemetry.** Off by default; "send anonymized usage to help improve DealFlow" opt-in toggle in settings. UX confirm.

---

## 19. Out of Scope (explicitly Phase 2+)

Listed in §2 (non-goals). Adding here so future readers don't dig:

Email/calendar sync · Automation/workflows · Reporting dashboards · Custom fields & objects · Mobile · Webhooks · Marketplace · SSO/SAML · Magic links · Microsoft OAuth · Billing & subscriptions · Slack/Stripe/etc native integrations · Public API rate-limit plans · Postgres RLS · Multi-region replication.

---

## 20. Glossary

- **Kernel.** The minimum coherent CRM that all four target audiences need: contacts + companies + deals + pipeline + activities + notes + auth.
- **Wedge.** The specific thing DealFlow does meaningfully better than HubSpot/Pipedrive in Phase 1: speed/keyboard-first + AI-native.
- **Tenant.** An organization. Tenancy = isolating data between organizations.
- **FilterDSL.** The JSON filter representation produced by the AI nl-filter endpoint, compiled to SQL via allow-listed operators.
- **Primary action.** Any state-changing operation on a top-level entity (contact, company, deal, pipeline, stage, activity, note, task, invitation, member) plus navigation to top-level pages. Every primary action must appear in the Cmd-K registry.
