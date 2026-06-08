# Team Management (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-org team management to DealFlow — invite teammates by email, manage member roles, switch between organizations, and enforce role + record-ownership permissions on every endpoint.

**Architecture:** Reuse the existing tables (`org_members`, `invitations`, `oauth_accounts`, `sessions.current_org_id`) and the per-org SMTP email stack. Add (1) a membership-loading preHandler that attaches the caller's role, (2) `requireRole` + `assertCanWrite` guards, (3) Members/Invitations/Orgs repos + routes, and (4) frontend: an org switcher, a Settings→Members page, an invite dialog, and a public accept-invite page. Enforcement is lightweight guards (not CASL, not RLS — RLS was deferred in the Phase-1 kernel).

**Tech Stack:** Fastify 5 + Drizzle (postgres-js) + Zod (`@dealflow/shared`); React 19 + TanStack Router/Query + Tailwind v4 + Radix; Vitest integration tests (per-file Postgres harness) + Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-06-08-team-management-design.md` · **Mockup:** `…/2026-06-08-team-management-mockup.html`

---

## Conventions for the executor

- **Read before writing.** For any "mirror the pattern in X" step, open X first. Key references:
  - Routes + per-org email: `apps/api/src/modules/emails/routes.ts` (`loadEmailConfig`, `buildEmailProvider`, `requireOrg` usage).
  - A repo + its integration test: `apps/api/src/modules/integrations/repo.ts` and the nearest `*.spec.ts` (per-file DB harness; shows how to spin a test DB, seed an org+user, and assert tenancy).
  - Web feature module: `apps/web/src/features/companies/` (`api.ts` hooks + components) and `apps/web/src/routes/app.settings.index.tsx`.
  - Auth/session: `apps/api/src/modules/auth/routes.ts` (signup creates user+org+`org_members(owner)`+session; password hashing helper; session creation helper).
- **TDD:** write the failing test, run it red, implement minimally, run green, commit. Backend logic is covered by integration tests; frontend is covered by typecheck + the final Playwright E2E (the repo has no component-test harness — don't invent one).
- **Validate after each task:** `pnpm --filter @dealflow/api exec tsc --noEmit` and `pnpm --filter @dealflow/web exec tsc --noEmit` must stay green; run the task's tests.
- **Commit** at the end of every task with a conventional message + the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Push is fine (CI is currently disabled).

## File structure (created / modified)

**Shared (`packages/shared/src/`)**
- Create `team.ts` — role enums + member/invitation/org Zod schemas + DTO types. Export from `index.ts`.

**DB (`packages/db/`)**
- Create `migrations/<next>_backfill_owner_user_id.sql` — backfill `owner_user_id` from each org's owner.

**API (`apps/api/src/`)**
- Modify `plugins/require-org.ts` — also load membership role onto `req.membership`.
- Create `plugins/require-role.ts` — `requireRole(roles)` preHandler factory.
- Create `lib/authz.ts` — `assertCanWrite(role, ownerUserId, userId)` + `AuthzError`.
- Create `modules/members/repo.ts`, `modules/members/routes.ts` (members + invitations + orgs endpoints) and `*.spec.ts` tests.
- Create `lib/invite-email.ts` — invite email subject/body + accept URL.
- Modify `env.ts` — add `PUBLIC_WEB_URL` (default `CORS_ORIGIN`).
- Modify `modules/{contacts,companies,deals,activities}/*.repo.ts` — set `ownerUserId` on create.
- Modify `modules/{contacts,companies,deals,activities}/routes.ts` — `assertCanWrite` on update/delete.
- Modify `modules/{custom-fields,integrations,organizations}/routes.ts` — `requireRole(['owner','admin'])` on mutations.
- Modify `server.ts` — register the members module routes.
- Modify the request type augmentation (where `req.session`/`req.user` are declared) to add `req.membership`.

**Web (`apps/web/src/`)**
- Create `features/members/api.ts` — `useMembers`, `useInvitations` (folded into members), `useOrgs`, `useSwitchOrg`, `useMembership`, mutation hooks.
- Create `features/members/invite-dialog.tsx`, `features/members/org-switcher.tsx`.
- Create `routes/app.settings.members.tsx` — Members page.
- Create `routes/invite.$token.tsx` — public accept-invite page.
- Modify `routes/app.tsx` — mount the org switcher in the header.
- Modify `routes/app.settings.index.tsx` — add a "Members" link.
- Modify `lib/query-keys.ts` — add `members`/`orgs` keys.
- Modify entity detail pages (`app.{contacts,companies,deals}.$id.tsx`) — gate Delete/edit by role+ownership (uses `useMembership`).

---

## Phase A — Shared schemas + authz primitives + backfill

### Task A1: Shared team schemas & types

**Files:**
- Create: `packages/shared/src/team.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './team.js';`)
- Test: `packages/shared/src/team.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { orgRoleSchema, assignableRoleSchema, createInvitationBodySchema } from './team.js';

describe('team schemas', () => {
  it('accepts valid roles and rejects unknown', () => {
    expect(orgRoleSchema.parse('owner')).toBe('owner');
    expect(() => orgRoleSchema.parse('superadmin')).toThrow();
  });
  it('assignable role excludes owner', () => {
    expect(() => assignableRoleSchema.parse('owner')).toThrow();
    expect(assignableRoleSchema.parse('admin')).toBe('admin');
  });
  it('invitation body requires email + assignable role', () => {
    expect(createInvitationBodySchema.parse({ email: 'a@b.com', role: 'member' })).toEqual({
      email: 'a@b.com',
      role: 'member',
    });
    expect(() => createInvitationBodySchema.parse({ email: 'nope', role: 'member' })).toThrow();
    expect(() => createInvitationBodySchema.parse({ email: 'a@b.com', role: 'owner' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test → fails** — `pnpm --filter @dealflow/shared exec vitest run src/team.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/team.ts
import { z } from 'zod';

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const orgRoleSchema = z.enum(ORG_ROLES);
/** Roles an admin/owner may assign via invite or role-change (never directly grant owner). */
export const assignableRoleSchema = z.enum(['admin', 'member']);

export const createInvitationBodySchema = z.object({
  email: z.string().email(),
  role: assignableRoleSchema,
});
export const updateMemberRoleBodySchema = z.object({ role: orgRoleSchema });
export const switchOrgBodySchema = z.object({ organizationId: z.string().uuid() });
export const acceptInvitationBodySchema = z.object({
  name: z.string().min(1).optional(),
  password: z.string().min(8).optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationBodySchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationBodySchema>;

export interface PublicMember {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
}
export interface PublicInvitation {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
}
export interface PublicOrgSummary {
  id: string;
  name: string;
  role: OrgRole;
}
export interface InvitationPreview {
  orgName: string;
  inviterName: string | null;
  role: OrgRole;
  emailHasAccount: boolean;
  expired: boolean;
}
```

- [ ] **Step 4: Run test → passes.** Also `pnpm --filter @dealflow/shared exec tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(shared): team-management role + invitation schemas"`.

### Task A2: `assertCanWrite` authz helper

**Files:**
- Create: `apps/api/src/lib/authz.ts`
- Test: `apps/api/src/lib/authz.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { assertCanWrite, AuthzError } from './authz.js';

describe('assertCanWrite', () => {
  it('allows owner/admin regardless of ownership', () => {
    expect(() => assertCanWrite('owner', 'other-user', 'me')).not.toThrow();
    expect(() => assertCanWrite('admin', null, 'me')).not.toThrow();
  });
  it('allows a member only on records they own', () => {
    expect(() => assertCanWrite('member', 'me', 'me')).not.toThrow();
    expect(() => assertCanWrite('member', 'someone-else', 'me')).toThrow(AuthzError);
    expect(() => assertCanWrite('member', null, 'me')).toThrow(AuthzError);
  });
});
```

- [ ] **Step 2: Run → fails.** `pnpm --filter @dealflow/api exec vitest run src/lib/authz.spec.ts`
- [ ] **Step 3: Implement**

```ts
// apps/api/src/lib/authz.ts
import type { OrgRole } from '@dealflow/shared';

export class AuthzError extends Error {
  constructor(message = 'You do not have permission to modify this record.') {
    super(message);
    this.name = 'AuthzError';
  }
}

/** Owner/admin may write anything; a member may write only records they own. */
export function assertCanWrite(
  role: OrgRole,
  ownerUserId: string | null,
  userId: string,
): void {
  if (role === 'owner' || role === 'admin') return;
  if (ownerUserId && ownerUserId === userId) return;
  throw new AuthzError();
}
```

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): assertCanWrite ownership guard"`.

### Task A3: Load membership role onto the request

**Files:**
- Modify: `apps/api/src/plugins/require-org.ts`
- Modify: the request augmentation file (search for `interface FastifyRequest` / `currentOrgId` declaration; add `membership?: { role: OrgRole }`).
- Test: `apps/api/src/plugins/require-org.spec.ts` (extend existing if present; else create).

- [ ] **Step 1: Failing test** — using the integration harness (seed an org + owner + session), assert that after `requireOrg` runs on a request, `req.membership.role === 'owner'`, and that a session whose user is **not** a member of `currentOrgId` gets 403 `NOT_A_MEMBER`. (Mirror the seeding helpers used by existing `*.spec.ts`.)

```ts
// sketch — adapt to the repo's test harness/helpers
it('attaches membership role for a member of the current org', async () => {
  const { app, org, ownerSessionCookie } = await seedOrgWithOwner();
  const res = await app.inject({ method: 'GET', url: '/api/v1/organizations/current',
    headers: { cookie: ownerSessionCookie } });
  expect(res.statusCode).toBe(200);
  // role surfaced via a debug-free path: assert through a role-gated endpoint in a later task,
  // or expose req.membership through an existing handler under test.
});
it('403s when the session user is not a member of current org', async () => {
  const { app, foreignSessionCookieForOrg } = await seedTwoOrgs();
  const res = await app.inject({ method: 'GET', url: '/api/v1/organizations/current',
    headers: { cookie: foreignSessionCookieForOrg } });
  expect(res.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run → fails** (no membership loaded; second case currently 200/other).
- [ ] **Step 3: Implement** — after the existing auth/org checks in `requireOrg`, query the member row and attach it:

```ts
// inside requireOrg, after the currentOrgId check:
import { schema } from '@dealflow/db';
import { and, eq } from 'drizzle-orm';
import type { OrgRole } from '@dealflow/shared';

const [member] = await req.server.db
  .select({ role: schema.orgMembers.role })
  .from(schema.orgMembers)
  .where(and(
    eq(schema.orgMembers.organizationId, req.session.currentOrgId),
    eq(schema.orgMembers.userId, req.user.id),
  ))
  .limit(1);

if (!member) {
  void reply.status(403).send({ error: { code: 'NOT_A_MEMBER', message: 'You are not a member of this organization.' } });
  return;
}
req.membership = { role: member.role as OrgRole };
```

> Note: `req.server.db` — use however the db handle is exposed in this codebase (check how other preHandlers/routes access Drizzle; it may be `req.server.db`, a decorator, or imported). Match the existing access pattern.

Augment the type (in the file that already augments `FastifyRequest`):

```ts
import type { OrgRole } from '@dealflow/shared';
declare module 'fastify' {
  interface FastifyRequest { membership?: { role: OrgRole } }
}
```

- [ ] **Step 4: Run → passes.** `tsc --noEmit` green for api.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): load org membership role in requireOrg"`.

### Task A4: `requireRole` preHandler

**Files:**
- Create: `apps/api/src/plugins/require-role.ts`
- Test: covered via the members endpoints (Task C/D). Add a focused unit test if the harness allows constructing a request stub; otherwise rely on endpoint tests.

- [ ] **Step 1: Implement**

```ts
// apps/api/src/plugins/require-role.ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OrgRole } from '@dealflow/shared';
import { ERROR_CODES } from '@dealflow/shared';

export function requireRole(roles: OrgRole[]) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const role = req.membership?.role;
    if (!role || !roles.includes(role)) {
      void reply.status(403).send({
        error: { code: ERROR_CODES.FORBIDDEN ?? 'FORBIDDEN', message: 'Insufficient role for this action.' },
      });
    }
  };
}
```

> Check `ERROR_CODES` in `@dealflow/shared`; if there's no `FORBIDDEN`, add it there (small edit + its own commit) or use the literal `'FORBIDDEN'`.

- [ ] **Step 2:** Used as a chained preHandler: `{ preHandler: [requireOrg, requireRole(['owner','admin'])] }`.
- [ ] **Step 3: Commit** — `git commit -m "feat(api): requireRole preHandler"`.

### Task A5: Backfill `owner_user_id` migration

**Files:**
- Create: `packages/db/migrations/<next-number>_backfill_owner_user_id.sql` (match the existing migration filename convention — check the folder).

- [ ] **Step 1: Write the migration**

```sql
-- backfill owner_user_id to each org's owner where missing
WITH org_owner AS (
  SELECT DISTINCT ON (organization_id) organization_id, user_id
  FROM org_members WHERE role = 'owner'
  ORDER BY organization_id, joined_at ASC
)
UPDATE contacts c SET owner_user_id = o.user_id
  FROM org_owner o WHERE c.organization_id = o.organization_id AND c.owner_user_id IS NULL;
UPDATE companies c SET owner_user_id = o.user_id
  FROM org_owner o WHERE c.organization_id = o.organization_id AND c.owner_user_id IS NULL;
UPDATE deals d SET owner_user_id = o.user_id
  FROM org_owner o WHERE d.organization_id = o.organization_id AND d.owner_user_id IS NULL;
UPDATE activities a SET owner_user_id = o.user_id
  FROM org_owner o WHERE a.organization_id = o.organization_id AND a.owner_user_id IS NULL;
```

- [ ] **Step 2: Apply** — run the project's migrate command (`pnpm --filter @dealflow/db migrate` or the documented script) against the dev Supabase DB; confirm no error.
- [ ] **Step 3: Verify** — a quick query: zero `owner_user_id IS NULL` rows in any of the four tables for orgs that have an owner.
- [ ] **Step 4: Commit** — `git commit -m "feat(db): backfill owner_user_id to org owner"`.

---

## Phase B — Ownership enforcement on existing entities

> Repeat the same shape for contacts, companies, deals, activities. One task per entity keeps commits small.

### Task B1: Contacts — set owner on create, guard update/delete

**Files:**
- Modify: `apps/api/src/modules/contacts/contacts.repo.ts` (create sets `ownerUserId`)
- Modify: `apps/api/src/modules/contacts/routes.ts` (update + delete call `assertCanWrite`)
- Test: `apps/api/src/modules/contacts/*.spec.ts`

- [ ] **Step 1: Failing tests** (integration; seed org with an owner + a member + a second member):

```ts
it('sets ownerUserId to the creator on create', async () => {
  const { cookie, userId } = memberA;
  const res = await app.inject({ method: 'POST', url: '/api/v1/contacts',
    headers: { cookie }, payload: { firstName: 'Ann' } });
  expect(res.statusCode).toBe(201);
  expect(res.json().contact.ownerUserId).toBe(userId);
});
it('blocks a member from editing a record they do not own', async () => {
  const created = await createContactAs(memberA, { firstName: 'Ann' });
  const res = await app.inject({ method: 'PATCH', url: `/api/v1/contacts/${created.id}`,
    headers: { cookie: memberB.cookie }, payload: { firstName: 'Hacked' } });
  expect(res.statusCode).toBe(403);
});
it('lets an admin edit any record', async () => {
  const created = await createContactAs(memberA, { firstName: 'Ann' });
  const res = await app.inject({ method: 'PATCH', url: `/api/v1/contacts/${created.id}`,
    headers: { cookie: adminUser.cookie }, payload: { firstName: 'Edited' } });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** — in the repo `create`, set `ownerUserId: userId` (thread the acting user id in if not already passed). In `routes.ts` PATCH and DELETE handlers, after loading the row:

```ts
import { assertCanWrite, AuthzError } from '../../lib/authz.js';
// ...load existing row (org-scoped) → 404 if missing...
try {
  assertCanWrite(req.membership!.role, row.ownerUserId, req.user!.id);
} catch (e) {
  if (e instanceof AuthzError) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: e.message } });
  throw e;
}
// also: reject member attempts to change ownerUserId in the PATCH body (only owner/admin may reassign)
```

- [ ] **Step 4: Run → passes;** existing contact tests still green; `tsc` green.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): enforce record ownership on contacts"`.

### Task B2 / B3 / B4: Companies / Deals / Activities

- [ ] Repeat Task B1 exactly for **companies** (`modules/companies`), **deals** (`modules/deals`), and **activities** (`modules/activities`) — same three tests (create-sets-owner, member-blocked-on-others, admin-can-edit-any), same `assertCanWrite` wiring in PATCH/DELETE, same repo create change. Commit each separately: `feat(api): enforce record ownership on {companies|deals|activities}`.

> Deals note: the `move` endpoint is a state change on a deal — apply `assertCanWrite` there too (a member may only move their own deals).

### Task B5: Role-gate org-admin surfaces

**Files:**
- Modify: `modules/custom-fields/routes.ts`, `modules/integrations/routes.ts`, `modules/organizations/routes.ts` (PATCH current).

- [ ] **Step 1: Failing test** — a `member` gets 403 on: create/delete a custom-field definition, PATCH integrations, PATCH `/organizations/current`.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** — add `requireRole(['owner','admin'])` to those mutating routes' preHandler arrays (keep `requireOrg` first). Leave GETs open to all members.
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): restrict settings/integrations/custom-field mutations to owner/admin"`.

---

## Phase C — Members repo + endpoints

### Task C1: MembersRepo (list / change role / remove / leave) with invariants

**Files:**
- Create: `apps/api/src/modules/members/repo.ts`
- Test: `apps/api/src/modules/members/repo.spec.ts`

- [ ] **Step 1: Failing tests** (seed org with owner + admin + member):

```ts
it('lists members with name/email/role', async () => {
  const rows = await repo.listMembers(org.id);
  expect(rows).toHaveLength(3);
  expect(rows.find(r => r.role === 'owner')!.email).toBe(owner.email);
});
it('refuses to demote the last owner', async () => {
  await expect(repo.changeRole(org.id, owner.userId, 'admin', /*actorRole*/ 'owner'))
    .rejects.toThrow(/last owner/i);
});
it('refuses to remove the last owner', async () => {
  await expect(repo.removeMember(org.id, owner.userId)).rejects.toThrow(/last owner/i);
});
it('admin cannot grant owner role', async () => {
  await expect(repo.changeRole(org.id, member.userId, 'owner', 'admin'))
    .rejects.toThrow(/only an owner/i);
});
it('removes a member', async () => {
  await repo.removeMember(org.id, member.userId);
  expect((await repo.listMembers(org.id)).some(r => r.userId === member.userId)).toBe(false);
});
```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** `MembersRepo` with:
  - `listMembers(orgId)` → join `org_members` × `users` → `PublicMember[]`.
  - `countOwners(orgId)` helper.
  - `changeRole(orgId, userId, newRole, actorRole)` — if target currently owner or `newRole === 'owner'` and `actorRole !== 'owner'` → throw "only an owner…"; if demoting the last owner → throw "last owner…"; else update.
  - `removeMember(orgId, userId)` — if user is the last owner → throw "last owner…"; else delete the row.
  - `leave(orgId, userId)` — same last-owner guard, then delete.
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): MembersRepo with last-owner + owner-role invariants"`.

### Task C2: Members + Orgs routes

**Files:**
- Create: `apps/api/src/modules/members/routes.ts`
- Modify: `apps/api/src/server.ts` (register)
- Test: `apps/api/src/modules/members/routes.spec.ts`

- [ ] **Step 1: Failing tests** — `GET /api/v1/orgs/current/members` returns members+invitations (empty invites ok); `PATCH …/members/:userId` as member → 403, as admin → 200; `DELETE …/members/:userId` last-owner → 409; `GET /api/v1/orgs` returns the caller's orgs with roles; `POST /api/v1/orgs/switch` to a non-member org → 403, to a member org → 200 and subsequent `requireOrg` requests scope to it; `POST /api/v1/orgs/current/members/leave` → caller leaves (last-owner → 409).
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** the routes (preHandlers: `requireOrg`; mutations add `requireRole(['owner','admin'])`). Wire `MembersRepo`. For `/orgs/switch`: verify membership then `UPDATE sessions SET current_org_id = $1 WHERE id = <session id>`; return `{ ok: true }`. For `GET /orgs`: select orgs joined via `org_members` for `req.user.id` with role. Wire `POST …/members/leave` → `MembersRepo.leave`. Map repo errors → `LAST_OWNER` → 409, owner-only → 403. Register in `server.ts` alongside the other modules.
- [ ] **Step 4: Run → passes;** `tsc` green.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): members + orgs (switch/list) endpoints"`.

---

## Phase D — Invitations (repo, email, endpoints, accept)

### Task D1: invite-email builder

**Files:**
- Modify: `apps/api/src/env.ts` (add `PUBLIC_WEB_URL: z.string().url().default(<CORS_ORIGIN default>)`)
- Create: `apps/api/src/lib/invite-email.ts`
- Test: `apps/api/src/lib/invite-email.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { buildInviteEmail } from './invite-email.js';
it('includes the org name, role, and accept link', () => {
  const { subject, text, html } = buildInviteEmail({
    orgName: 'Agilec', inviterName: 'Agile Dev', role: 'member',
    acceptUrl: 'http://localhost:5173/invite/abc123',
  });
  expect(subject).toMatch(/Agilec/);
  expect(text).toContain('http://localhost:5173/invite/abc123');
  expect(html).toContain('http://localhost:5173/invite/abc123');
});
```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** `buildInviteEmail(opts)` returning `{ subject, text, html }`; add `PUBLIC_WEB_URL` to `env.ts` (+ `.env.example`).
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): invitation email builder + PUBLIC_WEB_URL"`.

### Task D2: InvitationsRepo (create/list/get/revoke/accept)

**Files:**
- Modify: `apps/api/src/modules/members/repo.ts` (add invitation methods, or a sibling `invitations.repo.ts`)
- Test: `apps/api/src/modules/members/invitations.repo.spec.ts`

- [ ] **Step 1: Failing tests**
  - `create(orgId, { email, role }, invitedBy)` → row with 256-bit token, `expiresAt ≈ now+7d`.
  - `create` duplicate pending email → throws/updates (define: throw `ALREADY_INVITED`).
  - `create` for an email that is already a member → throw `ALREADY_MEMBER`.
  - `getByToken(token)` → returns row or null; expired flagged.
  - `resend(orgId, id)` → sets a fresh `expiresAt = now + 7d` (token unchanged); returns the row.
  - `revoke(orgId, id)` deletes a pending row.
  - `accept(token, { name?, password? }, existingUserId?)` — transaction: create user if no `existingUserId` and email unregistered (hash password via the auth helper), insert `org_members(role)`, set `accepted_at`; idempotent if already a member.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.** Token: `crypto.randomBytes(32).toString('base64url')`. Reuse the password-hash helper from auth. Accept returns `{ userId, organizationId }`.
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): InvitationsRepo create/get/revoke/accept"`.

### Task D3: Invitation endpoints (+ send email, public preview/accept)

**Files:**
- Modify: `apps/api/src/modules/members/routes.ts`
- Test: `apps/api/src/modules/members/invitations.routes.spec.ts`

- [ ] **Step 1: Failing tests**
  - `POST /orgs/current/invitations` as member → 403; as admin → 201 `{ invitation, inviteUrl }`; pending invite stored.
  - With org SMTP configured (seed an integration) the email provider is invoked (use the test override hook like `emails/routes.ts` does — inject a fake provider) ; with no SMTP → still 201 and `inviteUrl` present.
  - `DELETE …/invitations/:id` as admin → 204; pending gone.
  - `GET /invitations/:token` (no auth) → `InvitationPreview`; expired token → `expired: true`.
  - `POST /invitations/:token/accept` for a new email with `{ name, password }` → 201, creates user + membership + session cookie; for an email that already has an account without a matching session → 401.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement.** Reuse `resolveEmail(orgId)` pattern from `emails/routes.ts` to send; accept the same `emailProviderForOrg` test override. On accept success create a session (reuse auth's session-create helper) and set the cookie, with `current_org_id` = this org.
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): invitation create/resend/revoke/preview/accept endpoints"`.

---

## Phase E — Frontend: data hooks

### Task E1: members/orgs API hooks + query keys

**Files:**
- Modify: `apps/web/src/lib/query-keys.ts` (add `members`, `orgs`)
- Create: `apps/web/src/features/members/api.ts`
- Test: typecheck only.

- [ ] **Step 1: Implement** hooks mirroring `features/companies/api.ts`:
  - `useMembers()` → `GET /orgs/current/members` (`{ members, invitations }`).
  - `useMembership()` → derives the **current user's** role (from `useMembers()` matched to `useAuthUser()`/`/auth/me`, or a dedicated lightweight field) — expose `{ role, isAdmin }`.
  - `useOrgs()` → `GET /orgs`.
  - `useSwitchOrg()` → `POST /orgs/switch` then `queryClient.clear()` + navigate to `/app`.
  - `useInviteMember()`, `useRevokeInvitation()`, `useResendInvitation()`, `useChangeMemberRole()`, `useRemoveMember()`, `useLeaveOrg()` — invalidate `queryKeys.members`/`orgs` on success.
- [ ] **Step 2:** `pnpm --filter @dealflow/web exec tsc --noEmit` green.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): members/orgs query hooks"`.

---

## Phase F — Frontend: UI

### Task F1: Org switcher in the header

**Files:**
- Create: `apps/web/src/features/members/org-switcher.tsx`
- Modify: `apps/web/src/routes/app.tsx` (mount in the top bar, left side, per mockup screen 3)

- [ ] **Step 1: Implement** the switcher: button shows current org (from `useOrgs()` + current session org); dropdown lists orgs (current checked) + "Create organization"; selecting calls `useSwitchOrg()`. Follow the design tokens (indigo/slate, rounded, shadow) used elsewhere.
- [ ] **Step 2:** Verify in browser (Playwright/Edge): switcher renders, lists orgs.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): org switcher in app header"`.

### Task F2: Settings → Members page + invite dialog

**Files:**
- Create: `apps/web/src/routes/app.settings.members.tsx`
- Create: `apps/web/src/features/members/invite-dialog.tsx`
- Modify: `apps/web/src/routes/app.settings.index.tsx` (add a "Members" link, like the custom-fields link)

- [ ] **Step 1: Implement** the Members page per mockup screen 1: members table (avatar/name/email, role `<select>` for owner/admin, joined, Remove via `ConfirmDialog`), pending-invite rows (Resend/Revoke), "Invite people" button → `InviteDialog`. Gate role-selects, Remove, and Invite behind `useMembership().isAdmin`. Invite dialog per mockup screen 2 (email + role, Send, Copy link from returned `inviteUrl`, SMTP note).
- [ ] **Step 2:** Verify in browser: list renders; invite dialog opens; as a member the controls are hidden/read-only.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): Settings -> Members page + invite dialog"`.

### Task F3: Public accept-invite page

**Files:**
- Create: `apps/web/src/routes/invite.$token.tsx` (top-level route, not under `/app`)

- [ ] **Step 1: Implement** per mockup screen 4: fetch `GET /invitations/:token` preview; if `expired`/invalid → friendly message; new user (`!emailHasAccount`) → name + password → `POST accept` → on success route to `/app`; existing user → "Sign in to join" (link to `/login?next=/invite/:token`) then accept.
- [ ] **Step 2:** Verify in browser with a real token (create an invite via the API/UI, open `/invite/<token>`).
- [ ] **Step 3: Commit** — `git commit -m "feat(web): public accept-invite page"`.

### Task F4: Gate record edit/delete controls by role + ownership

**Files:**
- Modify: `apps/web/src/routes/app.contacts.$id.tsx`, `app.companies.$id.tsx`, `app.deals.$id.tsx` (and the activity/inline-edit controls as needed)

- [ ] **Step 1: Implement** — compute `canWrite = isAdmin || record.ownerUserId === currentUserId` (use `useMembership()` + the auth user id). Disable the Delete button (and inline-edit save / show a lock tooltip) when `!canWrite`, per mockup screen 6. The server already enforces this; the UI just reflects it.
- [ ] **Step 2:** Verify: as a member, a record you don't own shows disabled Edit/Delete with the lock note; your own is editable.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): gate record edit/delete by role + ownership"`.

---

## Phase G — End-to-end + validation

### Task G1: E2E — invite → accept → switch org

**Files:**
- Create/extend: the Playwright E2E suite (`apps/e2e` — match the existing test layout).

- [ ] **Step 1: Write the E2E** (TDD-style: write it, watch it fail): owner logs in → Settings → Members → invite `e2e+<ts>@example.com` as member → capture the `inviteUrl` (from the API response or a test mailbox/log) → open it in a fresh context → set name+password → lands in `/app` for the org → org switcher shows the org. Use a unique email per run.
- [ ] **Step 2: Run → fails** (before the feature is fully wired) / **passes** after.
- [ ] **Step 3: Commit** — `git commit -m "test(e2e): invite -> accept -> switch org"`.

### Task G2: Cross-package validation + final review

- [ ] **Step 1:** Run the full gate: `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` (API integration on the ephemeral Postgres), `pnpm --filter @dealflow/e2e test:e2e` if runnable locally.
- [ ] **Step 2:** Manually verify the 6 mockup screens in the browser; confirm a member cannot (UI + API) manage the team or edit others' records, and the last owner can't be removed.
- [ ] **Step 3:** Update `docs/superpowers/2026-05-26-testing-checklist.html` with a Team-Management section.
- [ ] **Step 4: Commit** — `git commit -m "test: cross-package validation for team management"`.

---

## Notes / risks for the executor

- **`req.server.db` access:** confirm how Drizzle is reached inside preHandlers — match the existing decorator/import; don't introduce a new global.
- **Session helper reuse:** the accept flow must create a session exactly like `auth/routes.ts` (same cookie name, flags, hashing). Read that module before Task D3.
- **`ERROR_CODES`:** reuse existing codes; add `FORBIDDEN`, `LAST_OWNER`, `NOT_A_MEMBER`, `ALREADY_MEMBER`, `ALREADY_INVITED` to the shared `ERROR_CODES` map if absent (one small commit).
- **Email enumeration:** `GET /invitations/:token` returns `emailHasAccount` — acceptable for MVP (the inviter already knows the email); do not add a separate "does this email exist" endpoint.
- **Migrations dir convention:** match the existing drizzle migration filename/numbering before creating Task A5's file.
