# DealFlow — EngineMailer Email Integration Design

> **Visual mockups (open in a browser):**
> - `2026-06-09-enginemailer-mockup.html` — settings section + send/track data flow + before/after
> - `2026-06-09-sender-identity-mockup.html` — Option A vs B (what the recipient sees)
> - `2026-06-09-email-paywall-mockup.html` — free baseline + Pro custom-domain (the 3 UI states)

**Date:** 2026-06-09 · **Status:** Approved (design) · **Scope:** Replace per-org Gmail/SMTP sending with EngineMailer (REST API send + native webhook open/click tracking), and gate the "send from your own domain" option behind a per-org plan flag.

---

## 1. Goal

Replace DealFlow's per-org SMTP integration (Gmail/Outlook/Yahoo via nodemailer) with **EngineMailer** (a transactional email provider), and replace the self-hosted HMAC tracking-pixel + click-redirect (served over an ngrok tunnel) with **EngineMailer's native open/click webhooks**. Email tracking should work without DealFlow hosting a public pixel or keeping a tunnel up.

**Success criteria**
- An org connects EngineMailer (one API key) and can send email from DealFlow (compose, invitations, test email) via EngineMailer's REST API.
- Opens & clicks update the activity's existing `openCount`/`clickCount`/`firstOpenedAt`/… via an inbound webhook — no pixel, no ngrok.
- A free org sends from DealFlow's shared verified domain with a custom From-name + Reply-To. A **Pro** org can verify and send from its **own** domain.
- The old SMTP section, `/track/*` endpoints, HMAC token util, pixel/redirect HTML injection, and the ngrok-for-tracking dependency are removed.

## 2. Key decisions (from brainstorming)

1. **Replace SMTP entirely** — EngineMailer is the only send path. Remove the SMTP UI + provider. Existing orgs on SMTP get a one-time "reconnect via EngineMailer" prompt; until reconnected, email is disabled for that org (sending already degrades to a Noop/`EMAIL_DISABLED` today).
2. **Delete the self-hosted tracking pixel + click-redirect + ngrok dependency** — tracking is 100% EngineMailer webhooks.
3. **Sender identity:**
   - **Option A (free, default):** send from DealFlow's shared verified domain (`PUBLIC_EMAIL_DOMAIN`, e.g. `notifications@dealflow.app`); org sets **From name** + **Reply-To**.
   - **Option B (Pro):** org verifies its **own** domain (DNS records) and sends from e.g. `hello@acme.com`.
4. **Pro is a per-org `plan` flag now; real billing later.** `organizations.plan ∈ {'free','pro'}`. Custom-domain UI + endpoints check `plan === 'pro'`. The "Upgrade" button is a placeholder; for now an **owner** can flip the flag (a dev/manual path). **Stripe Checkout is explicitly out of scope** — a separate future project; the UI is built so the upgrade CTA becomes a Stripe link with no structural change.
5. **Single shared EngineMailer account/API key** owned by DealFlow is the assumed deployment (one verified shared domain for Option A; Pro orgs' domains are verified in that same account). *(Per-org "bring your own key" is not this design.)*
6. **Webhook is configured once, manually** (copy URL → paste into EngineMailer), not auto-registered via API.
7. **Real host, not ngrok.** The webhook + API run on a deployed host with a stable `PUBLIC_API_URL`.

## 3. ⚠️ EngineMailer API contract — confirm BEFORE building (Phase 0)

The public marketing/docs confirmed: REST API for transactional send, real-time webhooks that POST JSON for **open & click** events, "Free Forever" 10k/mo (500/day). The following are **not yet confirmed** and the adapter/webhook depend on them — a short spike must verify them against EngineMailer's real API docs/dashboard before Phase 1:

- **Send endpoint:** exact URL, HTTP method, auth header (API key in header vs body), request body shape (to/from/subject/html/text/cc/bcc/attachments), and the **response field that returns a message id** (needed to correlate). Note one transactional REST doc is marked *Deprecated* — find the current one.
- **Custom metadata round-trip:** can a send include a custom field / tag / header (our DealFlow `activityId`) that the **webhook echoes back**? This is how we map an event → the right activity. If not, fallback = store EngineMailer's returned message-id on the activity and match the webhook by message-id.
- **Webhook payload + security:** event type names (open/click/delivered/bounce/spam), whether the **click event includes the clicked URL**, and how the webhook is **authenticated** (HMAC signature header vs the "key in URL" mentioned in their docs). We must verify inbound webhooks.
- **Option B feasibility:** does ONE EngineMailer account support **multiple verified sending domains** (so Pro orgs add their own), and is there an API to add/verify a domain + read its DNS records + verification status? If there's no API, Option B may require manual per-domain setup in EngineMailer (degrade the "Verify" button to instructions). 
- **SMTP relay?** If EngineMailer offers SMTP we *could* keep nodemailer; but the plan assumes the **REST API** (HTTP) since SMTP wasn't confirmed.

If any are unavailable, revisit the affected slice (esp. Option B) — they don't block Option A + open/click tracking via message-id matching.

## 4. Data model

- **`organizations.plan`** — new `text` column, `'free' | 'pro'`, default `'free'`, CHECK constraint. Hand-authored journaled migration (drizzle-kit `generate` is broken in this repo; follow the 0011/0012 precedent).
- **`org_integrations` JSONB** — replace the `smtp` block with an `engineMailer` block: `{ apiKey: <encrypted>, fromName, replyTo, sendingMode: 'shared'|'custom', fromEmail?, customDomain?, domainVerified? }`. Reuse the existing AES-256-GCM encryption for `apiKey`.
- **`activities`** — unchanged. Keep `openCount`, `clickCount`, `firstOpenedAt`, `lastOpenedAt`, `firstClickedAt`, `lastClickedAt`, `deliveryStatus`, `externalId` (store EngineMailer's message-id here for webhook matching).
- Drop nothing destructive from the DB for SMTP — the `smtp` JSON key simply stops being read/written (leave old data inert).

## 5. Shared package (`packages/shared`)

- `engineMailerConfigSchema` (update body): `{ apiKey?: string, fromName: string, replyTo: z.string().email(), sendingMode: z.enum(['shared','custom']), fromEmail?: z.string().email() }`. `apiKey` optional on update (unchanged-when-blank, like SMTP pass today).
- `orgPlanSchema = z.enum(['free','pro'])`.
- DTOs: `PublicEmailIntegration` (masked: `connected`, `fromName`, `replyTo`, `sendingMode`, `fromEmail`, `domainVerified`, `keyHint`), `CustomDomainStatus` (`{ domain, records: DnsRecord[], status: 'pending'|'verified' }`).
- New `ERROR_CODES`: `EMAIL_NOT_CONFIGURED`, `PLAN_UPGRADE_REQUIRED`, `DOMAIN_NOT_VERIFIED`, `WEBHOOK_SIGNATURE_INVALID`.

## 6. Backend (`apps/api`, `packages/email`)

### 6.1 Provider (`packages/email`)
- Add `EngineMailerEmailProvider implements EmailProvider` (sibling to `SmtpEmailProvider`) — `send(input)` calls EngineMailer's REST API via `fetch`, returns `{ messageId }`. Include the DealFlow `activityId` as a tag/custom field (per Phase-0 finding) and set Reply-To.
- Update `factory.ts`: `EmailConfig` gains `engineMailer?`, `buildEmailProvider` returns the EngineMailer provider when configured, else `NoopEmailProvider`. **Remove `SmtpEmailProvider` + nodemailer** + `SmtpConfig`. `describeEmail`/`isEmailEnabled` updated for EngineMailer.
- Keep the `EmailProvider` interface + `SendEmailInput/Output` unchanged (the seam that makes this swap small).

### 6.2 Integrations repo + routes
- `OrgIntegrationsRepo`: replace `smtp` (stored/decrypted/masked) with `engineMailer`. `getDecrypted` returns the EngineMailer config for the sender; `getMasked` returns `PublicEmailIntegration`.
- Routes (`modules/integrations/routes.ts`, all `requireOrg` + mutations `requireRole(['owner','admin'])`):
  - `PATCH /api/v1/integrations` — save EngineMailer config (apiKey/fromName/replyTo/sendingMode/fromEmail).
  - `POST /api/v1/integrations/test-email` — send a test via EngineMailer.
  - `POST /api/v1/integrations/custom-domain` — **Pro only** (`plan==='pro'` else 403 `PLAN_UPGRADE_REQUIRED`); register/return DNS records + status (depends on Phase-0 Option-B finding; if no API, returns static records + manual instructions).
  - `POST /api/v1/integrations/custom-domain/verify` — Pro only; re-check verification.
- `PATCH /api/v1/organizations/current` already exists; extend to accept `plan` (owner-only) as the temporary upgrade path.

### 6.3 Webhook ingestion (replaces the pixel)
- `POST /api/v1/webhooks/engine-mailer` — **public** (no session) but **verifies the EngineMailer signature/key** (per Phase-0 finding) → else 401 `WEBHOOK_SIGNATURE_INVALID`. Parse the event, find the activity (by echoed `activityId` or by `externalId` message-id), and apply the mapping:
  | Event | Effect |
  |---|---|
  | open | `openCount++`, `firstOpenedAt = COALESCE(...)`, `lastOpenedAt = now` |
  | click | `clickCount++`, `firstClickedAt = COALESCE(...)`, `lastClickedAt = now` (+ store URL) |
  | delivered | `deliveryStatus = 'delivered'` |
  | bounce | `deliveryStatus = 'bounced'` |
  | spam/complaint | flag activity |
  - Always return 200 quickly (EngineMailer doesn't retry non-200). Unknown/unmatched events → 200 + log, no error.
- Register in `server.ts`.

### 6.4 Send sites
- `modules/emails/routes.ts` (compose) and `lib/invite-email.ts` (invitations) already call `buildEmailProvider(...).send(...)`. They keep working through the new provider. **Stop wrapping the body** with the pixel/redirect (`email-html-wrap.ts` injection) — send the HTML as-is (EngineMailer adds its own tracking). Stamp the activity's `externalId` with EngineMailer's returned message-id.

### 6.5 Removals
- Delete `modules/emails/tracking-routes.ts` (`/track/open`, `/track/click`) + its server registration.
- Delete `lib/email-tracking-token.ts` (HMAC) + tests.
- Remove the pixel/redirect injection from `lib/email-html-wrap.ts` (keep plain text→HTML wrapping if still used).
- Delete `packages/email/src/providers/smtp.ts` (+ test) and the SMTP UI section.
- Remove the ngrok-for-tracking dependency from docs/runbook (`PUBLIC_API_URL` now points at the real deployed host).

## 7. Frontend (`apps/web`)

- Replace `features/integrations/smtp-integration-section.tsx` with **`email-integration-section.tsx`** (the mockup's State 1 free card: API key, From name, Reply-To, managed sending address, Save, Send test).
- Add **`custom-domain-section.tsx`** — renders the **locked Pro upsell** (mockup State 1 lower card + State 2 dialog) when `plan==='free'`, and the **domain-verification card** (mockup State 3: From email + DNS records + Verify) when `plan==='pro'`. Owner/admin only; members read-only.
- Hooks in `features/integrations/api.ts`: `useEmailIntegration`, `useUpdateEmailIntegration`, `useTestEmail` (exists), `useCustomDomain`, `useVerifyDomain`, `useUpgradePlan` (temporary: PATCH org plan).
- ui-ux-pro-max rules applied (from the approved mockup): locked-state sells the benefit, progressive disclosure (DNS hidden until Pro), one primary CTA per card, SVG icons (lucide) not emoji, lock-icon + "Pro" text (not colour alone), helper text under fields, AA contrast, free sending never blocked.
- The Engagement timeline on the activity detail page is **unchanged** — same fields, now fed by the webhook.

## 8. Migration / cut-over

- Migration adds `organizations.plan`. No destructive SMTP data removal.
- Orgs that had SMTP configured: on next Settings visit, the Email card shows "Reconnect with EngineMailer" (since `engineMailer` is unset). Sending is disabled for that org until reconnected (same `EMAIL_DISABLED` behavior as an unconfigured org today) — acceptable for this solo project.
- `PUBLIC_EMAIL_DOMAIN` env var (DealFlow's shared verified sending domain) added to `env.ts` + `.env.example`.

## 9. Error handling & edge cases

- No EngineMailer key → send returns `EMAIL_NOT_CONFIGURED` (compose UI already hides the Email button when `email/status` is disabled).
- Custom-domain endpoints when `plan!=='pro'` → 403 `PLAN_UPGRADE_REQUIRED`.
- Sending from a custom domain that isn't verified yet → block, fall back to shared domain, or 409 `DOMAIN_NOT_VERIFIED` (decide in plan; default: fall back to shared so mail still sends).
- Webhook: bad signature → 401; unmatched activityId/message-id → 200 + log (don't error EngineMailer).
- Downgrade Pro→free → custom domain stops being used; sending falls back to the shared domain automatically (no lost mail).

## 10. Testing

- **Provider unit test:** `EngineMailerEmailProvider.send` builds the right request (mock fetch), returns messageId, includes activityId tag + Reply-To.
- **Webhook integration tests** (schema-per-test Supabase harness): valid open event → `openCount++`; click → `clickCount++` (+URL); delivered/bounce → status; **bad signature → 401**; unmatched id → 200 no-op; events scoped to the right org/activity (tenancy).
- **Integration routes:** save config (owner/admin only; member 403); test-email; custom-domain endpoints require `plan==='pro'` (free → PLAN_UPGRADE_REQUIRED).
- **Plan gating:** free org can't hit custom-domain endpoints; owner can set plan.
- **Regression:** compose + invitation send paths still work through the new provider; the removed `/track/*` routes are gone (404).
- Frontend: typecheck + live browser pass on the 3 Settings states.

## 11. Out of scope (later)

- **Stripe / real billing** (separate project). Plan flag is the seam.
- Per-org "bring your own EngineMailer key".
- Multi-provider abstraction (Resend/SES) — the `EmailProvider` interface already allows it later.
- Bulk/marketing campaigns, unsubscribe management.

## 12. Suggested build order (for the plan)

0. **Spike:** confirm EngineMailer API contract (§3) — send endpoint, metadata round-trip, webhook payload + signature, Option-B domain API. Write findings into the plan before coding.
1. `organizations.plan` migration + shared schemas/error codes.
2. `EngineMailerEmailProvider` + factory swap; remove SmtpEmailProvider.
3. Integrations repo + routes (save/test) for EngineMailer; remove SMTP UI; new Email settings section (free state).
4. Webhook ingestion route + event→activity mapper (+ tests); stamp `externalId`; stop pixel injection.
5. Delete `/track/*`, HMAC token util, pixel wrap; drop ngrok-for-tracking.
6. Plan flag gating + custom-domain section (locked upsell + verification UI) + endpoints.
7. Cross-package validation + browser pass + checklist update.
