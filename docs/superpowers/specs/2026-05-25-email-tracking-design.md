# Email Tracking v1 — Design Spec

**Date:** 2026-05-25
**Status:** Approved
**Scope:** Outbound email tracking (opens + clicks + delivery) and compose-flow enhancements (CC, BCC, per-send tracking toggle). Reply detection and attachments deferred to separate follow-up sub-plans.
**Mockups:** [`2026-05-25-email-tracking-mockups.html`](./2026-05-25-email-tracking-mockups.html) — open in a browser for visual reference.

---

## 1. Goal

When a user sends an email through DealFlow's compose dialog, the server wraps the body in HTML, embeds a tracking pixel, and rewrites all outbound links through a redirect proxy. Recipients who open the email or click links produce events that DealFlow records and surfaces in the UI. The user can opt out of tracking per send. The user can add CC and BCC recipients.

## 2. Non-goals (deferred)

- **Reply detection** — needs an inbound email pipeline (IMAP polling, dedicated MX, or webhook from a service like Postmark Inbound). Separate sub-plan.
- **True bounce detection** — also requires inbound (parsing bounce messages). For v1 we record only `delivery_status: 'sent' | 'failed'` based on the synchronous SMTP response.
- **Attachments** (file or inline image) — needs decisions on storage backend, size limits, MIME validation, and upload protocol. Separate sub-plan.
- **HTML rich-text editor** in compose — the textarea stays plain-text; the server auto-wraps to HTML at send time.
- **Unsubscribe link injection** — B2B sales tool, not a consumer marketing tool.
- **Custom tracking subdomain** (e.g. `track.yourdomain.com`) — uses the same hostname as the API.
- **A/B testing, sequences, templates.**

## 3. Architecture

**Self-hosted tracking.** The API hosts public unauthenticated routes `GET /track/open/:token` and `GET /track/click/:token` that read events from recipient interactions. No third-party service. The recipient's email client makes plain HTTP requests to these URLs.

**Token format.** Each tracking URL embeds a token: `<base64url(activityId)>.<base64url(hmac)>` where `hmac = HMAC_SHA256(EMAIL_TRACKING_SECRET, activityId)`. The handler decodes, verifies, then looks up the activity. Forging requires the secret. Token rotation is out of scope — only one secret at a time. Rotating it invalidates in-flight tokens, which is acceptable for a solo product at this scale.

**Two new env vars** (`apps/api/.env`):

- `PUBLIC_API_URL` — e.g. `http://localhost:3000` for dev, `https://crm.yourdomain.com` for prod. Used to build absolute tracking URLs.
- `EMAIL_TRACKING_SECRET` — 32+ byte random string used for HMAC. Lives next to `INTEGRATION_ENCRYPTION_KEY` in `apps/api/.env` (gitignored).

**Send-side flow.**

1. POST `/api/v1/emails` accepts `{ contactId, subject, body, cc?, bcc?, trackEnabled? }`.
2. Server resolves the contact's email, the org's SMTP config, and the sender's user row.
3. INSERT activity row with `kind='email'`, `tracking_enabled = trackEnabled ?? true`, `cc_emails`, `bcc_emails`, `delivery_status='sent'` (provisional).
4. If `tracking_enabled`: generate token from the new `activity.id`, build HTML body (multipart/alternative), inject pixel + rewrite links. Else send plain-text only.
5. SMTP send via per-org config. On success: UPDATE activity with the SMTP `messageId`. On failure: UPDATE activity with `delivery_status='failed'` and return 502 to the API caller.
6. INSERT an `email_events` row with `event_type='sent'` (success only) for the activity timeline.

**Tracking-side flow.**

`GET /track/open/:token`:
1. Verify token. On failure: return 200 + 1×1 pixel (don't break recipient's mail client).
2. Look up activity. If missing or `tracking_enabled=false`: return 200 + pixel, no event.
3. Transaction: INSERT `email_events` row (`event_type='open'`); UPDATE `activities` (`open_count += 1`, `first_opened_at = COALESCE(first_opened_at, NOW())`, `last_opened_at = NOW()`).
4. Return 200 + 43-byte transparent GIF, `Cache-Control: no-store`.

`GET /track/click/:token?u=<base64url-encoded-url>`:
1. Verify token. On failure: return 400 "Invalid tracking link" (NOT a blind redirect — that's an open-redirect vuln).
2. Decode URL. Reject if scheme is not `http://` or `https://`.
3. Look up activity. If missing or `tracking_enabled=false`: return 302 to the decoded URL anyway (don't punish recipient), but record no event.
4. Transaction: INSERT `email_events` (`event_type='click'`, `url=<decoded>`); UPDATE `activities` (`click_count += 1`, first/last_clicked_at).
5. Return 302 with `Location: <decoded URL>`.

**Denormalization rationale.** The activity row carries aggregate counts so feed-row rendering is a single-row read with no join. The `email_events` table powers the activity-detail timeline and dashboard list. Both stay consistent because update + insert happen in one transaction.

## 4. Data model

### Extension to `activities` (8 new columns)

```sql
ALTER TABLE activities
  ADD COLUMN tracking_enabled boolean      NOT NULL DEFAULT true,
  ADD COLUMN cc_emails        text[]                DEFAULT NULL,
  ADD COLUMN bcc_emails       text[]                DEFAULT NULL,
  ADD COLUMN delivery_status  text         NOT NULL DEFAULT 'sent',
  ADD COLUMN open_count       integer      NOT NULL DEFAULT 0,
  ADD COLUMN first_opened_at  timestamptz,
  ADD COLUMN last_opened_at   timestamptz,
  ADD COLUMN click_count      integer      NOT NULL DEFAULT 0,
  ADD COLUMN first_clicked_at timestamptz,
  ADD COLUMN last_clicked_at  timestamptz;
```

`delivery_status` is `'sent' | 'failed'`. These columns are populated only for `kind='email'` rows; defaults are correct for `note`/`task`/etc. (tracking_enabled=true is irrelevant when no tracking ever happens).

### New table `email_events`

```sql
CREATE TABLE email_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  activity_id     uuid        NOT NULL REFERENCES activities(id)    ON DELETE CASCADE,
  event_type      text        NOT NULL,        -- 'sent' | 'open' | 'click'
  url             text,                         -- non-null for 'click'
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_events_activity_idx ON email_events (activity_id, occurred_at DESC);
CREATE INDEX email_events_org_idx      ON email_events (organization_id, occurred_at DESC);
```

Every event row carries `organization_id` for tenant-scoped queries (rollup endpoints, dashboard list). The `activity_id` cascade-deletes events when an activity is removed.

### Shared schema additions (`packages/shared/src/emails.ts`)

```ts
sendEmailBodySchema = z.object({
  contactId:    z.string().uuid(),
  subject:      z.string().min(1).max(200),
  body:         z.string().min(1).max(50_000),
  cc:           z.array(z.string().email()).max(20).optional(),
  bcc:          z.array(z.string().email()).max(20).optional(),
  trackEnabled: z.boolean().optional(),  // default true
});
```

One boolean covers both opens and clicks. The UI shows one checkbox ("Track opens and clicks"); the API accepts one flag. No separate per-feature toggle in v1 — YAGNI until someone asks.

## 5. API surface

### New / changed endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/emails` | session+org | Send email. Extended body schema (cc, bcc, tracking). Returns 201 with `{ activity: PublicActivity }`. |
| `GET` | `/api/v1/activities/:id/events` | session+org | List `email_events` for an activity. Returns `{ items: PublicEmailEvent[] }`, ordered desc by `occurred_at`. Tenant-scoped. |
| `GET` | `/api/v1/emails` | session+org | List sent emails for `/app/emails` dashboard. Query: `status` (all / opened / clicked / failed), `range` (7d / 30d / all), `q` (subject search), cursor pagination. Returns `{ items: PublicEmailRow[], nextCursor }`. |
| `GET` | `/api/v1/emails/engagement/:entityType/:id` | session+org | Engagement rollup for a contact/company/deal. `:entityType` ∈ `{contact, company, deal}`. Returns `{ sent, opened, openedPct, clickedWith, clickedWithPct, lastActivityAt }`. Returns 200 + zeros if entity has no sent emails. |
| `GET` | `/track/open/:token` | **public** | Pixel handler. Always 200 + GIF. |
| `GET` | `/track/click/:token` | **public** | Click redirect. 302 to decoded URL on success, 400 on invalid token/URL. |

The public `/track/*` routes register at the root of the Fastify app (no `/api/v1` prefix) to keep tracking URLs short for plain-text contexts.

### Extension to `PublicActivity`

```ts
interface PublicActivity {
  // existing fields …
  ccEmails: string[] | null;
  bccEmails: string[] | null;
  trackingEnabled: boolean;
  deliveryStatus: 'sent' | 'failed';
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  clickCount: number;
  firstClickedAt: string | null;
  lastClickedAt: string | null;
}
```

These default to `null` / `0` / `false` / `'sent'` for non-email kinds; the UI gates rendering on `kind === 'email'`.

## 6. Server-side modules

- **`apps/api/src/lib/email-tracking-token.ts`** — `signToken(activityId)` and `verifyToken(token)`. Pure functions, unit tested.
- **`apps/api/src/lib/email-html-wrap.ts`** — `wrapBodyAsHtml(plainBody, { pixelUrl, rewriteLink })`. Escapes HTML, preserves line breaks (`<br>`), rewrites all `http(s)://` matches into anchor tags pointing at the click endpoint, appends pixel. Returns `{ html, text }` for multipart/alternative. Unit tested.
- **`apps/api/src/modules/emails/routes.ts`** — extends existing POST `/api/v1/emails`; adds GET `/api/v1/emails`, GET `/api/v1/emails/engagement/:entity/:id`, and (probably in a sibling file) the public `/track/open/:token` and `/track/click/:token` routes.
- **`apps/api/src/modules/activities/routes.ts`** — adds GET `/api/v1/activities/:id/events`.
- **`packages/email/src/provider.ts`** — extend `EmailProvider.send()` signature to accept `cc?: string[]`, `bcc?: string[]`, and to send multipart (`html` + `text`) when both are present.

## 7. Frontend modules

- **`apps/web/src/features/emails/compose-email-dialog.tsx`** — extend with CC/BCC reveal + "Track opens and clicks" checkbox. CC/BCC inputs use comma-separated strings; client validates each email with the existing `isEmailLike` regex.
- **`apps/web/src/features/emails/email-tracking-badge.tsx`** — new component rendered inside activity-feed rows for `kind === 'email'`. Variants: opened+clicked, opened only, awaiting, failed, tracking-off (renders nothing).
- **`apps/web/src/features/emails/email-engagement-timeline.tsx`** — new section on the activity detail page. Calls the new `GET /:id/events` endpoint. Shows a vertical timeline (most recent first) with colored dots per event type.
- **`apps/web/src/features/emails/email-engagement-rollup.tsx`** — new card on contact/company/deal detail pages. Renders zero state by hiding entirely if `sent === 0`.
- **`apps/web/src/routes/app.emails.tsx`** — new file route at `/app/emails`. Filters (status + range), subject search, paginated table linking each row to the existing activity detail page.
- **`apps/web/src/components/app-sidebar.tsx`** — add an "Emails" entry between "Tasks" and existing items.

## 8. Error handling

| Situation | Behavior |
|---|---|
| Invalid HMAC on `/track/open/:token` | Return 200 + transparent GIF, no event |
| Invalid HMAC on `/track/click/:token` | Return 400 "Invalid tracking link" — NEVER blind-redirect (open-redirect vuln) |
| Activity not found on `/track/open` | Return 200 + GIF, no event |
| Activity not found on `/track/click` | Return 400 |
| Decoded URL has bad scheme (`javascript:`, `data:`, relative) | Return 400 |
| DB write fails inside open handler | Log + return 200 + GIF anyway |
| DB write fails inside click handler | Log + 302 to decoded URL anyway (don't punish recipient) |
| SMTP send fails | UPDATE activity `delivery_status='failed'`, no events; return 502 to API caller |
| `tracking_enabled=false` activity | `/track/*` still validates the token but writes no event; click redirect still happens |
| CC/BCC array has an invalid email | Reject the whole POST with 400 + `details.cc[i]` field error |

## 9. Security

- **HMAC tokens** prevent forgery. Secret lives in env, never in DB.
- **Click handler URL validation** — only `http://` or `https://` schemes allowed. Whitelist, not blacklist.
- **Public endpoints** are rate-limited only by the natural per-token economy (one token per sent email). No explicit IP-based limit in v1.
- **No PII captured.** Per the brainstorm, we record only timestamp + event type + URL. No IP, no user-agent, no geo.
- **Tenant isolation** — every `email_events` row carries `organization_id`. All read queries (engagement rollup, dashboard list, detail timeline) join through the activity to enforce `activity.organization_id = req.session.currentOrgId`.

## 10. Privacy caveats (documented in product, not as bugs)

- **Apple Mail Privacy Protection** pre-fetches images server-side, inflating open counts on iPhone/iPad/macOS recipients. No technical fix exists. Surface a tooltip on the open count: *"Some opens may be auto-fetches by privacy-protecting email clients."*
- **Corporate scanners** (Mimecast, Proofpoint, Microsoft Defender) similarly pre-fetch. Same caveat applies.

## 11. Testing strategy

- **Unit:** token sign/verify round-trip; forged-token rejection; bad-key rejection.
- **Unit:** `wrapBodyAsHtml` — pixel present, `<script>` escaped, line breaks preserved, all `http(s)://` rewritten exactly once.
- **Unit:** click-handler URL validator — accept `http://`, `https://`; reject `javascript:`, `data:`, `file:`, relative, empty.
- **Integration (per-test Postgres):** POST email with `trackEnabled=true` → GET open URL → expect 200 GIF + activity `open_count=1`, first/last_opened_at set, event row exists. Hit open URL again → counts increment correctly.
- **Integration:** POST email with `trackEnabled=false` → GET open URL → expect 200 GIF, NO event, counts unchanged.
- **Integration:** POST email → GET click URL with valid token + URL → expect 302 with `Location: <url>` + event row inserted + counts incremented.
- **Integration:** GET click URL with forged token → expect 400.
- **Integration:** GET click URL with `u=javascript:alert(1)` → expect 400.
- **Integration:** GET `/api/v1/activities/:id/events` for an activity belonging to orgA, authenticated as orgB → expect 404 (tenant isolation).
- **Integration:** POST email with `cc: ['a@b.com', 'c@d.com']` → expect `cc_emails` populated; SMTP transport receives `cc` array.
- **Integration:** GET `/api/v1/emails` lists only the caller's org's sent emails, supports cursor pagination, filters by status.

## 12. Migrations + rollout

- New migration `0009_email_tracking.sql` adds the 8 columns to `activities` and creates `email_events`.
- All existing email activities get default values (counts=0, status='sent', tracking_enabled=true — though the historical sends had no tracking, this is harmless because no event rows ever existed for them).
- Two env-var additions documented in `apps/api/.env.example` (`PUBLIC_API_URL=http://localhost:3000`, `EMAIL_TRACKING_SECRET=<paste 64 hex chars here>`). README updated.

## 13. Scope summary

Estimated ~16 implementation tasks (rough breakdown for the implementation plan):

1. Migration + Drizzle schema changes
2. Shared schema extensions (PublicActivity, sendEmailBodySchema, PublicEmailEvent, PublicEmailRow)
3. `email-tracking-token.ts` lib + unit tests
4. `email-html-wrap.ts` lib + unit tests
5. `EmailProvider.send` cc/bcc + multipart support
6. POST `/api/v1/emails` extension (cc/bcc, tracking insertion)
7. Public `/track/open/:token` route
8. Public `/track/click/:token` route
9. GET `/api/v1/activities/:id/events`
10. GET `/api/v1/emails` (dashboard list)
11. GET `/api/v1/emails/engagement/:entityType/:id`
12. Compose dialog — CC/BCC reveal + tracking toggle
13. Tracking badge on activity feed
14. Engagement timeline section on activity detail page
15. Engagement rollup card on contact / company / deal detail pages
16. `/app/emails` dashboard route + sidebar link
17. Cross-package validation + tag `v0.1-email-tracking`

(Task 17 is the standard end-of-sub-plan step, not new work.)
