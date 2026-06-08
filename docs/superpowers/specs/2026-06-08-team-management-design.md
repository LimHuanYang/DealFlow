# DealFlow Phase 2 — Team Management (Invitations, Members, Multi-Org) Design

> **Visual companion:** `docs/superpowers/specs/2026-06-08-team-management-mockup.html` (open in a browser) shows every screen and the API/flow/test panels. This doc is the written spec the implementation plan is built from.

**Date:** 2026-06-08
**Status:** Approved (design)
**Scope:** One sub-project — *Team Management*. Google OAuth is a separate Phase-2 sub-project (its own spec later).

---

## 1. Goal

Let an organization owner/admin invite teammates by email, manage their roles, and let users belong to and switch between multiple organizations — with role- and ownership-based permissions enforced on every endpoint.

**Success criteria**

- Owner/admin can invite a teammate by email + role; the invitee can accept and join.
- A user can belong to several orgs and switch the active org from the top bar.
- Roles (`owner`/`admin`/`member`) gate team administration and settings.
- A `member` can view all org records but edit/delete only records they own.
- Multi-tenancy holds: no endpoint leaks or mutates another org's data; automated tests prove it.

## 2. Key decisions (from brainstorming)

1. **Multi-org with switcher** — a user ↔ many orgs (`org_members` join already supports it); a top-bar org switcher sets the active org via `sessions.current_org_id`.
2. **Permissions = team-admin gating + member data restriction.**
3. **Member data restriction = "see all, edit/delete own"** — members read the whole org but may write/delete only records where `ownerUserId === me`; owner/admin bypass. Creator becomes owner on create; owner/admin can reassign.
4. **Enforcement = lightweight guards + ownership helper** (not CASL, not RLS — RLS was explicitly deferred in the Phase-1 kernel design).

## 3. Permission model

### Capability matrix

| Capability | owner | admin | member |
|---|---|---|---|
| Use CRM, create records | ✓ | ✓ | ✓ |
| View all org records | ✓ | ✓ | ✓ |
| Edit/delete **any** record | ✓ | ✓ | ✗ |
| Edit/delete **own** records (`ownerUserId === me`) | ✓ | ✓ | ✓ |
| Reassign a record's `ownerUserId` | ✓ | ✓ | ✗ |
| Invite / remove members, change member roles | ✓ | ✓ | ✗ |
| Promote/demote **owner** (transfer ownership) | ✓ | ✗ | ✗ |
| Org settings, integrations (SMTP/AI), custom-field **definitions** | ✓ | ✓ | ✗ |

### Invariants

- An org always has **≥1 owner**. The last owner cannot be demoted, removed, or leave.
- Only an **owner** may set or remove the `owner` role (ownership transfer). An admin may manage members but **cannot** modify owners or other admins, nor promote anyone to owner.
- A user cannot change **their own** role. A non-last-owner user may **leave** an org.

## 4. Data model

All three tables already exist — **no new tables**.

- `org_members(organization_id, user_id, role, joined_at)` — PK `(organization_id, user_id)`; `role ∈ {owner, admin, member}`.
- `invitations(id, organization_id, email citext, role, token unique, invited_by, expires_at, accepted_at, created_at)`.
- `oauth_accounts` — untouched (OAuth sub-project).
- `sessions.current_org_id` — already present; switching updates this column.
- Entities `contacts/companies/deals/activities` already have nullable `owner_user_id`.

**Migrations**

- **M1 — backfill `owner_user_id`:** for each of contacts/companies/deals/activities, set `owner_user_id = <org's owner user_id>` where currently `NULL`, so legacy rows have an owner and remain editable by owner/admin (and not accidentally member-locked). Idempotent `UPDATE … WHERE owner_user_id IS NULL`.
- No schema/DDL changes required.

## 5. Shared package (`packages/shared`)

- `orgRoleSchema = z.enum(['owner','admin','member'])` and `assignableRoleSchema = z.enum(['admin','member'])` (roles an admin may assign).
- `createInvitationBodySchema = { email: z.string().email(), role: assignableRoleSchema }`.
- `acceptInvitationBodySchema = { name?: string, password?: string }` (required only when the email has no existing user).
- `updateMemberRoleBodySchema = { role: orgRoleSchema }`.
- `switchOrgBodySchema = { organizationId: z.string().uuid() }`.
- Public DTO types: `PublicMember`, `PublicInvitation`, `PublicOrgSummary`, `InvitationPreview`.

## 6. Backend

### 6.1 Auth/membership middleware (`apps/api/src/plugins`)

- Extend the request context with the caller's membership for the active org. Add a `loadMembership` step (folded into `requireOrg` or run immediately after it) that selects the `org_members` row for `(currentOrgId, userId)` and attaches `req.membership = { role: OrgRole }`. If no row exists → 403 `NOT_A_MEMBER` (shouldn't happen in normal flow; guards a stale session).
- `requireRole(roles: OrgRole[])` — preHandler factory returning 403 `FORBIDDEN` when `req.membership.role ∉ roles`. Used on team-admin, settings, integrations, and custom-field-definition routes.
- `assertCanWrite(role, ownerUserId, userId)` — pure helper; returns/throws. Allowed when `role ∈ {owner, admin}` **or** `ownerUserId === userId`; else 403 `FORBIDDEN`. Called in entity update/delete handlers after loading the row.

### 6.2 Repos / modules

New module **`apps/api/src/modules/members`** (or extend `organizations`):
- `MembersRepo` — list members (join `users` for name/email), change role, remove, leave; enforces invariants (last-owner guard, owner-only owner-role changes).
- `InvitationsRepo` — create (random 256-bit token, `expires_at = now + 7d`), list pending (per org, `accepted_at IS NULL AND expires_at > now`), get by token, revoke, accept (transaction: insert `org_members`, set `accepted_at`, create user if needed).
- `OrgsRepo` (or extend `organizations`) — list orgs for a user with their role; switch active org (verify membership, update `sessions.current_org_id`).

Invitation email reuses the existing email stack: `loadEmailConfig(integrations, orgId)` + `buildEmailProvider` (same pattern as `modules/emails/routes.ts`). New `apps/api/src/lib/invite-email.ts` builds the subject/body with the accept URL `${WEB_BASE}/invite/<token>`, where `WEB_BASE` comes from a **new `PUBLIC_WEB_URL` env var** that defaults to the existing `CORS_ORIGIN` (`http://localhost:5173` in dev). Add `PUBLIC_WEB_URL` to `env.ts` + `.env.example`. If the org has no SMTP, the create endpoint still succeeds and returns the invite URL so the UI can offer **copy link**.

### 6.3 Endpoints

Members & roles (preHandler `requireOrg`; mutations also `requireRole(['owner','admin'])`):
- `GET /api/v1/orgs/current/members` → `{ members: PublicMember[], invitations: PublicInvitation[] }`
- `PATCH /api/v1/orgs/current/members/:userId` `{ role }` → change role (owner-role changes are owner-only; last-owner guard)
- `DELETE /api/v1/orgs/current/members/:userId` → remove (last-owner guard; can't remove self here)
- `POST /api/v1/orgs/current/members/leave` → caller leaves (last-owner guard)

Invitations:
- `POST /api/v1/orgs/current/invitations` `{ email, role }` → `requireRole(['owner','admin'])`; creates + emails; returns `{ invitation, inviteUrl }`
- `POST /api/v1/orgs/current/invitations/:id/resend` → `requireRole(['owner','admin'])`; new expiry + re-email
- `DELETE /api/v1/orgs/current/invitations/:id` → `requireRole(['owner','admin'])`; revoke (delete pending row)
- `GET /api/v1/invitations/:token` → **public** (no auth); returns `InvitationPreview { orgName, inviterName, role, emailHasAccount, expired }`
- `POST /api/v1/invitations/:token/accept` → accept; if `emailHasAccount` requires an authenticated session for that user (else 401 to prompt login); else creates the user from `{ name, password }`. Transactionally inserts `org_members`, sets `accepted_at`, and sets the new/!current session's `current_org_id` to this org.

Multi-org:
- `GET /api/v1/orgs` → `{ orgs: PublicOrgSummary[] }` (orgs the caller belongs to + their role)
- `POST /api/v1/orgs/switch` `{ organizationId }` → verify membership → update `sessions.current_org_id` → 200

Existing entity endpoints — **add enforcement** (contacts, companies, deals, activities):
- On create: set `ownerUserId = req.user.id` (in the repo create).
- On update/delete: load row, call `assertCanWrite(req.membership.role, row.ownerUserId, req.user.id)`.
- Allow owner/admin to set `ownerUserId` via update (reassign); reject member attempts to change it.
- Apply `requireRole(['owner','admin'])` to custom-field-definition, integrations, and org-settings mutation routes.

## 7. Frontend (`apps/web`)

- **Org switcher** — top-bar dropdown in `routes/app.tsx`: lists `GET /orgs`, current marked, "Create organization" (links to the existing create-org/signup-new-org flow). Selecting calls `POST /orgs/switch` then invalidates all queries / reloads.
- **Settings → Members** — new route `routes/app.settings.members.tsx` + a link from the Settings index: members table (avatar, name, email, role, joined), pending-invite rows (Resend/Revoke), "Invite people" button. Role dropdowns + Remove shown only to owner/admin (gated on the caller's role from `GET /orgs/current/members` or a `useMembership()` hook). `ConfirmDialog` guards Remove / role-demotion.
- **Invite dialog** — email + role; "Send invite" (POST) and "Copy invite link" (uses returned `inviteUrl`); SMTP note.
- **Accept-invite page** — public route `routes/invite.$token.tsx` (outside `/app`): fetches preview; new user → name + password → `accept`; existing user → "Sign in to join" → `accept`. Friendly expired/invalid state.
- **Record UI** — Edit/Delete controls disabled for members on records they don't own (reuse the role + `ownerUserId` to decide), with a tooltip. Detail pages already have the Delete button from the prior commit; gate it.
- Feature folder `features/members/` (API hooks `useMembers`, `useInvitations`, `useOrgs`, `useSwitchOrg`, `useMembership`).

## 8. Error handling & edge cases

- Duplicate invite (same email, pending) → 409 or update-in-place (resend semantics); duplicate of an existing member → 409 `ALREADY_MEMBER`.
- Accept when already a member → idempotent success (no double-join).
- Expired/invalid/revoked token → 410/404 with a friendly preview state.
- Last-owner guard on demote/remove/leave → 409 `LAST_OWNER`.
- Switch to an org you're not a member of → 403.
- Removing a member does **not** delete their records; their `ownerUserId` rows remain (now editable only by owner/admin) — acceptable for MVP.

## 9. Testing

- **Tenancy** per endpoint: a user in org B gets 404/403 on org A's members, invitations, and records.
- **Role gating:** member blocked (403) from invite / role-change / remove / settings / custom-field-def mutations.
- **Member write-own:** member can update/delete owned records; 403 on others'; create sets owner = self.
- **Invariants:** last-owner cannot be demoted/removed/leave; only owner changes owner role; admin can't touch owners/admins.
- **Invitations:** create→email/url; expired & invalid tokens rejected; accept creates membership exactly once; existing-user accept requires that user's session.
- **Switching:** `GET /orgs` returns only memberships; `switch` updates session; data scopes to the new org.
- **E2E (Playwright):** invite → accept (new user) → switch org.
- Tests run against the ephemeral CI Postgres (per `pnpm test` harness).

## 10. Out of scope (later)

- Google OAuth (separate sub-project).
- Granular per-field permissions, custom roles, audit-log UI, SSO/SAML, billing/seats.
- Soft delete; email-verification gating of invites.

## 11. Suggested build order (for the plan)

1. Shared schemas + `loadMembership`/`requireRole`/`assertCanWrite` + backfill migration (+ tests).
2. Apply ownership enforcement to existing entity endpoints (+ tenancy/role tests).
3. Members endpoints + repo (list/role/remove/leave, invariants).
4. Invitations endpoints + repo + invite email (create/resend/revoke/preview/accept).
5. Multi-org endpoints (`GET /orgs`, `POST /orgs/switch`).
6. Frontend: org switcher → Members page + invite dialog → accept-invite page → record-control gating.
7. E2E + cross-package validation.
