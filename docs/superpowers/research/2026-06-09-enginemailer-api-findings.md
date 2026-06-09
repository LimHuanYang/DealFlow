# EngineMailer API findings (2026-06-09) — Task 0 spike

Source: EngineMailer Zendesk docs (read via browser; WebFetch is 403-blocked).
- Send V2: https://enginemailer.zendesk.com/hc/en-us/articles/23132996552473
- Success response: https://enginemailer.zendesk.com/hc/en-us/articles/115000626011
- Webhooks: https://enginemailer.zendesk.com/hc/en-us/articles/115001195032

## Send (transactional) — CONFIRMED
- **Endpoint:** `POST https://api.enginemailer.com/RESTAPI/V2/Submission/SendEmail`
- **Auth:** header **`APIKey: <key>`** (NOT `Authorization: Bearer`). JSON only.
- **Request body** (case-sensitive):
  | Field | Req? | Notes |
  |---|---|---|
  | `ToEmail` | yes | recipient |
  | `SenderEmail` | yes | **domain must match a VERIFIED sending domain** |
  | `Subject` | no | |
  | `SenderName` | no | |
  | `SubmittedContent` | no | the body — **single content field (HTML or text), no separate Html/Text**, **no ReplyTo** |
  | `CampaignName` | no | label only; NOT returned in transactional webhooks |
  | `SubstitutionTags` | no | `[{Key,Value}]` template vars (chars `{ } [ ]` forbidden in values) |
  | `Attachments` | no | `[{Filename, Content(base64)}]`, ≤5MB total |
  | `CCEmails` | no | ≤10 |
  | `BCCEmails` | no | ≤3 |
- **Success response:** `{ "Result": { "TransactionID": "a123456", "Status": "OK", "StatusCode": "200" } }`
  → success = `Result.StatusCode === "200"`; **store `Result.TransactionID` as the match key.**
- **No custom-ref / metadata field** that round-trips. ⇒ correlate webhooks by **`TransactionID`**, not an injected `activityId`.

## Webhook — CONFIRMED
- **Events:** `delivered`, `bounce`, `opened`, `clicked`, `unsubscribed`, `spam-complaint` (lowercase; note `bounce` & `spam-complaint`, not `bounced`/`spam`).
- **Transactional payload:** `{ "event": "opened", "details": { "txid": 12345, "email": "...", "opendate": "...", "ip_address", "devicecategory", "country" } }`. Click adds `url`, `clickdate`. Bounce: `bouncecode`, `bouncereason`. Spam: `spamcomplaintreason`.
- **Match key:** `details.txid` ⇔ the send's `Result.TransactionID`. *(Marketing/autoresponder use `campaigntxid`/`autorespondertxid` — we only send transactional, so always `txid`.)*
- **Verification: NO HMAC signature.** Mechanism = "randomly generate a key and add it along with your webhook URL." ⇒ we append `?key=<secret>` to the callback URL and **verify the `key` query param** (timing-safe compare). Use HTTPS + a long random key.
- **Per-event URLs:** configured at **Domains › {domain} › Webhooks**, one URL per event. We use ONE route for all; paste the same URL (with `?key=`) under Open + Click (+ Bounce/Spam) and **enable** each.
- **200-or-it-won't-retry:** must return 200/OK quickly; non-200 is dropped (no retry).

## Custom domain / Option B
- Sending **and** webhooks require a **verified sending domain** (dashboard: Domains › add + verify). Multiple domains per account appear supported ("Domains" is a list).
- **No public API to add/verify a domain** found — verification is a **dashboard action**. ⇒ DealFlow can show status/instructions but cannot auto-verify; the "Verify" button reflects dashboard state, it doesn't perform DNS verification via API.

## SMTP relay
- Not confirmed in these docs; we use the REST API. (Irrelevant to the plan.)

---

## ⚠️ Three deltas vs the approved design

1. **No Reply-To.** EngineMailer V2 SendEmail has no reply-to field. The approved Option A promised "send from DealFlow's domain, Reply-To = your email so replies reach you." **Not achievable.** Mitigation: send from a verified domain you own, so replies land in that mailbox natively.
2. **A verified sending domain is REQUIRED to send at all** (SenderEmail validates against it) **and to receive webhooks.** There is no zero-setup "shared DealFlow domain" unless DealFlow itself owns+verifies one centrally. For this solo deployment, **you verify your own domain** and send from it.
3. **Therefore the free(shared)-vs-Pro(own) domain paywall premise collapses** for a single EngineMailer account: there's no free shared domain to contrast against. The paywall, as drawn, doesn't map to EngineMailer's model right now.

## Plan adjustments these imply
- **Task 3 (adapter):** endpoint/header/body/response per above; drop `replyTo` + `activityId` from the send body; success via `Result.StatusCode`; return `{ messageId: Result.TransactionID }`.
- **Task 8 (webhook):** verify `?key=` query param (not HMAC); event values `opened/clicked/delivered/bounce/spam-complaint`; match `details.txid` → `activities.external_id`.
- **Task 9:** store `Result.TransactionID` as `external_id` on send (the linkage).
- **Tasks 11/12 (UI):** revisit the sender-identity + paywall UX pending the user's decision (below).
