# Email Attachments v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach files (≤ 25 MB per file, ≤ 25 MB total) to outbound emails composed in DealFlow. The user's SMTP provider's Sent folder is the long-term source of truth; DealFlow keeps a local cache for fast in-app re-download with a per-org-configurable retention window (default 30 days).

**Architecture:** The existing POST `/api/v1/emails` accepts `multipart/form-data` with a JSON `body` field plus N `attachments[]` file fields. Files are parsed via `@fastify/multipart`, validated (size + MIME blocklist), persisted to `apps/api/.data/cache/attachments/<orgId>/<attachmentId>` if the org has caching enabled, and handed to nodemailer for SMTP send. A new `email_attachments` table holds per-file metadata. Downloads come from a new `GET /api/v1/attachments/:id` endpoint that returns 200 + bytes on cache hit, 404 `ATTACHMENT_NOT_CACHED` on miss (UI directs the user to their Sent folder).

**Tech Stack:** `@fastify/multipart` (new dep), Drizzle ORM + Postgres 16, Fastify 5, Zod, React 19 + TanStack Router + TanStack Query, vitest with per-test disposable Postgres + temp filesystem dirs.

**Source spec:** `docs/superpowers/specs/2026-05-26-email-attachments-design.md`.
**Source mockups:** `docs/superpowers/specs/2026-05-26-email-attachments-mockups.html` (note: mockups show the original "always store locally" version; the spec is the cache-only refinement).

---

## File Structure

**DB (`packages/db`):**
- Create: `src/schema/email-attachments.ts` — Drizzle table.
- Modify: `src/schema/index.ts` — re-export.
- Create: `migrations/0010_email_attachments.sql` — hand-written DDL.
- Modify: `migrations/meta/_journal.json` — add entry.

**Shared (`packages/shared`):**
- Modify: `src/emails.ts` — add `publicEmailAttachmentSchema`, `PublicEmailAttachment`, `ATTACHMENT_CACHE_DAYS`, `attachmentCacheDaysSchema`.
- Modify: `src/activities.ts` — extend `PublicActivity` with `attachments: PublicEmailAttachment[]`.
- Modify: `src/integrations.ts` — extend `UpdateIntegrationsInput` and `PublicIntegrations` to carry the per-org `email.attachmentCacheDays` setting.
- Modify: `src/index.ts` — re-exports unchanged (re-exports happen via the modified files).

**Email (`packages/email`):**
- Modify: `src/provider.ts` — extend `SendEmailInput` with `attachments?: { filename, content?, path? }[]`.
- Modify: `src/providers/smtp.ts` — pass `attachments` through to nodemailer.

**API (`apps/api`):**
- Modify: `package.json` — add `@fastify/multipart` dep.
- Modify: `src/server.ts` — register `@fastify/multipart`, register attachment routes, start eviction sweep on boot.
- Modify: `src/env.ts` — add `ATTACHMENTS_CACHE_DIR` env var with default.
- Create: `src/lib/email-attachments-validate.ts` — pure validator.
- Create: `test/lib/email-attachments-validate.test.ts`.
- Create: `src/lib/email-attachments-store.ts` — filesystem helpers.
- Create: `test/lib/email-attachments-store.test.ts`.
- Create: `src/modules/emails/email-attachments.repo.ts` — `EmailAttachmentsRepo`.
- Modify: `src/modules/emails/routes.ts` — extend POST `/emails` for multipart, add GET `/attachments/:id`.
- Modify: `src/modules/activities/routes.ts` — include `attachments` in activity responses + `attachmentCount` in dashboard list.
- Modify: `src/modules/integrations/routes.ts` — accept + persist `email.attachmentCacheDays`.
- Modify: `src/modules/integrations/repo.ts` — store and read the new setting.
- Create: `src/jobs/attachments-eviction.ts` — startup + 24h background sweep.
- Modify: `test/modules/emails/routes.test.ts` — new attachment tests.
- Create: `test/modules/emails/attachments-routes.test.ts` — download endpoint tests.
- Create: `test/jobs/attachments-eviction.test.ts`.

**Web (`apps/web`):**
- Modify: `src/lib/api.ts` — add `apiFetchFormData` helper for multipart POSTs and a `downloadAttachment(id)` helper for blob streaming.
- Modify: `src/features/emails/api.ts` — `useSendEmail` switches to FormData when attachments present.
- Modify: `src/features/emails/compose-email-dialog.tsx` — attachment picker, drop zone, paste handler, list, size meter.
- Create: `src/features/emails/email-attachments-list.tsx` — render the activity-detail Attachments section.
- Modify: `src/routes/app.activities.$id.tsx` — embed the attachments list for email kind.
- Modify: `src/features/integrations/email-settings-section.tsx` (or wherever per-org email settings live — check during Task 9) — add the cache-retention dropdown.
- Modify: `src/lib/query-keys.ts` — add `emails.attachment(id)` and adjust existing keys.

---

## Task 1: DB schema + migration

**Files:**
- Create: `packages/db/src/schema/email-attachments.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0010_email_attachments.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Create the Drizzle schema**

Create `packages/db/src/schema/email-attachments.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { activities } from './activities';

export const emailAttachments = pgTable(
  'email_attachments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    cachePath: text('cache_path'),
    cacheExpiresAt: timestamp('cache_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activityIdx: index('email_attachments_activity_idx').on(t.activityId),
    evictionIdx: index('email_attachments_cache_eviction_idx').on(t.cacheExpiresAt),
  }),
);

export type EmailAttachmentRow = typeof emailAttachments.$inferSelect;
export type NewEmailAttachment = typeof emailAttachments.$inferInsert;
```

- [ ] **Step 2: Re-export from schema index**

Edit `packages/db/src/schema/index.ts` — append:

```typescript
export * from './email-attachments';
```

- [ ] **Step 3: Create migration SQL by hand**

Create `packages/db/migrations/0010_email_attachments.sql`:

```sql
-- Sub-Plan: Email Attachments v1.
-- Adds per-file metadata for outbound email attachments. The user's SMTP
-- provider's Sent folder is the long-term source of truth; cache_path +
-- cache_expires_at are populated only when the org opts in to caching.

CREATE TABLE IF NOT EXISTS "email_attachments" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"  uuid    NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "activity_id"      uuid    NOT NULL REFERENCES "activities"("id")    ON DELETE CASCADE,
  "filename"         text    NOT NULL,
  "mime_type"        text    NOT NULL,
  "size_bytes"       integer NOT NULL,
  "cache_path"       text,
  "cache_expires_at" timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_attachments_activity_idx"
  ON "email_attachments" ("activity_id");

CREATE INDEX IF NOT EXISTS "email_attachments_cache_eviction_idx"
  ON "email_attachments" ("cache_expires_at");
```

- [ ] **Step 4: Add journal entry**

Open `packages/db/migrations/meta/_journal.json`. Inside the `entries` array, after the `0009_email_tracking` entry, append (mind the comma on the prior entry):

```json
    {
      "idx": 10,
      "version": "7",
      "when": 1780000000000,
      "tag": "0010_email_attachments",
      "breakpoints": true
    }
```

- [ ] **Step 5: Apply the migration**

Run: `pnpm --filter @dealflow/db db:migrate`
Expected: `[✓] migrations applied successfully!`

- [ ] **Step 6: Typecheck the db package**

Run: `pnpm --filter @dealflow/db typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/email-attachments.ts packages/db/src/schema/index.ts packages/db/migrations/0010_email_attachments.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): email_attachments table (metadata + optional cache columns)"
```

---

## Task 2: Shared schemas

**Files:**
- Modify: `packages/shared/src/emails.ts`
- Modify: `packages/shared/src/activities.ts`
- Modify: `packages/shared/src/integrations.ts`
- Create: `packages/shared/src/email-attachments.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/email-attachments.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  publicEmailAttachmentSchema,
  attachmentCacheDaysSchema,
  ATTACHMENT_CACHE_DAYS,
} from './emails.js';

describe('publicEmailAttachmentSchema', () => {
  const base = {
    id: '11111111-1111-1111-1111-111111111111',
    filename: 'proposal.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    cached: true,
    createdAt: '2026-05-26T01:00:00.000Z',
  };
  it('accepts a complete attachment', () => {
    expect(() => publicEmailAttachmentSchema.parse(base)).not.toThrow();
  });
  it('rejects negative sizeBytes', () => {
    expect(() => publicEmailAttachmentSchema.parse({ ...base, sizeBytes: -1 })).toThrow();
  });
  it('rejects non-uuid id', () => {
    expect(() => publicEmailAttachmentSchema.parse({ ...base, id: 'not-a-uuid' })).toThrow();
  });
  it('requires cached to be a boolean', () => {
    expect(() => publicEmailAttachmentSchema.parse({ ...base, cached: 'yes' })).toThrow();
  });
});

describe('attachmentCacheDaysSchema', () => {
  it.each(ATTACHMENT_CACHE_DAYS)('accepts %s', (v) => {
    expect(() => attachmentCacheDaysSchema.parse(v)).not.toThrow();
  });
  it('rejects 14', () => {
    expect(() => attachmentCacheDaysSchema.parse('14')).toThrow();
  });
  it('exposes exactly four options', () => {
    expect(ATTACHMENT_CACHE_DAYS).toEqual(['7', '30', '90', 'never']);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter @dealflow/shared test -- email-attachments`
Expected: FAIL — schemas not exported yet.

- [ ] **Step 3: Add the schemas to `emails.ts`**

Open `packages/shared/src/emails.ts`. Append at the bottom (after the existing `sendEmailBodySchema`):

```typescript
export const ATTACHMENT_CACHE_DAYS = ['7', '30', '90', 'never'] as const;
export const attachmentCacheDaysSchema = z.enum(ATTACHMENT_CACHE_DAYS);
export type AttachmentCacheDays = z.infer<typeof attachmentCacheDaysSchema>;

export const publicEmailAttachmentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  cached: z.boolean(),
  createdAt: z.string(),
});
export type PublicEmailAttachment = z.infer<typeof publicEmailAttachmentSchema>;
```

Make sure `import { z } from 'zod';` is present (it should already be).

- [ ] **Step 4: Extend `PublicActivity`**

Open `packages/shared/src/activities.ts`. Add an `attachments` field to the `PublicActivity` interface, before `createdAt`:

```typescript
  attachments: PublicEmailAttachment[];
```

Add this import at the top:

```typescript
import type { PublicEmailAttachment } from './emails.js';
```

- [ ] **Step 5: Extend integrations types**

Open `packages/shared/src/integrations.ts`. Find the existing schemas (likely `updateIntegrationsInputSchema` and the `PublicIntegrations` interface).

Inside `updateIntegrationsInputSchema`, add (alongside the existing `smtp`, `ai`, `grok` keys — verify the actual structure):

```typescript
  email: z
    .object({
      attachmentCacheDays: attachmentCacheDaysSchema,
    })
    .partial()
    .nullable()
    .optional(),
```

Inside the `PublicIntegrations` interface, add:

```typescript
  email: {
    attachmentCacheDays: AttachmentCacheDays;
  };
```

Add imports at the top of the file:

```typescript
import { attachmentCacheDaysSchema, type AttachmentCacheDays } from './emails.js';
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @dealflow/shared test -- email-attachments`
Expected: PASS — all cases green.

- [ ] **Step 7: Typecheck the shared package + downstream packages**

Run: `pnpm -r typecheck`
Expected: clean. If the API or web packages fail because they use `PublicActivity` without supplying `attachments`, that's expected — those will be fixed in later tasks. Note any cross-package type errors and add them as "follow-up in Task X" notes if needed, but for now they'll be fixed naturally when each consumer is updated.

If `pnpm -r typecheck` is too disruptive at this stage, run only `pnpm --filter @dealflow/shared typecheck` and proceed.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/emails.ts packages/shared/src/activities.ts packages/shared/src/integrations.ts packages/shared/src/email-attachments.test.ts
git commit -m "feat(shared): email attachment types + per-org cache-retention setting"
```

---

## Task 3: Attachment validator

**Files:**
- Create: `apps/api/src/lib/email-attachments-validate.ts`
- Create: `apps/api/test/lib/email-attachments-validate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/lib/email-attachments-validate.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  validateAttachment,
  validateAttachmentTotal,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from '../../src/lib/email-attachments-validate.js';

describe('validateAttachment', () => {
  it('accepts a normal PDF', () => {
    expect(
      validateAttachment({ filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }).ok,
    ).toBe(true);
  });

  it('rejects a file exactly 1 byte over the per-file limit', () => {
    const r = validateAttachment({
      filename: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: MAX_FILE_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ATTACHMENT_TOO_LARGE');
  });

  it('accepts a file exactly at the per-file limit', () => {
    expect(
      validateAttachment({
        filename: 'edge.pdf',
        mimeType: 'application/pdf',
        sizeBytes: MAX_FILE_BYTES,
      }).ok,
    ).toBe(true);
  });

  it('rejects a blocked extension (.exe)', () => {
    const r = validateAttachment({
      filename: 'installer.exe',
      mimeType: 'application/octet-stream',
      sizeBytes: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ATTACHMENT_BLOCKED_TYPE');
  });

  it('blocked-extension check is case-insensitive (.EXE rejected)', () => {
    expect(
      validateAttachment({
        filename: 'installer.EXE',
        mimeType: 'application/octet-stream',
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
  });

  it.each(['installer.bat', 'script.cmd', 'app.com', 'pkg.msi', 'lib.dll', 'macro.vbs', 'code.js', 'run.ps1', 'screen.scr', 'java.jar'])(
    'rejects %s',
    (filename) => {
      expect(validateAttachment({ filename, mimeType: 'application/octet-stream', sizeBytes: 10 }).ok).toBe(false);
    },
  );

  it('rejects a blocked content-type', () => {
    expect(
      validateAttachment({
        filename: 'unknown',
        mimeType: 'application/x-msdownload',
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
  });

  it('rejects zero-byte files', () => {
    expect(
      validateAttachment({ filename: 'empty.pdf', mimeType: 'application/pdf', sizeBytes: 0 }).ok,
    ).toBe(false);
  });

  it('rejects files with no extension when MIME is also generic', () => {
    // No extension AND generic MIME — we can't classify it, reject.
    expect(
      validateAttachment({
        filename: 'README',
        mimeType: 'application/octet-stream',
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
  });

  it('accepts a file with no extension when MIME is specific', () => {
    expect(
      validateAttachment({ filename: 'photo', mimeType: 'image/jpeg', sizeBytes: 1000 }).ok,
    ).toBe(true);
  });
});

describe('validateAttachmentTotal', () => {
  it('accepts a single file under the total limit', () => {
    expect(validateAttachmentTotal([1_000_000]).ok).toBe(true);
  });

  it('rejects sum that exceeds total', () => {
    const r = validateAttachmentTotal([MAX_FILE_BYTES, MAX_FILE_BYTES]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ATTACHMENTS_TOTAL_TOO_LARGE');
  });

  it('accepts sum at exactly the total limit', () => {
    expect(validateAttachmentTotal([MAX_TOTAL_BYTES]).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter @dealflow/api test -- email-attachments-validate`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Create `apps/api/src/lib/email-attachments-validate.ts`:

```typescript
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB total per email

const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'msi',
  'dll',
  'vbs',
  'js',
  'ps1',
  'scr',
  'jar',
  'app',
]);

const BLOCKED_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-msi',
  'application/x-javascript',
]);

const GENERIC_MIME_TYPES = new Set(['application/octet-stream', '']);

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; code: 'ATTACHMENT_TOO_LARGE' | 'ATTACHMENT_BLOCKED_TYPE' | 'ATTACHMENT_EMPTY' | 'ATTACHMENT_UNKNOWN_TYPE'; message: string };

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function validateAttachment(meta: AttachmentMeta): ValidateResult {
  if (meta.sizeBytes <= 0) {
    return { ok: false, code: 'ATTACHMENT_EMPTY', message: 'File is empty' };
  }
  if (meta.sizeBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: 'ATTACHMENT_TOO_LARGE',
      message: `File exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit`,
    };
  }
  const ext = getExtension(meta.filename);
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: 'ATTACHMENT_BLOCKED_TYPE',
      message: `Files with extension .${ext} are not allowed`,
    };
  }
  if (BLOCKED_MIME_TYPES.has(meta.mimeType.toLowerCase())) {
    return {
      ok: false,
      code: 'ATTACHMENT_BLOCKED_TYPE',
      message: `Content type ${meta.mimeType} is not allowed`,
    };
  }
  // If extension is missing AND MIME is generic, we can't classify safely.
  if (!ext && GENERIC_MIME_TYPES.has(meta.mimeType.toLowerCase())) {
    return {
      ok: false,
      code: 'ATTACHMENT_UNKNOWN_TYPE',
      message: 'File has no extension and a generic content type — cannot classify',
    };
  }
  return { ok: true };
}

export function validateAttachmentTotal(sizes: number[]): ValidateResult {
  const total = sizes.reduce((sum, n) => sum + n, 0);
  if (total > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      code: 'ATTACHMENT_TOO_LARGE',
      message: `Total attachment size ${total} bytes exceeds ${MAX_TOTAL_BYTES} byte limit`,
    };
  }
  return { ok: true };
}
```

Note: the spec describes `ATTACHMENTS_TOTAL_TOO_LARGE` as a separate error code, but the test asserts both kinds. Update the union if needed — or have `validateAttachmentTotal` return `'ATTACHMENTS_TOTAL_TOO_LARGE'`:

```typescript
export type ValidateResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'ATTACHMENT_TOO_LARGE'
        | 'ATTACHMENTS_TOTAL_TOO_LARGE'
        | 'ATTACHMENT_BLOCKED_TYPE'
        | 'ATTACHMENT_EMPTY'
        | 'ATTACHMENT_UNKNOWN_TYPE';
      message: string;
    };

// And in validateAttachmentTotal:
return {
  ok: false,
  code: 'ATTACHMENTS_TOTAL_TOO_LARGE',
  message: `Total attachment size ${total} bytes exceeds ${MAX_TOTAL_BYTES} byte limit`,
};
```

Update the test in Step 1 to assert `ATTACHMENTS_TOTAL_TOO_LARGE` instead of `ATTACHMENT_TOO_LARGE` for the total case. (The test as written already does this — `if (!r.ok) expect(r.code).toBe('ATTACHMENTS_TOTAL_TOO_LARGE');`.) Make sure both match.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @dealflow/api test -- email-attachments-validate`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/email-attachments-validate.ts apps/api/test/lib/email-attachments-validate.test.ts
git commit -m "feat(api): attachment validator (size limits + extension blocklist)"
```

---

## Task 4: Filesystem cache helpers

**Files:**
- Modify: `apps/api/src/env.ts` — add `ATTACHMENTS_CACHE_DIR` env var.
- Create: `apps/api/src/lib/email-attachments-store.ts`
- Create: `apps/api/test/lib/email-attachments-store.test.ts`

- [ ] **Step 1: Add the env var**

Open `apps/api/src/env.ts`. Inside the existing `z.object({ ... })` envSchema, add:

```typescript
  ATTACHMENTS_CACHE_DIR: z
    .string()
    .default('apps/api/.data/cache/attachments'),
```

Tests will override this with a temp dir per test file.

- [ ] **Step 2: Write failing tests**

Create `apps/api/test/lib/email-attachments-store.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cacheAttachment,
  readCachedAttachment,
  evictAttachment,
  attachmentCachePath,
} from '../../src/lib/email-attachments-store.js';

describe('email-attachments-store', () => {
  let cacheDir: string;
  const ORG_ID = 'org-1111-1111-1111-111111111111';
  const ATT_ID = 'att-1111-1111-1111-111111111111';

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'dealflow-attach-test-'));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('writes a file at the org+attachment scoped path', async () => {
    const buf = Buffer.from('hello world');
    const rel = await cacheAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID, buffer: buf });
    expect(rel).toBe(`${ORG_ID}/${ATT_ID}`);
    const stat1 = await stat(join(cacheDir, ORG_ID, ATT_ID));
    expect(stat1.size).toBe(buf.length);
  });

  it('reads bytes back identical to what was written', async () => {
    const buf = Buffer.from('the quick brown fox\n');
    await cacheAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID, buffer: buf });
    const got = await readCachedAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID });
    expect(got).not.toBeNull();
    expect(got!.equals(buf)).toBe(true);
  });

  it('returns null on read when file is missing', async () => {
    const got = await readCachedAttachment({
      cacheDir,
      orgId: ORG_ID,
      attachmentId: 'missing-id-0000-0000-000000000000',
    });
    expect(got).toBeNull();
  });

  it('evictAttachment removes the file', async () => {
    await cacheAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID, buffer: Buffer.from('x') });
    await evictAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID });
    const got = await readCachedAttachment({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID });
    expect(got).toBeNull();
  });

  it('evictAttachment is idempotent (no error when file already gone)', async () => {
    await expect(
      evictAttachment({
        cacheDir,
        orgId: ORG_ID,
        attachmentId: 'never-existed-0000-000000000000',
      }),
    ).resolves.toBeUndefined();
  });

  it('attachmentCachePath builds the correct absolute path', () => {
    const p = attachmentCachePath({ cacheDir, orgId: ORG_ID, attachmentId: ATT_ID });
    expect(p).toBe(join(cacheDir, ORG_ID, ATT_ID));
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `pnpm --filter @dealflow/api test -- email-attachments-store`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the store**

Create `apps/api/src/lib/email-attachments-store.ts`:

```typescript
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface StoreArgs {
  cacheDir: string;
  orgId: string;
  attachmentId: string;
}

export interface WriteArgs extends StoreArgs {
  buffer: Buffer;
}

/**
 * Build the absolute filesystem path where a given attachment should live
 * inside the cache. Files are named by attachment id only; the original
 * filename lives in the DB. This keeps user-controlled strings off the
 * filesystem (no path-traversal surface, no collisions on duplicate names).
 */
export function attachmentCachePath({ cacheDir, orgId, attachmentId }: StoreArgs): string {
  return join(cacheDir, orgId, attachmentId);
}

/**
 * Persist an attachment's bytes to the cache directory.
 * Returns the path RELATIVE to cacheDir (suitable for storing in the DB
 * `cache_path` column).
 */
export async function cacheAttachment(args: WriteArgs): Promise<string> {
  const target = attachmentCachePath(args);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, args.buffer);
  return `${args.orgId}/${args.attachmentId}`;
}

/**
 * Read a cached attachment's bytes. Returns null if the file doesn't exist.
 * Other errors propagate.
 */
export async function readCachedAttachment(args: StoreArgs): Promise<Buffer | null> {
  try {
    return await readFile(attachmentCachePath(args));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Delete a cached attachment. Idempotent — no-op if the file is already gone.
 * Other errors propagate.
 */
export async function evictAttachment(args: StoreArgs): Promise<void> {
  await rm(attachmentCachePath(args), { force: true });
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @dealflow/api test -- email-attachments-store`
Expected: PASS — all 6 cases green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/lib/email-attachments-store.ts apps/api/test/lib/email-attachments-store.test.ts
git commit -m "feat(api): filesystem helpers for the attachment cache"
```

---

## Task 5: Email provider — attachments passthrough

**Files:**
- Modify: `packages/email/src/provider.ts`
- Modify: `packages/email/src/providers/smtp.ts`
- Modify: `packages/email/src/providers/smtp.test.ts`

- [ ] **Step 1: Append failing tests**

Open `packages/email/src/providers/smtp.test.ts`. Append:

```typescript
describe('SmtpEmailProvider — attachments', () => {
  it('passes through nodemailer-shaped attachments', async () => {
    const calls: any[] = [];
    const fakeTransporter = {
      sendMail: async (opts: any) => {
        calls.push(opts);
        return { messageId: 'm-att-1' };
      },
    };
    const p = new SmtpEmailProvider({ transport: fakeTransporter as never });
    await p.send({
      from: 'Alice <a@a.com>',
      to: 's@s.com',
      replyTo: 'a@a.com',
      subject: 'with attachments',
      text: 'see attached',
      attachments: [
        { filename: 'proposal.pdf', content: Buffer.from('fake pdf bytes') },
        { filename: 'pic.png', path: '/tmp/pic.png' },
      ],
    });
    expect(calls[0].attachments).toHaveLength(2);
    expect(calls[0].attachments[0].filename).toBe('proposal.pdf');
    expect(calls[0].attachments[1].path).toBe('/tmp/pic.png');
  });

  it('omits attachments key entirely when none provided', async () => {
    const calls: any[] = [];
    const fakeTransporter = {
      sendMail: async (opts: any) => {
        calls.push(opts);
        return { messageId: 'm-noatt' };
      },
    };
    const p = new SmtpEmailProvider({ transport: fakeTransporter as never });
    await p.send({
      from: 'Alice <a@a.com>',
      to: 's@s.com',
      replyTo: 'a@a.com',
      subject: 'no attachments',
      text: 'plain',
    });
    expect('attachments' in calls[0]).toBe(false);
  });
});
```

Match the existing constructor key (`transport` vs `transporter`) — the previous SMTP cc/bcc tests already work, so copy that pattern exactly.

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/email test`
Expected: FAIL — TS error or assertion failures because `attachments` isn't on `SendEmailInput`.

- [ ] **Step 3: Extend `SendEmailInput`**

Open `packages/email/src/provider.ts`. Add `attachments` to the interface:

```typescript
export interface SendEmailAttachment {
  filename: string;
  /** Provide ONE of: `content` (Buffer) or `path` (file on disk). nodemailer reads from whichever is set. */
  content?: Buffer;
  path?: string;
}

export interface SendEmailInput {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: SendEmailAttachment[];
}
```

- [ ] **Step 4: Pass attachments through SMTP**

Open `packages/email/src/providers/smtp.ts`. Inside the `send` method's `sendMail` call options, add:

```typescript
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
```

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @dealflow/email test`
Expected: PASS — all existing + 2 new tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @dealflow/email typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/email/src/provider.ts packages/email/src/providers/smtp.ts packages/email/src/providers/smtp.test.ts
git commit -m "feat(email): SendEmailInput accepts attachments[] — passes to nodemailer"
```

---

## Task 6: EmailAttachmentsRepo

**Files:**
- Create: `apps/api/src/modules/emails/email-attachments.repo.ts`
- Create: `apps/api/test/modules/emails/email-attachments.repo.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/modules/emails/email-attachments.repo.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { EmailAttachmentsRepo } from '../../../src/modules/emails/email-attachments.repo.js';

describe('EmailAttachmentsRepo', () => {
  let testDb: TestDatabase;
  let repo: EmailAttachmentsRepo;
  let orgId: string;
  let activityId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    repo = new EmailAttachmentsRepo(testDb.db);
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Org', slug: `o-${Date.now()}`, defaultCurrency: 'USD' })
      .returning();
    orgId = org!.id;
    const [user] = await testDb.db
      .insert(schema.users)
      .values({ email: 'u@u.com', name: 'U', passwordHash: 'x' })
      .returning();
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: orgId,
        ownerUserId: user!.id,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();
    activityId = activity!.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('createMany inserts attachment rows and returns them', async () => {
    const rows = await repo.createMany(orgId, activityId, [
      { filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, cacheExpiresAt: null, cachePath: null },
      { filename: 'b.png', mimeType: 'image/png', sizeBytes: 200, cacheExpiresAt: new Date(Date.now() + 86_400_000), cachePath: `${orgId}/x` },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.filename).toBe('a.pdf');
    expect(rows[1]!.cachePath).toBe(`${orgId}/x`);
  });

  it('listForActivity returns rows in createdAt order', async () => {
    const rows = await repo.listForActivity(orgId, activityId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.find((r) => r.filename === 'a.pdf')).toBeDefined();
  });

  it('findById is tenant-scoped (orgB cannot read orgA row)', async () => {
    const [orgB] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'B', slug: `b-${Date.now()}`, defaultCurrency: 'USD' })
      .returning();
    const row = (await repo.listForActivity(orgId, activityId))[0]!;
    const found = await repo.findById(orgB!.id, row.id);
    expect(found).toBeNull();
  });

  it('clearCachePath nulls out cache columns for an id', async () => {
    const row = (await repo.listForActivity(orgId, activityId)).find((r) => r.filename === 'b.png')!;
    await repo.clearCachePath(row.id);
    const after = await repo.findById(orgId, row.id);
    expect(after!.cachePath).toBeNull();
    expect(after!.cacheExpiresAt).toBeNull();
  });

  it('findExpiredForEviction returns only rows past expiry with non-null cache_path', async () => {
    const [actExpired] = await testDb.db
      .insert(schema.emailAttachments)
      .values({
        organizationId: orgId,
        activityId,
        filename: 'exp.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 50,
        cachePath: `${orgId}/exp`,
        cacheExpiresAt: new Date(Date.now() - 86_400_000),
      })
      .returning();
    const expired = await repo.findExpiredForEviction(100);
    expect(expired.some((r) => r.id === actExpired!.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter @dealflow/api test -- email-attachments.repo`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repo**

Create `apps/api/src/modules/emails/email-attachments.repo.ts`:

```typescript
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';

export interface NewAttachmentInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  cachePath: string | null;
  cacheExpiresAt: Date | null;
}

type Row = typeof schema.emailAttachments.$inferSelect;

export class EmailAttachmentsRepo {
  constructor(private readonly db: Database) {}

  async createMany(orgId: string, activityId: string, inputs: NewAttachmentInput[]): Promise<Row[]> {
    if (inputs.length === 0) return [];
    return this.db
      .insert(schema.emailAttachments)
      .values(
        inputs.map((i) => ({
          organizationId: orgId,
          activityId,
          filename: i.filename,
          mimeType: i.mimeType,
          sizeBytes: i.sizeBytes,
          cachePath: i.cachePath,
          cacheExpiresAt: i.cacheExpiresAt,
        })),
      )
      .returning();
  }

  async listForActivity(orgId: string, activityId: string): Promise<Row[]> {
    return this.db
      .select()
      .from(schema.emailAttachments)
      .where(
        and(
          eq(schema.emailAttachments.organizationId, orgId),
          eq(schema.emailAttachments.activityId, activityId),
        ),
      )
      .orderBy(asc(schema.emailAttachments.createdAt));
  }

  async findById(orgId: string, id: string): Promise<Row | null> {
    const [row] = await this.db
      .select()
      .from(schema.emailAttachments)
      .where(
        and(eq(schema.emailAttachments.organizationId, orgId), eq(schema.emailAttachments.id, id)),
      )
      .limit(1);
    return row ?? null;
  }

  async clearCachePath(id: string): Promise<void> {
    await this.db
      .update(schema.emailAttachments)
      .set({ cachePath: null, cacheExpiresAt: null })
      .where(eq(schema.emailAttachments.id, id));
  }

  async findExpiredForEviction(limit: number): Promise<Row[]> {
    return this.db
      .select()
      .from(schema.emailAttachments)
      .where(
        and(
          isNotNull(schema.emailAttachments.cachePath),
          lt(schema.emailAttachments.cacheExpiresAt, new Date()),
        ),
      )
      .limit(limit);
  }

  async deleteForActivity(orgId: string, activityId: string): Promise<Row[]> {
    return this.db
      .delete(schema.emailAttachments)
      .where(
        and(
          eq(schema.emailAttachments.organizationId, orgId),
          eq(schema.emailAttachments.activityId, activityId),
        ),
      )
      .returning();
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @dealflow/api test -- email-attachments.repo`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/emails/email-attachments.repo.ts apps/api/test/modules/emails/email-attachments.repo.test.ts
git commit -m "feat(api): EmailAttachmentsRepo (createMany, list, findById, eviction queries)"
```

---

## Task 7: Per-org attachment-cache setting in integrations

**Files:**
- Modify: `apps/api/src/modules/integrations/repo.ts`
- Modify: `apps/api/src/modules/integrations/routes.ts`
- Modify: `apps/api/test/modules/integrations/routes.test.ts`

- [ ] **Step 1: Append failing tests**

Open `apps/api/test/modules/integrations/routes.test.ts`. Append:

```typescript
describe('Integrations PATCH — email.attachmentCacheDays', () => {
  it('persists a valid value', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie },
      payload: { email: { attachmentCacheDays: '7' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().email.attachmentCacheDays).toBe('7');
  });

  it('defaults to 30 when never set', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie },
    });
    expect(res.json().email.attachmentCacheDays).toBe('30');
  });

  it('rejects an invalid value', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie },
      payload: { email: { attachmentCacheDays: '60' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts "never" and round-trips', async () => {
    const { cookie } = await signupTestUser(app);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie },
      payload: { email: { attachmentCacheDays: 'never' } },
    });
    expect(patch.json().email.attachmentCacheDays).toBe('never');
    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie },
    });
    expect(get.json().email.attachmentCacheDays).toBe('never');
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- integrations/routes`
Expected: FAIL — the integrations endpoint doesn't know about `email.attachmentCacheDays`.

- [ ] **Step 3: Extend the integrations repo**

Open `apps/api/src/modules/integrations/repo.ts`. Find the `OrgIntegrationsRepo` (or similarly named class). Look for the methods that build the `PublicIntegrations` shape and the patch-merge logic.

Update the public shape builder to include the new `email` block:

```typescript
const integrationsJson = (row.integrations ?? {}) as Record<string, unknown>;
const emailBlock = (integrationsJson.email ?? {}) as Record<string, unknown>;
const attachmentCacheDays =
  emailBlock.attachmentCacheDays && typeof emailBlock.attachmentCacheDays === 'string'
    ? (emailBlock.attachmentCacheDays as AttachmentCacheDays)
    : '30';

return {
  // ... existing smtp, ai blocks ...
  email: { attachmentCacheDays },
};
```

Add the import:

```typescript
import type { AttachmentCacheDays } from '@dealflow/shared';
```

In the patch-merge logic, when `input.email` is set, merge it into the JSONB:

```typescript
if (input.email !== undefined) {
  const existingEmail = (integrationsJson.email ?? {}) as Record<string, unknown>;
  integrationsJson.email = input.email === null ? {} : { ...existingEmail, ...input.email };
}
```

Then write `integrationsJson` back to the column.

The exact location of these edits depends on the existing repo structure — read the file first and adapt. The shape changes are clear; the integration into the existing patterns may vary.

- [ ] **Step 4: Verify the route accepts the new field**

Open `apps/api/src/modules/integrations/routes.ts`. Find the PATCH handler. It should already use `updateIntegrationsInputSchema` from `@dealflow/shared` — since Task 2 added the `email` block to that schema, the route should accept it automatically. If the route uses a local schema instead of the shared one, update it to allow `email.attachmentCacheDays`.

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- integrations/routes`
Expected: PASS — all existing + 4 new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/integrations/repo.ts apps/api/src/modules/integrations/routes.ts apps/api/test/modules/integrations/routes.test.ts
git commit -m "feat(api): per-org email.attachmentCacheDays setting (default '30')"
```

---

## Task 8: POST `/api/v1/emails` — accept multipart with attachments

**Files:**
- Modify: `apps/api/package.json` — add `@fastify/multipart`.
- Modify: `apps/api/src/server.ts` — register the plugin.
- Modify: `apps/api/src/modules/emails/routes.ts` — multipart parsing + attachment persistence.
- Modify: `apps/api/test/modules/emails/routes.test.ts` — multipart tests.

- [ ] **Step 1: Install `@fastify/multipart`**

Run: `pnpm add -F @dealflow/api @fastify/multipart`
Expected: package added to `apps/api/package.json` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Register the plugin in server.ts**

Open `apps/api/src/server.ts`. Find the section where other Fastify plugins are registered (after `helmet`, `sensible`, `registerCors`, etc.). Add:

```typescript
    const multipart = await import('@fastify/multipart');
    await app.register(multipart.default, {
      limits: {
        fileSize: 25 * 1024 * 1024,      // 25 MB per file — matches MAX_FILE_BYTES
        files: 20,                        // sane upper bound on attachment count
        fields: 10,                       // body JSON + a few stragglers
      },
      attachFieldsToBody: false,         // we'll iterate parts manually for control
    });
```

- [ ] **Step 3: Append failing tests**

Open `apps/api/test/modules/emails/routes.test.ts`. Append:

```typescript
describe('POST /api/v1/emails — attachments (multipart)', () => {
  it('accepts one file and persists an attachment row', async () => {
    const { cookie, orgId } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');

    const form = new FormData();
    form.append(
      'body',
      JSON.stringify({ contactId, subject: 'with file', body: 'see attached' }),
    );
    form.append(
      'attachments',
      new Blob([Buffer.from('fake pdf bytes')], { type: 'application/pdf' }),
      'doc.pdf',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(201);
    const activityId = res.json().activity.id;

    const rows = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.activityId, activityId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.filename).toBe('doc.pdf');
    expect(rows[0]!.mimeType).toBe('application/pdf');
    expect(rows[0]!.sizeBytes).toBe(14);

    void orgId;
  });

  it('still works with a JSON-only payload (no attachments, backward compat)', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'no files', body: 'plain' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a blocked extension (.exe)', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');

    const form = new FormData();
    form.append('body', JSON.stringify({ contactId, subject: 's', body: 'b' }));
    form.append(
      'attachments',
      new Blob([Buffer.from('MZ')], { type: 'application/octet-stream' }),
      'installer.exe',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ATTACHMENT_BLOCKED_TYPE');
  });

  it('caches files when org has attachmentCacheDays set', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');

    const form = new FormData();
    form.append('body', JSON.stringify({ contactId, subject: 's', body: 'b' }));
    form.append(
      'attachments',
      new Blob([Buffer.from('hi')], { type: 'text/plain' }),
      'note.txt',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(201);
    const rows = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.activityId, res.json().activity.id));
    expect(rows[0]!.cachePath).not.toBeNull();
    expect(rows[0]!.cacheExpiresAt).not.toBeNull();
  });

  it('does NOT cache when org has attachmentCacheDays=never AND skips cache writes', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    // Note: 'never' means cache forever in our enum; if you want "no cache at all", use a separate column.
    // Per spec, all 4 values trigger caching with different expiries; 'never' means infinite. This test
    // confirms 'never' results in NULL cacheExpiresAt.
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie },
      payload: { email: { attachmentCacheDays: 'never' } },
    });
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');

    const form = new FormData();
    form.append('body', JSON.stringify({ contactId, subject: 's', body: 'b' }));
    form.append(
      'attachments',
      new Blob([Buffer.from('hi')], { type: 'text/plain' }),
      'note.txt',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(201);
    const rows = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.activityId, res.json().activity.id));
    expect(rows[0]!.cachePath).not.toBeNull();
    expect(rows[0]!.cacheExpiresAt).toBeNull(); // 'never' = no expiry
  });
});
```

Add the imports at the top of the test file if not already present:

```typescript
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
```

The tests use the browser-native `FormData` and `Blob` global — Vitest 2+ supports both via undici. If they're missing, import: `import { FormData, Blob } from 'node:buffer';` and `import { Blob } from 'node:buffer';`.

- [ ] **Step 4: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- emails/routes`
Expected: FAIL — multipart parsing not implemented.

- [ ] **Step 5: Extend the POST handler**

Open `apps/api/src/modules/emails/routes.ts`. Add imports:

```typescript
import { randomUUID } from 'node:crypto';
import { validateAttachment, validateAttachmentTotal, MAX_FILE_BYTES } from '../../lib/email-attachments-validate.js';
import { cacheAttachment } from '../../lib/email-attachments-store.js';
import { EmailAttachmentsRepo } from './email-attachments.repo.js';
```

Add the repo to the handler scope (alongside `activitiesRepo`):

```typescript
  const attachmentsRepo = new EmailAttachmentsRepo(deps.db);
```

Replace the POST handler with a version that handles BOTH JSON and multipart. Detection: `req.isMultipart()` returns true when the body is multipart.

```typescript
  app.post('/api/v1/emails', { preHandler: requireOrg }, async (req, reply) => {
    // 1. Parse the body — either JSON or multipart.
    let parsedJson: unknown;
    const filesBuffered: { filename: string; mimeType: string; buffer: Buffer }[] = [];

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          // Buffer the file fully. fastify/multipart enforces fileSize limit per part.
          const buf = await part.toBuffer();
          if (part.file.truncated) {
            return reply.status(400).send({
              error: {
                code: 'ATTACHMENT_TOO_LARGE',
                message: `File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit`,
                details: { filename: part.filename },
              },
            });
          }
          filesBuffered.push({
            filename: part.filename,
            mimeType: part.mimetype,
            buffer: buf,
          });
        } else if (part.fieldname === 'body') {
          try {
            parsedJson = JSON.parse(part.value as string);
          } catch {
            return reply.status(400).send({
              error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'body field is not valid JSON' },
            });
          }
        }
      }
    } else {
      parsedJson = req.body;
    }

    const parsed = sendEmailBodySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid email payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    // 2. Validate each attachment + total size.
    for (const f of filesBuffered) {
      const v = validateAttachment({
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.buffer.length,
      });
      if (!v.ok) {
        return reply.status(400).send({
          error: { code: v.code, message: v.message, details: { filename: f.filename } },
        });
      }
    }
    const totalCheck = validateAttachmentTotal(filesBuffered.map((f) => f.buffer.length));
    if (!totalCheck.ok) {
      return reply.status(400).send({
        error: { code: totalCheck.code, message: totalCheck.message },
      });
    }

    // 3. Standard recipient + sender lookups (unchanged from email-tracking task 7).
    const orgId = req.session!.currentOrgId!;
    const userId = req.user!.id;
    const { provider, fromAddress } = await resolveEmail(orgId);
    if (!fromAddress) return emailDisabled(reply);

    const [contactRow] = await deps.db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, orgId),
          eq(schema.contacts.id, parsed.data.contactId),
        ),
      )
      .limit(1);
    if (!contactRow) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' } });
    }
    if (!contactRow.email) {
      return reply.status(400).send({
        error: { code: 'CONTACT_HAS_NO_EMAIL', message: 'This contact has no email address.' },
      });
    }

    const [userRow] = await deps.db
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!userRow) {
      return reply
        .status(500)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Sender not found' } });
    }

    // 4. Pre-create the activity (with subject set) so tracking tokens have an id.
    const personalisedFrom = `${userRow.name} <${fromAddress}>`;
    const trackEnabled = parsed.data.trackEnabled ?? true;
    const resolvedEnv = { ...loadEnv(), ...deps.env };
    const trackingActive = trackEnabled && !!resolvedEnv.EMAIL_TRACKING_SECRET;

    const created = await activitiesRepo.create(orgId, userId, {
      kind: 'email',
      body: parsed.data.body,
      subject: parsed.data.subject,
      contactId: parsed.data.contactId,
      ccEmails: parsed.data.cc ?? null,
      bccEmails: parsed.data.bcc ?? null,
      trackingEnabled: trackEnabled,
      deliveryStatus: 'sent',
    });

    // 5. Build HTML body if tracking is active.
    let html: string | undefined;
    if (trackingActive) {
      const token = signTrackingToken(created.id, resolvedEnv.EMAIL_TRACKING_SECRET!);
      html = wrapBodyAsHtml(parsed.data.body, {
        pixelUrl: `${resolvedEnv.PUBLIC_API_URL}/track/open/${token}`,
        rewriteLink: (originalUrl) =>
          `${resolvedEnv.PUBLIC_API_URL}/track/click/${token}?u=${Buffer.from(
            originalUrl,
            'utf8',
          ).toString('base64url')}`,
      }).html;
    }

    // 6. Resolve per-org cache settings.
    const integrationsRepo = new OrgIntegrationsRepo(deps.db, deps.encryptionKey);
    const integrations = await integrationsRepo.getPublic(orgId);
    const cacheDays = integrations.email.attachmentCacheDays; // '7' | '30' | '90' | 'never'
    const cacheExpiresAt = cacheDays === 'never' ? null : new Date(Date.now() + Number(cacheDays) * 86_400_000);
    const cacheDir = resolvedEnv.ATTACHMENTS_CACHE_DIR;

    // 7. Persist attachment metadata + cache to disk.
    const attachmentRows = await attachmentsRepo.createMany(
      orgId,
      created.id,
      filesBuffered.map((f) => ({
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.buffer.length,
        cachePath: null, // populated below after write
        cacheExpiresAt,
      })),
    );

    const cachedFiles: { filename: string; path: string }[] = [];
    for (let i = 0; i < attachmentRows.length; i++) {
      const row = attachmentRows[i]!;
      const file = filesBuffered[i]!;
      try {
        const rel = await cacheAttachment({
          cacheDir,
          orgId,
          attachmentId: row.id,
          buffer: file.buffer,
        });
        await deps.db
          .update(schema.emailAttachments)
          .set({ cachePath: rel })
          .where(eq(schema.emailAttachments.id, row.id));
        const absolutePath = await import('node:path').then((m) => m.join(cacheDir, rel));
        cachedFiles.push({ filename: file.filename, path: absolutePath });
      } catch (err) {
        // Cache write failed — disk full, permissions, etc. Continue without caching this file;
        // the send still proceeds with the in-memory buffer.
        req.log.warn({ err, attachmentId: row.id }, 'attachment cache write failed');
      }
    }

    // 8. Build provider attachments — prefer path (cached), fall back to content (buffer).
    const providerAttachments = filesBuffered.map((f, i) => {
      const cached = cachedFiles.find((c) => c.filename === f.filename);
      if (cached) return { filename: f.filename, path: cached.path };
      return { filename: f.filename, content: f.buffer };
    });

    try {
      const result = await provider.send({
        from: personalisedFrom,
        to: contactRow.email,
        replyTo: userRow.email,
        subject: parsed.data.subject,
        text: parsed.data.body,
        ...(html ? { html } : {}),
        ...(parsed.data.cc ? { cc: parsed.data.cc } : {}),
        ...(parsed.data.bcc ? { bcc: parsed.data.bcc } : {}),
        ...(providerAttachments.length > 0 ? { attachments: providerAttachments } : {}),
      });

      const [updated] = await deps.db
        .update(schema.activities)
        .set({
          externalId: result.messageId,
          updatedAt: new Date(),
        })
        .where(eq(schema.activities.id, created.id))
        .returning();

      await deps.db.insert(schema.emailEvents).values({
        organizationId: orgId,
        activityId: created.id,
        eventType: 'sent',
      });

      // Fetch attachments fresh to include cache_path that was just set.
      const finalAttachments = await attachmentsRepo.listForActivity(orgId, created.id);
      return reply.status(201).send({
        activity: publicActivity(updated ?? created, finalAttachments),
      });
    } catch (err) {
      // Roll back: delete attachment rows AND their cached files.
      try {
        const rolled = await attachmentsRepo.deleteForActivity(orgId, created.id);
        for (const r of rolled) {
          if (r.cachePath) {
            await import('./email-attachments.repo.js'); // ensure side-effect-free
            const { evictAttachment } = await import('../../lib/email-attachments-store.js');
            await evictAttachment({ cacheDir, orgId, attachmentId: r.id });
          }
        }
        await deps.db
          .update(schema.activities)
          .set({ deliveryStatus: 'failed', updatedAt: new Date() })
          .where(eq(schema.activities.id, created.id));
      } catch (rollbackErr) {
        req.log.error({ err: rollbackErr, activityId: created.id }, 'attachment send rollback failed');
      }
      if (err instanceof EmailDisabledError) return emailDisabled(reply);
      req.log.error({ err }, 'POST /emails failed');
      return emailUpstreamError(reply);
    }
  });
```

Update `publicActivity` to accept an optional `attachments` argument:

```typescript
function publicActivity(
  row: typeof schemaType.activities.$inferSelect,
  attachments: (typeof schemaType.emailAttachments.$inferSelect)[] = [],
) {
  return {
    // ... existing fields including the email-tracking columns ...
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      cached: a.cachePath !== null && (a.cacheExpiresAt === null || a.cacheExpiresAt > new Date()),
      createdAt: a.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

The `cached: ... cacheExpiresAt === null || cacheExpiresAt > now` logic returns `true` for non-expired files. The 'never' case (`cacheExpiresAt === null` but `cachePath` set) is also considered cached.

- [ ] **Step 6: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- emails/routes`
Expected: PASS — all existing + 5 new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/server.ts apps/api/src/modules/emails/routes.ts apps/api/test/modules/emails/routes.test.ts
git commit -m "feat(api): POST /emails accepts multipart with attachments"
```

---

## Task 9: GET `/api/v1/attachments/:id` (download endpoint)

**Files:**
- Modify: `apps/api/src/modules/emails/routes.ts` — add the GET endpoint.
- Create: `apps/api/test/modules/emails/attachments-routes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/modules/emails/attachments-routes.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('GET /api/v1/attachments/:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cacheDir: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    cacheDir = await mkdtemp(join(tmpdir(), 'dealflow-att-dl-'));
    app = await buildTestApp({ db: testDb.db, env: { ATTACHMENTS_CACHE_DIR: cacheDir } });
  }, 30_000);
  afterAll(async () => {
    await app.close();
    await testDb.stop();
    await rm(cacheDir, { recursive: true, force: true });
  });

  async function seedAttachment(opts: {
    orgId: string;
    userId: string;
    cached: boolean;
    expired?: boolean;
  }): Promise<string> {
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: opts.orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: opts.orgId,
        ownerUserId: opts.userId,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();
    const cacheExpiresAt = opts.expired
      ? new Date(Date.now() - 86_400_000)
      : new Date(Date.now() + 86_400_000);
    const [att] = await testDb.db
      .insert(schema.emailAttachments)
      .values({
        organizationId: opts.orgId,
        activityId: activity!.id,
        filename: 'note.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        cachePath: opts.cached ? `${opts.orgId}/${activity!.id.slice(0, 8)}` : null,
        cacheExpiresAt: opts.cached ? cacheExpiresAt : null,
      })
      .returning();
    if (opts.cached) {
      const filePath = join(cacheDir, opts.orgId, att!.id);
      await mkdir(join(cacheDir, opts.orgId), { recursive: true });
      await writeFile(filePath, 'hello');
      // Update path to use att.id (since seed above had a placeholder)
      await testDb.db
        .update(schema.emailAttachments)
        .set({ cachePath: `${opts.orgId}/${att!.id}` })
        .where(eq(schema.emailAttachments.id, att!.id));
    }
    return att!.id;
  }

  it('returns 200 + file bytes for a cache hit', async () => {
    const { cookie, orgId, userId } = await signupTestUser(app);
    const attId = await seedAttachment({ orgId, userId, cached: true });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-disposition']).toContain('note.txt');
    expect(res.body).toBe('hello');
  });

  it('returns 404 ATTACHMENT_NOT_CACHED when cache_path is null', async () => {
    const { cookie, orgId, userId } = await signupTestUser(app);
    const attId = await seedAttachment({ orgId, userId, cached: false });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ATTACHMENT_NOT_CACHED');
  });

  it('returns 404 ATTACHMENT_NOT_CACHED when expired AND lazily clears cache_path', async () => {
    const { cookie, orgId, userId } = await signupTestUser(app);
    const attId = await seedAttachment({ orgId, userId, cached: true, expired: true });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ATTACHMENT_NOT_CACHED');

    // Verify lazy eviction cleared cache_path.
    const [row] = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.id, attId));
    expect(row!.cachePath).toBeNull();
  });

  it('enforces tenant isolation (orgB cannot see orgA attachment)', async () => {
    const a = await signupTestUser(app);
    const b = await signupTestUser(app);
    const attId = await seedAttachment({ orgId: a.orgId, userId: a.userId, cached: true });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${attId}`,
      headers: { cookie: b.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ATTACHMENT_NOT_CACHED');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attachments/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- emails/attachments-routes`
Expected: FAIL — endpoint doesn't exist yet.

- [ ] **Step 3: Implement the route**

Open `apps/api/src/modules/emails/routes.ts`. Add imports if needed:

```typescript
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { evictAttachment, attachmentCachePath } from '../../lib/email-attachments-store.js';
```

Inside `registerEmailRoutes`, add:

```typescript
  const idParamSchema = z.object({ id: z.string().uuid() });

  app.get('/api/v1/attachments/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const row = await attachmentsRepo.findById(orgId, params.data.id);
    if (!row) {
      // Don't leak existence across tenants — same 404 envelope as cache-miss.
      return reply.status(404).send({
        error: {
          code: 'ATTACHMENT_NOT_CACHED',
          message: 'Retrieve from your email provider\'s Sent folder.',
        },
      });
    }

    const resolvedEnv = { ...loadEnv(), ...deps.env };
    const cacheDir = resolvedEnv.ATTACHMENTS_CACHE_DIR;

    // Cache miss conditions
    const expired = row.cacheExpiresAt !== null && row.cacheExpiresAt <= new Date();
    if (row.cachePath === null || expired) {
      if (row.cachePath !== null) {
        // Lazy eviction
        await attachmentsRepo.clearCachePath(row.id);
        await evictAttachment({ cacheDir, orgId, attachmentId: row.id });
      }
      return reply.status(404).send({
        error: {
          code: 'ATTACHMENT_NOT_CACHED',
          message: 'Retrieve from your email provider\'s Sent folder.',
        },
      });
    }

    // Cache hit — verify file actually exists.
    const absPath = attachmentCachePath({ cacheDir, orgId, attachmentId: row.id });
    try {
      const s = await stat(absPath);
      if (!s.isFile()) throw new Error('not a file');
    } catch {
      // File was promised by DB but is missing on disk. Clear the column and 404.
      await attachmentsRepo.clearCachePath(row.id);
      return reply.status(404).send({
        error: {
          code: 'ATTACHMENT_NOT_CACHED',
          message: 'Retrieve from your email provider\'s Sent folder.',
        },
      });
    }

    reply.header('Content-Type', row.mimeType);
    reply.header('Content-Length', String(row.sizeBytes));
    // RFC 6266 Content-Disposition with the original filename. Quote it; escape quotes.
    const safeName = row.filename.replace(/"/g, '\\"');
    reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
    return reply.send(createReadStream(absPath));
  });
```

`idParamSchema` may already exist in the file from prior tasks; reuse if so.

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- emails/attachments-routes`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/emails/routes.ts apps/api/test/modules/emails/attachments-routes.test.ts
git commit -m "feat(api): GET /attachments/:id with cache-hit / cache-miss flow"
```

---

## Task 10: Activity routes return attachments + dashboard list returns count

**Files:**
- Modify: `apps/api/src/modules/activities/routes.ts`
- Modify: `apps/api/src/modules/emails/routes.ts` (the dashboard list endpoint adds `attachmentCount`)
- Modify: `apps/api/test/modules/activities/activities.routes.test.ts`
- Modify: `apps/api/test/modules/emails/routes.test.ts`

- [ ] **Step 1: Append failing tests for the activity detail endpoint**

Open `apps/api/test/modules/activities/activities.routes.test.ts`. Append:

```typescript
describe('GET /api/v1/activities/:id — attachments included', () => {
  it('returns an empty attachments array when there are none', async () => {
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${activity!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().activity.attachments).toEqual([]);
  });

  it('includes attachments with cached flag', async () => {
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();
    await testDb.db.insert(schema.emailAttachments).values([
      {
        organizationId: orgId,
        activityId: activity!.id,
        filename: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        cachePath: `${orgId}/${activity!.id}`,
        cacheExpiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        organizationId: orgId,
        activityId: activity!.id,
        filename: 'b.png',
        mimeType: 'image/png',
        sizeBytes: 200,
        cachePath: null,
        cacheExpiresAt: null,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${activity!.id}`,
      headers: { cookie },
    });
    const atts = res.json().activity.attachments;
    expect(atts).toHaveLength(2);
    expect(atts.find((a: any) => a.filename === 'a.pdf').cached).toBe(true);
    expect(atts.find((a: any) => a.filename === 'b.png').cached).toBe(false);
  });
});
```

- [ ] **Step 2: Append failing tests for the dashboard list endpoint**

Open `apps/api/test/modules/emails/routes.test.ts`. Append inside the existing dashboard-list describe block (or add a new it):

```typescript
  it('GET /api/v1/emails — each row has attachmentCount', async () => {
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X', email: 's@s.com' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        subject: 'with files',
        contactId: contact!.id,
      })
      .returning();
    await testDb.db.insert(schema.emailAttachments).values([
      {
        organizationId: orgId,
        activityId: activity!.id,
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        cachePath: null,
        cacheExpiresAt: null,
      },
      {
        organizationId: orgId,
        activityId: activity!.id,
        filename: 'y.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 200,
        cachePath: null,
        cacheExpiresAt: null,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?range=all',
      headers: { cookie },
    });
    const row = res.json().items.find((r: any) => r.subject === 'with files');
    expect(row.attachmentCount).toBe(2);
  });
```

- [ ] **Step 3: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- activities.routes emails/routes`
Expected: FAIL — neither response includes attachments yet.

- [ ] **Step 4: Wire attachments into `GET /api/v1/activities/:id`**

Open `apps/api/src/modules/activities/routes.ts`. Find the GET `/api/v1/activities/:id` handler. After fetching the row, also fetch attachments:

```typescript
    const row = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!row) { /* existing 404 */ }
    const attachmentsRepo = new EmailAttachmentsRepo(deps.db);
    const attachments = await attachmentsRepo.listForActivity(req.session!.currentOrgId!, params.data.id);
    return reply.send({ activity: publicActivity(row, attachments) });
```

Update `publicActivity()` in this file to mirror the one in emails/routes.ts (accept optional attachments array, render the same shape).

Add the import:

```typescript
import { EmailAttachmentsRepo } from '../emails/email-attachments.repo.js';
```

- [ ] **Step 5: Wire attachmentCount into `GET /api/v1/emails` dashboard list**

Open `apps/api/src/modules/emails/routes.ts`. Find the GET `/api/v1/emails` handler. The current query selects fields directly; extend it with a subquery for the count, OR fetch counts via a separate `IN` query after the main fetch:

```typescript
    // After the main rows query:
    const ids = sliced.map((r) => r.id);
    let countsByActivity = new Map<string, number>();
    if (ids.length > 0) {
      const countRows = await deps.db
        .select({
          activityId: schema.emailAttachments.activityId,
          c: sql<number>`COUNT(*)::int`,
        })
        .from(schema.emailAttachments)
        .where(inArray(schema.emailAttachments.activityId, ids))
        .groupBy(schema.emailAttachments.activityId);
      countsByActivity = new Map(countRows.map((r) => [r.activityId, r.c]));
    }

    const items = sliced.map((r) => ({
      // ... existing fields ...
      attachmentCount: countsByActivity.get(r.id) ?? 0,
    }));
```

Add the import:

```typescript
import { inArray, sql } from 'drizzle-orm';
```

- [ ] **Step 6: Update the shared `publicEmailRowSchema`**

Open `packages/shared/src/email-tracking.ts`. Add `attachmentCount` to `publicEmailRowSchema`:

```typescript
export const publicEmailRowSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().nullable(),
  recipientName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  sentAt: z.string(),
  deliveryStatus: z.enum(['sent', 'failed']),
  openCount: z.number().int().nonnegative(),
  clickCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
});
```

- [ ] **Step 7: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- activities.routes emails/routes`
Expected: PASS — all existing + new tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/activities/routes.ts apps/api/src/modules/emails/routes.ts packages/shared/src/email-tracking.ts apps/api/test/modules/activities/activities.routes.test.ts apps/api/test/modules/emails/routes.test.ts
git commit -m "feat(api): activity responses include attachments[]; dashboard rows include attachmentCount"
```

---

## Task 11: Eviction sweep

**Files:**
- Create: `apps/api/src/jobs/attachments-eviction.ts`
- Create: `apps/api/test/jobs/attachments-eviction.test.ts`
- Modify: `apps/api/src/server.ts` — kick off the sweep on boot + every 24h.

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/jobs/attachments-eviction.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../helpers/postgres.js';
import { runAttachmentEvictionSweep } from '../../src/jobs/attachments-eviction.js';
import { EmailAttachmentsRepo } from '../../src/modules/emails/email-attachments.repo.js';

describe('runAttachmentEvictionSweep', () => {
  let testDb: TestDatabase;
  let cacheDir: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    cacheDir = await mkdtemp(join(tmpdir(), 'dealflow-evict-'));
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'O', slug: `o-${Date.now()}`, defaultCurrency: 'USD' })
      .returning();
    orgId = org!.id;
    const [user] = await testDb.db
      .insert(schema.users)
      .values({ email: 'u@u.com', name: 'U', passwordHash: 'x' })
      .returning();
    userId = user!.id;
  }, 30_000);
  afterAll(async () => {
    await testDb.stop();
    await rm(cacheDir, { recursive: true, force: true });
  });

  async function seed(opts: { expired: boolean; cached: boolean }) {
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();
    const [att] = await testDb.db
      .insert(schema.emailAttachments)
      .values({
        organizationId: orgId,
        activityId: activity!.id,
        filename: 'x.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        cachePath: opts.cached ? `${orgId}/SET_BELOW` : null,
        cacheExpiresAt: opts.expired
          ? new Date(Date.now() - 86_400_000)
          : new Date(Date.now() + 86_400_000),
      })
      .returning();
    if (opts.cached) {
      await mkdir(join(cacheDir, orgId), { recursive: true });
      await writeFile(join(cacheDir, orgId, att!.id), 'hello');
      await testDb.db
        .update(schema.emailAttachments)
        .set({ cachePath: `${orgId}/${att!.id}` })
        .where(eq(schema.emailAttachments.id, att!.id));
    }
    return att!.id;
  }

  it('deletes expired files and clears cache_path on DB rows', async () => {
    const expiredId = await seed({ expired: true, cached: true });
    const freshId = await seed({ expired: false, cached: true });
    const neverCachedId = await seed({ expired: false, cached: false });

    const result = await runAttachmentEvictionSweep({ db: testDb.db, cacheDir });
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const [expiredRow] = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.id, expiredId));
    expect(expiredRow!.cachePath).toBeNull();

    const [freshRow] = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.id, freshId));
    expect(freshRow!.cachePath).not.toBeNull();

    // Expired file should be gone from disk.
    let exists = true;
    try {
      await stat(join(cacheDir, orgId, expiredId));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);

    void neverCachedId;
  });

  it('is idempotent when file was already deleted from disk', async () => {
    const id = await seed({ expired: true, cached: true });
    // Manually delete the file before the sweep
    await rm(join(cacheDir, orgId, id), { force: true });
    await expect(runAttachmentEvictionSweep({ db: testDb.db, cacheDir })).resolves.toBeDefined();
    const [row] = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.id, id));
    expect(row!.cachePath).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- jobs/attachments-eviction`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sweep**

Create `apps/api/src/jobs/attachments-eviction.ts`:

```typescript
import type { Database } from '@dealflow/db';
import { EmailAttachmentsRepo } from '../modules/emails/email-attachments.repo.js';
import { evictAttachment } from '../lib/email-attachments-store.js';

export interface EvictionSweepArgs {
  db: Database;
  cacheDir: string;
  /** Maximum rows to process per sweep. Default 1000. */
  batchSize?: number;
}

export interface EvictionSweepResult {
  processed: number;
  errors: number;
}

/**
 * One pass of attachment-cache eviction. Finds rows whose cache_expires_at is
 * in the past AND that still have a cache_path set, deletes the file from
 * disk, then nulls out the DB columns. Idempotent — unlinking a missing file
 * is a no-op.
 */
export async function runAttachmentEvictionSweep(
  args: EvictionSweepArgs,
): Promise<EvictionSweepResult> {
  const repo = new EmailAttachmentsRepo(args.db);
  const batchSize = args.batchSize ?? 1000;
  const rows = await repo.findExpiredForEviction(batchSize);
  let processed = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      await evictAttachment({
        cacheDir: args.cacheDir,
        orgId: r.organizationId,
        attachmentId: r.id,
      });
      await repo.clearCachePath(r.id);
      processed += 1;
    } catch (err) {
      errors += 1;
      // Best-effort: a single broken row shouldn't stop the sweep.
      // (Logging goes via the caller's logger if any; this module is logger-free.)
    }
  }
  return { processed, errors };
}
```

- [ ] **Step 4: Wire into server.ts**

Open `apps/api/src/server.ts`. After the app is built and all routes registered, before `return app`, add:

```typescript
    // Background cache eviction — every 24 hours + once at startup.
    const evict = async () => {
      try {
        const { runAttachmentEvictionSweep } = await import('./jobs/attachments-eviction.js');
        const result = await runAttachmentEvictionSweep({
          db: opts.db,
          cacheDir: env.ATTACHMENTS_CACHE_DIR,
        });
        if (result.processed > 0) {
          app.log.info({ processed: result.processed, errors: result.errors }, 'attachment eviction sweep complete');
        }
      } catch (err) {
        app.log.error({ err }, 'attachment eviction sweep failed');
      }
    };
    void evict(); // startup sweep
    const evictInterval = setInterval(() => void evict(), 24 * 60 * 60 * 1000);
    app.addHook('onClose', async () => {
      clearInterval(evictInterval);
    });
```

`env` is available in the same scope as the other env-using code (added in Task 4). If not, import via `import { loadEnv } from './env.js';` and call `loadEnv()` inside the buildApp factory.

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- jobs/attachments-eviction`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jobs/attachments-eviction.ts apps/api/src/server.ts apps/api/test/jobs/attachments-eviction.test.ts
git commit -m "feat(api): attachment cache eviction sweep (startup + every 24h)"
```

---

## Task 12: Frontend hooks + multipart helper

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/emails/api.ts`
- Modify: `apps/web/src/lib/query-keys.ts`

- [ ] **Step 1: Add FormData + blob helpers**

Open `apps/web/src/lib/api.ts`. Add two new helpers near the existing `apiFetch`:

```typescript
/**
 * POST a FormData body to the API. Browsers automatically set the
 * Content-Type with the multipart boundary; do NOT set it manually.
 * Throws on non-2xx with the standard error envelope.
 */
export async function apiFetchFormData<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    let envelope: unknown;
    try {
      envelope = await res.json();
    } catch {
      envelope = { error: { code: 'UPSTREAM', message: res.statusText } };
    }
    throw envelope;
  }
  return (await res.json()) as T;
}

/**
 * Download a file from the API. Returns a Blob plus the filename parsed
 * from the Content-Disposition header (or a fallback).
 */
export async function downloadAttachment(
  id: string,
): Promise<{ blob: Blob; filename: string } | { notCached: true }> {
  const res = await fetch(`/api/v1/attachments/${id}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (res.status === 404) {
    return { notCached: true };
  }
  if (!res.ok) {
    throw new Error(`Download failed: ${res.statusText}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match ? match[1]! : 'download';
  return { blob, filename };
}
```

- [ ] **Step 2: Update `useSendEmail` to support FormData**

Open `apps/web/src/features/emails/api.ts`. Find the existing `useSendEmail`. Update its mutationFn:

```typescript
import type { SendEmailInput } from '@dealflow/shared';
import { apiFetch, apiFetchFormData } from '@/lib/api';

interface SendEmailWithAttachments extends SendEmailInput {
  /** Files selected in the compose dialog. Optional. */
  attachments?: File[];
}

export function useSendEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendEmailWithAttachments) => {
      const { attachments, ...body } = input;
      if (!attachments || attachments.length === 0) {
        return apiFetch<{ activity: PublicActivity }>('/api/v1/emails', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      const form = new FormData();
      form.append('body', JSON.stringify(body));
      for (const f of attachments) {
        form.append('attachments', f, f.name);
      }
      return apiFetchFormData<{ activity: PublicActivity }>('/api/v1/emails', form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['emails'] });
    },
  });
}
```

If `PublicActivity` isn't already imported, add it.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/features/emails/api.ts apps/web/src/lib/query-keys.ts
git commit -m "feat(web): apiFetchFormData + downloadAttachment helpers; useSendEmail switches to FormData"
```

---

## Task 13: Compose dialog — attachments UI

**Files:**
- Modify: `apps/web/src/features/emails/compose-email-dialog.tsx`

- [ ] **Step 1: Add attachment state + handlers**

Open `apps/web/src/features/emails/compose-email-dialog.tsx`. Near the existing state declarations, add:

```typescript
const [attachments, setAttachments] = useState<File[]>([]);
const fileInputRef = useRef<HTMLInputElement>(null);

const totalBytes = attachments.reduce((sum, f) => sum + f.size, 0);
const MAX_TOTAL = 25 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;

function addFiles(newFiles: FileList | File[]) {
  const arr = Array.from(newFiles);
  const accepted: File[] = [];
  for (const f of arr) {
    if (f.size > MAX_FILE) {
      window.alert(`${f.name} is larger than 25 MB and was skipped.`);
      continue;
    }
    const projected = totalBytes + accepted.reduce((s, a) => s + a.size, 0) + f.size;
    if (projected > MAX_TOTAL) {
      window.alert(`Total attachment size would exceed 25 MB. ${f.name} skipped.`);
      continue;
    }
    accepted.push(f);
  }
  setAttachments((prev) => [...prev, ...accepted]);
}

function removeAttachment(index: number) {
  setAttachments((prev) => prev.filter((_, i) => i !== index));
}

function onDrop(e: React.DragEvent<HTMLDivElement>) {
  e.preventDefault();
  if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
}

function onPaste(e: React.ClipboardEvent<HTMLFormElement>) {
  if (!e.clipboardData?.files || e.clipboardData.files.length === 0) return;
  const arr = Array.from(e.clipboardData.files);
  if (arr.length > 0) {
    e.preventDefault();
    addFiles(arr);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
```

Add the `useRef` import: `import { useRef, useState } from 'react';`.

- [ ] **Step 2: Add the attachment list + picker UI**

Inside the form JSX, after the body textarea and before the tracking checkbox, add:

```tsx
<div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
  <div className="mb-1 flex items-center justify-between">
    <Label className="text-xs">Attachments</Label>
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      className="text-xs text-blue-600 hover:underline"
    >
      + Attach files
    </button>
    <input
      ref={fileInputRef}
      type="file"
      multiple
      hidden
      onChange={(e) => {
        if (e.target.files) addFiles(e.target.files);
        // Reset so the same file can be re-selected if removed.
        e.target.value = '';
      }}
    />
  </div>
  {attachments.length > 0 && (
    <ul className="mb-1 divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white text-sm">
      {attachments.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
          <span className="text-base">{f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-neutral-900">{f.name}</div>
            <div className="text-xs text-neutral-500">{formatSize(f.size)}</div>
          </div>
          <button
            type="button"
            onClick={() => removeAttachment(i)}
            className="text-neutral-400 hover:text-red-600"
            aria-label={`Remove ${f.name}`}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )}
  <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
    <span>
      {attachments.length === 0
        ? 'Drop files here or paste images'
        : `${attachments.length} file${attachments.length === 1 ? '' : 's'} · ${formatSize(totalBytes)} / 25 MB`}
    </span>
  </div>
</div>
```

- [ ] **Step 3: Pass attachments to the send mutation**

In the existing `onSubmit`, change the `send.mutateAsync` call to include `attachments`:

```typescript
await send.mutateAsync({
  contactId,
  subject: subject.trim(),
  body: body.trim(),
  ...(ccList.length > 0 ? { cc: ccList } : {}),
  ...(bccList.length > 0 ? { bcc: bccList } : {}),
  trackEnabled,
  ...(attachments.length > 0 ? { attachments } : {}),
});
```

After a successful submit (existing reset block), add:

```typescript
setAttachments([]);
```

- [ ] **Step 4: Wire the paste handler to the form**

Find the `<form onSubmit={onSubmit} ...>` element. Add `onPaste`:

```typescript
<form onSubmit={onSubmit} onPaste={onPaste} className="flex flex-col gap-4" noValidate>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/emails/compose-email-dialog.tsx
git commit -m "feat(web): compose dialog — file picker + drop zone + paste + size meter"
```

---

## Task 14: Activity-detail attachments list

**Files:**
- Create: `apps/web/src/features/emails/email-attachments-list.tsx`
- Modify: `apps/web/src/routes/app.activities.$id.tsx`

- [ ] **Step 1: Build the component**

Create `apps/web/src/features/emails/email-attachments-list.tsx`:

```tsx
import type { PublicEmailAttachment } from '@dealflow/shared';
import { downloadAttachment } from '@/lib/api';

interface Props {
  attachments: PublicEmailAttachment[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmailAttachmentsList({ attachments }: Props) {
  if (attachments.length === 0) return null;

  async function onDownload(att: PublicEmailAttachment) {
    if (!att.cached) {
      window.alert(
        "This attachment is no longer cached. Open your email provider's Sent folder to retrieve it.",
      );
      return;
    }
    try {
      const result = await downloadAttachment(att.id);
      if ('notCached' in result) {
        window.alert(
          "Cache miss — retrieve from your email provider's Sent folder.",
        );
        return;
      }
      // Trigger browser download
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert('Download failed. Try again or get the file from your Sent folder.');
    }
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-neutral-400">
        Attachments ({attachments.length})
      </h2>
      <ul className="mt-2 divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
        {attachments.map((att) => (
          <li key={att.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="text-base">{att.mimeType.startsWith('image/') ? '🖼️' : '📄'}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-neutral-900">{att.filename}</div>
              <div className="text-xs text-neutral-500">
                {formatSize(att.sizeBytes)} · {att.mimeType}
              </div>
            </div>
            {att.cached ? (
              <button
                type="button"
                onClick={() => void onDownload(att)}
                className="text-xs text-blue-600 hover:underline"
              >
                Download ↓
              </button>
            ) : (
              <span className="text-xs text-neutral-400" title="Cache expired or never written">
                Get from Sent folder ↗
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Embed on the activity detail page**

Open `apps/web/src/routes/app.activities.$id.tsx`. Add import:

```typescript
import { EmailAttachmentsList } from '@/features/emails/email-attachments-list';
```

Inside the page component, between the existing email-engagement-timeline block and the custom-fields section, add:

```tsx
{a.kind === 'email' && a.attachments.length > 0 && (
  <EmailAttachmentsList attachments={a.attachments} />
)}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean. (The shared `PublicActivity` already has `attachments` from Task 2.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/emails/email-attachments-list.tsx apps/web/src/routes/app.activities.\$id.tsx
git commit -m "feat(web): attachments section on activity detail page (download or Sent-folder pointer)"
```

---

## Task 15: Per-org cache-retention setting in Settings UI

**Files:**
- Modify: `apps/web/src/routes/app.settings.index.tsx` (or wherever the Email settings live)
- Modify: `apps/web/src/features/integrations/email-settings-section.tsx` (if it exists; else create alongside the AI/SMTP sections)

- [ ] **Step 1: Find where AI / SMTP settings live**

Open `apps/web/src/routes/app.settings.index.tsx`. Locate the existing `<AIIntegrationsSection />` and `<SmtpIntegrationSection />` JSX nodes.

- [ ] **Step 2: Add a new `EmailSettingsSection`**

Create `apps/web/src/features/integrations/email-settings-section.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ATTACHMENT_CACHE_DAYS, type AttachmentCacheDays } from '@dealflow/shared';
import { useIntegrations, useUpdateIntegrations } from './api';

const LABELS: Record<AttachmentCacheDays, string> = {
  '7': '7 days',
  '30': '30 days',
  '90': '90 days',
  never: 'Forever (keep all attachments)',
};

export function EmailSettingsSection() {
  const integrations = useIntegrations();
  const update = useUpdateIntegrations();
  const [days, setDays] = useState<AttachmentCacheDays>('30');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (integrations.data?.email?.attachmentCacheDays) {
      setDays(integrations.data.email.attachmentCacheDays);
    }
  }, [integrations.data]);

  const dirty = integrations.data?.email?.attachmentCacheDays !== days;

  async function onSave() {
    setSaved(false);
    await update.mutateAsync({ email: { attachmentCacheDays: days } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section
      className="mt-4 rounded-md border border-neutral-200 p-4"
      data-testid="email-settings"
    >
      <h2 className="mb-1 text-base font-medium">Email settings</h2>
      <p className="mb-3 text-sm text-neutral-500">
        How long should DealFlow keep sent-email attachments locally for fast re-download?
        After this window expires, the file is removed from disk and you'll retrieve it from
        your email provider's Sent folder.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="attachment-cache-days">Keep cached attachments for…</Label>
        <select
          id="attachment-cache-days"
          value={days}
          onChange={(e) => setDays(e.target.value as AttachmentCacheDays)}
          className="h-9 w-full max-w-sm rounded-md border border-neutral-200 bg-white px-3 text-sm"
          data-testid="attachment-cache-days"
        >
          {ATTACHMENT_CACHE_DAYS.map((v) => (
            <option key={v} value={v}>
              {LABELS[v]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={onSave} disabled={!dirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
        {update.isError && (
          <span className="text-sm text-red-600">Couldn't save — please try again.</span>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Render it in the settings page**

Open `apps/web/src/routes/app.settings.index.tsx`. Add import + render the section after `<SmtpIntegrationSection />`:

```tsx
import { EmailSettingsSection } from '@/features/integrations/email-settings-section';

// inside the JSX:
<EmailSettingsSection />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/integrations/email-settings-section.tsx apps/web/src/routes/app.settings.index.tsx
git commit -m "feat(web): Settings → Email → attachmentCacheDays dropdown"
```

---

## Task 16: Cross-package validation + tag

**Files:** none new.

- [ ] **Step 1: Full test matrix**

Run: `pnpm -r test`
Expected: all green. The known intermittent flake in `tasks.routes.test.ts` may surface; re-run once if it does.

- [ ] **Step 2: Typecheck + lint + format**

```bash
pnpm -r typecheck
pnpm lint
pnpm format:check || pnpm format
```

Expected: clean. If `pnpm format` makes changes, review the diff (should be cosmetic only).

- [ ] **Step 3: Stage formatter changes if any + commit**

```bash
git add -A
git diff --cached --stat
git commit -m "chore: lint + format after email attachments" || echo "nothing to commit"
```

- [ ] **Step 4: Manual smoke test**

Start the stack (`pnpm dev`). Sign up a fresh user (or use an existing one). Configure SMTP if not already configured. Then:

1. Open a contact in DealFlow and click ✉️ Email.
2. Click **+ Attach files**. Pick two files (one PDF, one image). They appear in the attachment list with size + remove buttons.
3. Type subject + body. Tracking checkbox stays checked.
4. Click **Send email**. Email arrives in the recipient inbox with both attachments. Confirm by checking the recipient inbox.
5. In DealFlow, open the activity detail page. The Attachments section shows both files with **Download ↓** links. Click each — file downloads with the correct name + content.
6. Open the **Sent** folder of the sender's email account (Gmail/Outlook/Yahoo web). Confirm both attachments are present there too.
7. Go to Settings → Email settings. Change "Keep cached attachments for…" to "7 days". Save.
8. Send another email with an attachment. Verify the new row's `cache_expires_at` is ~7 days out (use psql or DB inspector).
9. Change the setting to "Forever". Send another. Verify `cache_expires_at` is NULL.
10. (Optional) Manually set an existing row's `cache_expires_at` to a past timestamp, then click Download on it — should fall back to "Get from Sent folder ↗" and the row's cache_path becomes NULL.

- [ ] **Step 5: Tag + push**

```bash
git tag -a v0.1-email-attachments -m "Email Attachments v1 sub-plan complete"
git push origin main
git push origin v0.1-email-attachments
```

---

## Deferred to follow-up sub-plans (called out explicitly)

- **Inline images** (`cid:` references embedded in HTML body) — Images attach as files only.
- **Inbound attachments** — Depends on the deferred reply-detection sub-plan.
- **Virus scanning** — File contents are trusted.
- **Pre-upload / draft attachments** — Files travel with the send request; no separate upload endpoint.
- **Re-attaching saved files** — Each compose starts fresh.
- **Resumable uploads** — Single multipart POST. ≤ 25 MB so resumability isn't worth it.
- **Thumbnails / image previews** — Files show by filename + MIME icon only.
- **S3 / object-storage cache backend** — Local filesystem only. Future sub-plan can add S3 as a pluggable backend.
- **Per-org max cache size in bytes** — Cache size is bounded implicitly by retention. A future hard cap (e.g., 1 GB per org) is out of scope for v1.

## Implementer notes

- **`apps/api/.data/` is gitignored** via the existing `.data/` rule. No `.gitignore` changes needed.
- **Drizzle-kit generate is still broken in this repo.** Task 1 hand-writes the migration. Same pattern as `0008` and `0009`.
- **`@fastify/multipart` is a new dep.** Add via `pnpm add -F @dealflow/api @fastify/multipart`.
- **`req.isMultipart()` and `req.parts()`** come from `@fastify/multipart` and only work after the plugin is registered. The plugin must be registered globally (in `server.ts`), not per-route.
- **`part.toBuffer()`** is the simplest way to read a file fully into memory — fine for ≤ 25 MB. Streaming directly to disk via `part.file.pipe()` is a future optimization for larger files (resumable uploads sub-plan).
- **Buffer-then-validate ordering matters.** We read the full file before we know the size — `@fastify/multipart`'s `fileSize` limit truncates files past the limit but doesn't abort the request, so we must check `part.file.truncated` and reject when set.
- **Cache writes can fail without aborting the send.** A best-effort try/catch around `cacheAttachment` lets the email still go out even when disk is full. Logged via `req.log.warn`.
- **The `publicActivity` helper has two implementations** — one in `apps/api/src/modules/emails/routes.ts` (used by POST `/emails` response) and one in `apps/api/src/modules/activities/routes.ts` (used by GET `/activities/:id`). Both must be updated to include attachments. Consider extracting into a shared helper if you touch this again in the future.
- **The Email Tracking spec lives at `docs/superpowers/specs/2026-05-25-email-tracking-design.md`** if you need to understand existing tracking fields on the activity row.
