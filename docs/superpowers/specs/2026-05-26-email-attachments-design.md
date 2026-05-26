# Email Attachments v1 — Design Spec

**Date:** 2026-05-26
**Status:** Approved
**Scope:** Outbound-only attachments. Files travel through DealFlow at send time but are not the source of truth — the user's SMTP provider's Sent folder is. DealFlow keeps an optional local cache for fast in-app download, with a configurable per-org retention window.
**Mockups:** [`2026-05-26-email-attachments-mockups.html`](./2026-05-26-email-attachments-mockups.html) — note: mockup shows the original "always store locally" design; this spec reflects the cache-only refinement.

---

## 1. Goal

Let users attach files (any non-dangerous type, up to 25 MB per file, up to 25 MB per email) when composing emails through DealFlow. Files are delivered to the recipient as standard MIME attachments via the existing per-org SMTP send. The user's email provider (Gmail / Outlook / Yahoo) preserves a copy in the user's Sent folder via its own IMAP-sync behavior. DealFlow caches files locally for fast in-app re-download within a per-org-configurable retention window, then evicts them — at which point the activity detail page redirects the user to retrieve from their Sent folder.

## 2. Non-goals (deferred)

- **Local storage as source of truth** — Cache only. Source of truth lives in the user's email provider.
- **Inline images** (`<img src="cid:...">` embedded in HTML body) — Images attach as files only. Plain-text body remains plain text.
- **Inbound attachments** — Depends on the deferred reply-detection sub-plan.
- **Virus scanning** — Files trusted to be what the user uploaded.
- **Pre-upload / draft attachments** — Files travel with the send request; no separate upload endpoint.
- **Re-attaching saved files** — Each compose starts fresh.
- **Resumable uploads** — Single multipart POST. ≤ 25 MB so resumability isn't worth the complexity.
- **Thumbnails / image previews** — Files show by filename + MIME icon, no rendered preview.
- **S3 / object-storage cache backend** — Local filesystem only. A future sub-plan can add S3 as a pluggable backend.

## 3. Architecture

### Send (POST `/api/v1/emails`)

The existing JSON endpoint becomes a **multipart endpoint**. The browser sends `multipart/form-data` with one JSON field named `body` (carrying the existing payload: `contactId`, `subject`, `body`, `cc`, `bcc`, `trackEnabled`) plus N binary file fields named `attachments[]`.

Server-side flow:

1. `@fastify/multipart` plugin parses the request. Each file is streamed to a temp location (not held entirely in memory).
2. JSON `body` field is parsed and validated against `sendEmailBodySchema` (unchanged from Email Tracking).
3. Each attachment is validated:
   - **Size:** ≤ 25 MB per file; running sum ≤ 25 MB total. First violation aborts the whole request with 400.
   - **MIME:** Blocked extensions list: `.exe, .bat, .cmd, .com, .msi, .dll, .vbs, .js, .ps1, .scr, .jar, .app`. Blocked content-types: `application/x-msdownload, application/x-msi, application/x-javascript`. Detected by file extension (primary) + content-type header (secondary). Allowlist mode is out of scope for v1.
4. Pre-create the activity row (subject, body, cc/bcc, tracking flag — same as Email Tracking Task 7).
5. For each validated attachment, INSERT an `email_attachments` row carrying metadata. If caching is enabled for the org, also write the file to the cache directory and populate `cache_path` + `cache_expires_at`.
6. Build the nodemailer payload with `attachments: [{ filename, path }]` (or `{ filename, content }` if not cached) and call `provider.send()`. nodemailer reads each file (from disk or memory buffer) and includes them as multipart/mixed parts.
7. On success: record the SMTP `messageId` on the activity, INSERT the `'sent'` email_event row (existing tracking behavior).
8. On send failure: DELETE the inserted `email_attachments` rows + DELETE the cached files from disk + mark `delivery_status: 'failed'`. Return 502.

### Download (GET `/api/v1/attachments/:id`)

Public-to-the-org endpoint (gated by `requireOrg`).

1. Look up the attachment row by id, scoped to `req.session.currentOrgId`. Return 404 if not found or tenant mismatch.
2. **Cache hit** — `cache_path` non-null, `cache_expires_at > NOW()`, file exists on disk:
   - Stream the file with response headers:
     - `Content-Type: <attachment.mime_type>`
     - `Content-Disposition: attachment; filename="<original_filename>"`
     - `Content-Length: <size_bytes>`
3. **Cache miss** (expired, evicted, or never cached):
   - Return 404 with envelope: `{ error: { code: 'ATTACHMENT_NOT_CACHED', message: 'Cache expired. Retrieve from your email provider's Sent folder.' } }`.
   - Best-effort cleanup: if `cache_path` was set but file is missing, clear the column.

### Cache eviction

**Lazy** (always): A download request that finds `cache_expires_at < NOW()` triggers an unlink + DB column clear before returning the 404. Means evicted rows passively self-clean as users browse.

**Eager** (optional): A daily background sweep walks `email_attachments WHERE cache_expires_at < NOW() AND cache_path IS NOT NULL`, deletes files, clears columns. Keeps disk usage bounded even when no one's downloading. Triggered at API startup + every 24h via setInterval.

### Per-org setting

A new column `attachment_cache_days` on `org_integrations` (or equivalent table — see §4):

- Type: `text` enum
- Values: `'7' | '30' | '90' | 'never'`
- Default: `'30'`
- `'never'` means cache permanently (essentially local-storage mode for users who opt in). UI calls out the disk-usage implication.

Exposed in **Settings → Email** as a dropdown ("Keep sent attachments locally for…"). Saving updates the org's row immediately; doesn't retroactively change `cache_expires_at` on existing rows (they keep whatever expiry was set at upload time).

## 4. Data model

### New table

```sql
CREATE TABLE email_attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  activity_id         uuid        NOT NULL REFERENCES activities(id)    ON DELETE CASCADE,
  filename            text        NOT NULL,    -- original filename (sanitized for safe storage path use)
  mime_type           text        NOT NULL,
  size_bytes          integer     NOT NULL,
  cache_path          text,                    -- relative to data/cache/attachments/; NULL after eviction
  cache_expires_at    timestamptz,             -- NULL when caching disabled at upload time
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_attachments_activity_idx ON email_attachments (activity_id);
CREATE INDEX email_attachments_cache_eviction_idx
  ON email_attachments (cache_expires_at) WHERE cache_path IS NOT NULL;
```

The second index supports the eager-eviction sweep efficiently.

### Extension to org settings

The existing `organizations.integrations` JSONB column already holds per-org SMTP/AI configuration. Add an `email` sub-key for the new setting:

```jsonc
{
  "smtp": { ... existing ... },
  "ai":   { ... existing ... },
  "email": {
    "attachmentCacheDays": "30"   // '7' | '30' | '90' | 'never'
  }
}
```

Default behavior when key absent: treat as `'30'`. New helper `getAttachmentCacheDays(orgId)` returns the resolved value.

### Disk layout

```
apps/api/data/
└── cache/
    └── attachments/
        ├── <orgId-1>/
        │   ├── <attachmentId-A>     ← raw bytes, filename is the attachment id
        │   ├── <attachmentId-B>
        │   └── ...
        └── <orgId-2>/
            └── ...
```

Notes:

- Files named by `attachment_id` (UUID), NOT by the original filename. The original name lives in the DB only — keeps the filesystem layout free of user-controlled strings.
- `Content-Disposition` rebuilds the original filename for the download response.
- `apps/api/data/` is gitignored. Operators back it up alongside Postgres if they value the cache layer; otherwise can be wiped freely.

### Shared schema additions

```typescript
// packages/shared/src/emails.ts (extend existing)
export const publicEmailAttachmentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  cached: z.boolean(),                // computed: cache_path non-null AND not expired
  createdAt: z.string(),
});
export type PublicEmailAttachment = z.infer<typeof publicEmailAttachmentSchema>;

// Settings enum
export const ATTACHMENT_CACHE_DAYS = ['7', '30', '90', 'never'] as const;
export const attachmentCacheDaysSchema = z.enum(ATTACHMENT_CACHE_DAYS);
export type AttachmentCacheDays = z.infer<typeof attachmentCacheDaysSchema>;
```

The `PublicActivity` (extended in Email Tracking) gains an `attachments: PublicEmailAttachment[]` array, hydrated by the GET routes that return activities.

## 5. API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/emails` | session+org | **Changed**: now accepts `multipart/form-data` with a `body` JSON field + 0..N `attachments[]` file fields. The JSON-only form continues to work for sends without attachments (no breaking change). |
| `GET` | `/api/v1/attachments/:id` | session+org | Stream a cached attachment. 200 with file on cache hit, 404 with `ATTACHMENT_NOT_CACHED` envelope on miss. |
| `GET` | `/api/v1/activities/:id` | session+org | **Extended**: response now includes `attachments` array. |
| `GET` | `/api/v1/emails` (dashboard) | session+org | **Extended**: each row gets `attachmentCount: number`. |
| `PATCH` | `/api/v1/integrations` | session+org | **Extended**: accepts `email.attachmentCacheDays` to set the per-org retention. |

## 6. Server-side modules

- **`apps/api/src/lib/email-attachments-store.ts`** — Cache helpers: `cacheAttachment(orgId, attachmentId, buffer)`, `readCachedAttachment(orgId, attachmentId)`, `evictAttachment(attachmentId)`, `getCacheDir()`. Pure functions over the local filesystem.
- **`apps/api/src/lib/email-attachments-validate.ts`** — `validateAttachment({ filename, mimeType, sizeBytes })` returning `{ ok: true } | { ok: false, reason }`. Pure function.
- **`apps/api/src/modules/emails/routes.ts`** — Extended POST `/emails` to accept multipart. New GET `/attachments/:id`.
- **`apps/api/src/modules/emails/email-attachments.repo.ts`** — `EmailAttachmentsRepo` with `createMany`, `listForActivity`, `findById`, `delete`, `findExpiredForEviction`.
- **`apps/api/src/jobs/eviction.ts`** — `runAttachmentEvictionSweep()` triggered at server start + every 24h via `setInterval`.
- **`packages/email/src/provider.ts`** — `SendEmailInput` already has `attachments?: { filename: string; path?: string; content?: Buffer }[]` field added (matches nodemailer's input — small extension on top of cc/bcc/html from Email Tracking Task 5).
- **`apps/api/src/modules/integrations/routes.ts`** — PATCH handler validates new `email.attachmentCacheDays` field.

## 7. Frontend modules

- **`apps/web/src/features/emails/compose-email-dialog.tsx`** — Attachments panel: file picker, drop zone, paste-from-clipboard listener, attachment list with remove buttons, running size meter. On submit, builds FormData instead of JSON when at least one file is selected.
- **`apps/web/src/features/emails/email-attachments-list.tsx`** — Renders the attachments section on the activity detail page. Per-attachment download link conditional on `cached` flag; cache-miss falls back to a "Retrieve from your Sent folder" pointer with a deep link to the user's provider Sent folder when known.
- **`apps/web/src/features/emails/api.ts`** — Updated `useSendEmail` mutation to send FormData when attachments are present; otherwise keeps the existing JSON path. Adds `useDownloadAttachment(id)` helper that pipes the response into a blob URL.
- **`apps/web/src/features/integrations/email-settings-section.tsx`** — New section in Settings → Email with the `attachmentCacheDays` dropdown. May reuse existing settings page layout.

## 8. Validation & error handling

| Situation | Behavior |
|---|---|
| File > 25 MB | Reject whole POST with 400 `{ error: { code: 'ATTACHMENT_TOO_LARGE', message, details: { filename, sizeBytes, limitBytes } } }`. |
| Sum > 25 MB | Reject whole POST with 400 `{ error: { code: 'ATTACHMENTS_TOTAL_TOO_LARGE', ... } }`. |
| Blocked extension or MIME | Reject whole POST with 400 `{ error: { code: 'ATTACHMENT_BLOCKED_TYPE', ... } }`. |
| Filename contains `../` or NUL bytes | Sanitize before storing in DB (keep display intent, strip path-traversal characters). Never reject for this — silently safe. |
| Send failure after partial cache writes | DELETE attachment rows + unlink cached files (each unlink wrapped in `.catch(noop)` for idempotency). Mark activity `delivery_status: 'failed'`. Return 502. |
| Download cache miss | 404 `{ error: { code: 'ATTACHMENT_NOT_CACHED', message: '...' } }`. |
| Download tenant mismatch | 404 with the same `ATTACHMENT_NOT_CACHED` shape (never 403 — don't leak existence across tenants). |
| Eviction sweep unlink fails (file already gone) | Catch, log, clear DB column anyway. |
| Disk full during cache write | Best-effort: continue the send without caching this attachment (`cache_path` stays NULL), log a warning. The send still succeeds; only the cache convenience is lost. |
| User uploads via curl / non-browser with mismatched declared sizes | `@fastify/multipart` enforces actual byte counts; declared sizes are advisory only. |

## 9. Security

- **Path traversal:** Filenames are stored verbatim in DB for display, but never used in filesystem paths. Files on disk are named by `attachment_id` (UUID) only.
- **Tenant isolation:** Every DB query filters by `organization_id`. The download endpoint scopes the lookup to `req.session.currentOrgId`. Cache directories are also org-scoped (`data/cache/attachments/<orgId>/`) so a path-construction bug can leak at most within one tenant.
- **MIME spoofing:** A `.txt` renamed to `.exe` is still rejected (extension-based blocking). Conversely, content-type sniffing for `.exe` content disguised as a PDF is out of scope — the user is sending their own attachments to recipients of their choice, not ingesting from untrusted sources.
- **Disk exhaustion:** Per-org retention setting bounds cache size implicitly. A future enhancement could add a per-org max-cache-size in bytes, but YAGNI for v1.
- **SMTP credential exposure:** Attachments don't change the existing SMTP credential model. Files are read by nodemailer in the API process and never leave it except via the SMTP TLS connection.

## 10. Testing strategy

### Unit

- `email-attachments-validate.ts` — size limits at the boundaries (0, 25 MB, 25 MB + 1 byte, total = 25 MB / 26 MB), every blocked extension, mixed case (`.EXE`), filename containing `../`, content-type spoofing.
- `email-attachments-store.ts` — cache write + read round-trip; eviction is idempotent; missing-file read returns null cleanly.

### Integration (per-test Postgres + temp filesystem)

- **Happy path:** POST /emails with one file attached → 201, activity row exists, attachment row exists, cache file exists at expected path with expected bytes, SMTP fake transporter received `attachments: [{ filename, path }]`.
- **Two files:** POST with two valid files → both rows + both cached files.
- **Mixed validation failure:** POST with one valid + one too-large → 400, NO activity created, NO files written.
- **Cache miss download:** Insert an attachment with `cache_expires_at = NOW() - 1d, cache_path = 'data/cache/...'` → GET /attachments/:id returns 404 `ATTACHMENT_NOT_CACHED` AND the row's `cache_path` becomes NULL afterwards (lazy eviction works).
- **Cache hit download:** Insert a fresh attachment → GET returns 200 with correct Content-Type and Content-Disposition.
- **Tenant isolation:** orgB can't download orgA's attachment (404 cache-not-cached envelope).
- **Activity deletion:** DELETE /activities/:id cascades the attachment rows + removes the disk files.
- **Per-org setting:** PATCH `/integrations` with `email.attachmentCacheDays: '7'` → subsequent uploads get `cache_expires_at ≈ NOW() + 7d`.
- **Never-cache (`'never'`):** subsequent uploads get `cache_expires_at = NULL` → infinite retention. Files never evicted by sweep.
- **Eviction sweep:** Insert 3 expired + 2 fresh → run `runAttachmentEvictionSweep()` → 3 files removed from disk, 3 rows cleared, 2 fresh rows untouched.

### Manual smoke (during validation)

- Compose with no files → still works (JSON path).
- Compose with one PDF + one PNG → arrives in recipient inbox with both attachments downloadable.
- Open the activity detail in DealFlow → see both attachments listed → click Download on each → file downloads with correct name + content.
- Wait for cache to expire (or manually update DB) → reload activity detail → Download buttons replaced with "Get from your Sent folder" message.

## 11. Migrations + rollout

- New migration `0010_email_attachments.sql` creates the `email_attachments` table + indexes. No changes to existing tables.
- Add `@fastify/multipart` to `apps/api/package.json` dependencies.
- New `data/` directory at repo root or `apps/api/data/` — add to `.gitignore`.
- README updated with a "Email attachments cache" section documenting the disk-usage implications.

## 12. Scope summary

Estimated **~10 implementation tasks**:

1. Migration + Drizzle schema for `email_attachments`
2. Shared schemas (`PublicEmailAttachment`, `attachmentCacheDaysSchema`, extended `PublicActivity`)
3. `email-attachments-validate.ts` + unit tests
4. `email-attachments-store.ts` + unit tests
5. POST `/api/v1/emails` extended to accept multipart (preserve JSON-only path for backward compat)
6. GET `/api/v1/attachments/:id` (cache hit / cache miss flow)
7. Activity routes return attachments; dashboard list returns `attachmentCount`
8. Per-org `attachmentCacheDays` setting (integrations PATCH + read helper) + eviction sweep
9. Frontend: compose dialog attachment UI (picker, drop zone, paste handler, size meter)
10. Frontend: activity detail attachments list + settings page dropdown
11. Cross-package validation + tag `v0.1-email-attachments`

(Task 11 is the standard end-of-sub-plan step.)
