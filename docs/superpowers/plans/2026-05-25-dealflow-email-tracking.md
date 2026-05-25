# Email Tracking v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add outbound email tracking (opens, clicks, send-delivery status) plus CC/BCC support to the existing per-org SMTP send flow, with public pixel/redirect endpoints, an event log, and four UI surfaces (compose toggle, feed badge, activity timeline, entity rollup, `/app/emails` dashboard).

**Architecture:** Self-hosted tracking via HMAC-signed tokens. The send-side wraps the plain-text body in HTML (multipart/alternative), injects a 1×1 tracking pixel, and rewrites all `http(s)://` links through a click-redirect proxy. Recipient interactions hit unauthenticated public routes that verify the HMAC, INSERT to a new `email_events` table, and UPDATE denormalized counters on the activity row in the same transaction.

**Tech Stack:** Drizzle ORM + Postgres 16 (per-test disposable Postgres for integration tests), Fastify 5 + Zod, nodemailer (existing SMTP transport, extended with cc/bcc/html), React 19 + TanStack Router + TanStack Query, Tailwind v4, vitest.

**Source spec:** `docs/superpowers/specs/2026-05-25-email-tracking-design.md` — read before starting if you need design rationale.
**Source mockups:** `docs/superpowers/specs/2026-05-25-email-tracking-mockups.html` — open in a browser for visual reference.

---

## File Structure

**Shared (`packages/shared`):**
- Modify: `src/emails.ts` — extend `sendEmailBodySchema` with `cc`, `bcc`, `trackEnabled`.
- Modify: `src/activities.ts` — extend `PublicActivity` with `ccEmails`, `bccEmails`, `trackingEnabled`, `deliveryStatus`, and 6 tracking-count fields.
- Create: `src/email-tracking.ts` — `PublicEmailEvent`, `PublicEmailRow`, `EmailEngagementRollup`.
- Modify: `src/index.ts` — re-export.

**DB (`packages/db`):**
- Modify: `src/schema/activities.ts` — add 8 columns.
- Create: `src/schema/email-events.ts` — new Drizzle table.
- Modify: `src/schema/index.ts` — re-export.
- Create: `migrations/0009_email_tracking.sql` — hand-written DDL (drizzle-kit generate is blocked by an old snapshot collision; this project uses hand-written migrations from 0003 onward).
- Modify: `migrations/meta/_journal.json` — add entry for 0009.

**Email (`packages/email`):**
- Modify: `src/provider.ts` — extend `SendEmailInput` with `cc?: string[]`, `bcc?: string[]`, `html?: string`.
- Modify: `src/providers/smtp.ts` — pass cc/bcc/html through to nodemailer.

**API (`apps/api`):**
- Modify: `src/env.ts` — read `PUBLIC_API_URL` + `EMAIL_TRACKING_SECRET`.
- Modify: `.env.example` — document new env vars.
- Create: `src/lib/email-tracking-token.ts` — HMAC sign/verify pure functions.
- Create: `test/lib/email-tracking-token.test.ts`.
- Create: `src/lib/email-html-wrap.ts` — plaintext-to-HTML wrapper with pixel + link rewriting.
- Create: `test/lib/email-html-wrap.test.ts`.
- Modify: `src/modules/emails/routes.ts` — extend POST `/emails`, add GET `/emails` (dashboard list), add GET `/emails/engagement/:entityType/:id`.
- Create: `src/modules/emails/tracking-routes.ts` — public unauthenticated `/track/open/:token` + `/track/click/:token`.
- Modify: `src/modules/activities/routes.ts` — add GET `/api/v1/activities/:id/events`.
- Modify: `src/modules/activities/activities.repo.ts` — include new tracking columns in public projection.
- Modify: `src/server.ts` — register tracking-routes (no requireOrg).
- Modify: `test/modules/emails/routes.test.ts` — extend with tracking flow tests.
- Create: `test/modules/emails/tracking-routes.test.ts`.

**Web (`apps/web`):**
- Modify: `src/lib/query-keys.ts` — add `emails.list`, `emails.engagement`, `activities.events`.
- Modify: `src/features/emails/api.ts` — add hooks: `useEmailEvents`, `useEmailEngagement`, `useEmailsList`. Extend `useSendEmail` payload type.
- Modify: `src/features/emails/compose-email-dialog.tsx` — CC/BCC reveal + tracking toggle.
- Create: `src/features/emails/email-tracking-badge.tsx` — feed-row badge.
- Create: `src/features/emails/email-engagement-timeline.tsx` — activity-detail section.
- Create: `src/features/emails/email-engagement-rollup.tsx` — entity-detail card.
- Modify: `src/features/activities/activity-feed.tsx` — embed badge on email rows.
- Modify: `src/routes/app.activities.$id.tsx` — embed timeline for email kind.
- Modify: `src/routes/app.contacts.$id.tsx`, `src/routes/app.companies.$id.tsx`, `src/routes/app.deals.$id.tsx` — embed rollup card.
- Create: `src/routes/app.emails.tsx` — `/app/emails` dashboard route.
- Modify: `src/components/app-sidebar.tsx` (or wherever the sidebar links live) — add Emails entry.

---

## Task 1: DB schema + migration

**Files:**
- Modify: `packages/db/src/schema/activities.ts`
- Create: `packages/db/src/schema/email-events.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0009_email_tracking.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Extend `activities` schema**

Open `packages/db/src/schema/activities.ts`. Ensure `boolean`, `integer` are imported from `'drizzle-orm/pg-core'`. Then add these columns to the table definition, immediately before the existing `customFields` column:

```typescript
    trackingEnabled: boolean('tracking_enabled').notNull().default(true),
    ccEmails: text('cc_emails').array(),
    bccEmails: text('bcc_emails').array(),
    deliveryStatus: text('delivery_status').notNull().default('sent'),
    openCount: integer('open_count').notNull().default(0),
    firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    clickCount: integer('click_count').notNull().default(0),
    firstClickedAt: timestamp('first_clicked_at', { withTimezone: true }),
    lastClickedAt: timestamp('last_clicked_at', { withTimezone: true }),
```

Make sure `boolean` and `integer` are in the import line (they may not be — add them).

- [ ] **Step 2: Create `email-events.ts` Drizzle schema**

Create `packages/db/src/schema/email-events.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { activities } from './activities';

export const emailEvents = pgTable(
  'email_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // 'sent' | 'open' | 'click'
    url: text('url'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activityIdx: index('email_events_activity_idx').on(t.activityId, t.occurredAt),
    orgIdx: index('email_events_org_idx').on(t.organizationId, t.occurredAt),
  }),
);

export type EmailEventRow = typeof emailEvents.$inferSelect;
export type NewEmailEvent = typeof emailEvents.$inferInsert;
```

- [ ] **Step 3: Re-export from schema index**

Edit `packages/db/src/schema/index.ts` — append:

```typescript
export * from './email-events';
```

- [ ] **Step 4: Create migration SQL by hand**

The project's `drizzle-kit generate` is blocked by an old snapshot collision in `migrations/meta/0002_snapshot.json` vs `0003_snapshot.json` — that's been the case since Custom Fields (commit `74adbd0`). Hand-write the SQL directly.

Create `packages/db/migrations/0009_email_tracking.sql`:

```sql
-- Sub-Plan: Email Tracking v1.
-- Adds 8 tracking columns to activities (counters, timestamps, cc/bcc lists,
-- delivery status, tracking-enabled flag) plus a new email_events table
-- holding one row per open/click/sent event. Aggregate counts are
-- denormalized on activities for fast feed-row reads; events power the
-- activity-detail timeline and /app/emails dashboard.

ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "tracking_enabled"  boolean      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "cc_emails"         text[],
  ADD COLUMN IF NOT EXISTS "bcc_emails"        text[],
  ADD COLUMN IF NOT EXISTS "delivery_status"   text         NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS "open_count"        integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_opened_at"   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_opened_at"    timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "click_count"       integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_clicked_at"  timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_clicked_at"   timestamp with time zone;

CREATE TABLE IF NOT EXISTS "email_events" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "activity_id"     uuid NOT NULL REFERENCES "activities"("id")    ON DELETE CASCADE,
  "event_type"      text NOT NULL,
  "url"             text,
  "occurred_at"     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_events_activity_idx"
  ON "email_events" ("activity_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "email_events_org_idx"
  ON "email_events" ("organization_id", "occurred_at");
```

- [ ] **Step 5: Add journal entry**

Open `packages/db/migrations/meta/_journal.json`. Inside the `entries` array, after the `0008_custom_fields` entry, append (mind the comma on the prior entry):

```json
    {
      "idx": 9,
      "version": "7",
      "when": 1779900000000,
      "tag": "0009_email_tracking",
      "breakpoints": true
    }
```

- [ ] **Step 6: Apply the migration**

Run: `pnpm --filter @dealflow/db db:migrate`
Expected: `[✓] migrations applied successfully!` (the 0009 file applies cleanly because the snapshot collision affects `db:generate`, not `db:migrate`).

- [ ] **Step 7: Typecheck the db package**

Run: `pnpm --filter @dealflow/db typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/activities.ts packages/db/src/schema/email-events.ts packages/db/src/schema/index.ts packages/db/migrations/0009_email_tracking.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): email_events table + 8 tracking columns on activities"
```

---

## Task 2: Shared schemas (tracking + cc/bcc + event/row/rollup types)

**Files:**
- Modify: `packages/shared/src/emails.ts`
- Modify: `packages/shared/src/activities.ts`
- Create: `packages/shared/src/email-tracking.ts`
- Create: `packages/shared/src/email-tracking.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/email-tracking.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  publicEmailEventSchema,
  publicEmailRowSchema,
  emailEngagementRollupSchema,
  emailDashboardQuerySchema,
} from './email-tracking.js';
import { sendEmailBodySchema } from './emails.js';

describe('sendEmailBodySchema (extended)', () => {
  const base = { contactId: '11111111-1111-1111-1111-111111111111', subject: 'Hi', body: 'Body' };
  it('accepts a payload with no cc/bcc/trackEnabled', () => {
    expect(() => sendEmailBodySchema.parse(base)).not.toThrow();
  });
  it('accepts cc + bcc arrays of valid emails', () => {
    expect(() =>
      sendEmailBodySchema.parse({ ...base, cc: ['a@b.com'], bcc: ['c@d.com'] }),
    ).not.toThrow();
  });
  it('rejects an invalid email in cc', () => {
    expect(() => sendEmailBodySchema.parse({ ...base, cc: ['not-an-email'] })).toThrow();
  });
  it('accepts trackEnabled boolean', () => {
    expect(() => sendEmailBodySchema.parse({ ...base, trackEnabled: false })).not.toThrow();
  });
  it('rejects cc with more than 20 entries', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `u${i}@example.com`);
    expect(() => sendEmailBodySchema.parse({ ...base, cc: tooMany })).toThrow();
  });
});

describe('publicEmailEventSchema', () => {
  it('accepts a sent event with no url', () => {
    expect(() =>
      publicEmailEventSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        eventType: 'sent',
        url: null,
        occurredAt: '2026-05-25T01:00:00.000Z',
      }),
    ).not.toThrow();
  });
  it('accepts a click event with a url', () => {
    expect(() =>
      publicEmailEventSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        eventType: 'click',
        url: 'https://example.com',
        occurredAt: '2026-05-25T01:00:00.000Z',
      }),
    ).not.toThrow();
  });
  it('rejects an unknown event type', () => {
    expect(() =>
      publicEmailEventSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        eventType: 'reply',
        url: null,
        occurredAt: '2026-05-25T01:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('emailEngagementRollupSchema', () => {
  it('accepts a fully zeroed rollup', () => {
    expect(() =>
      emailEngagementRollupSchema.parse({
        sent: 0,
        opened: 0,
        openedPct: 0,
        clickedWith: 0,
        clickedWithPct: 0,
        lastActivityAt: null,
      }),
    ).not.toThrow();
  });
  it('accepts a populated rollup', () => {
    expect(() =>
      emailEngagementRollupSchema.parse({
        sent: 8,
        opened: 5,
        openedPct: 0.62,
        clickedWith: 3,
        clickedWithPct: 0.37,
        lastActivityAt: '2026-05-25T01:00:00.000Z',
      }),
    ).not.toThrow();
  });
});

describe('emailDashboardQuerySchema', () => {
  it('applies defaults', () => {
    const out = emailDashboardQuerySchema.parse({});
    expect(out.status).toBe('all');
    expect(out.range).toBe('7d');
  });
  it('rejects an unknown status', () => {
    expect(() => emailDashboardQuerySchema.parse({ status: 'unread' })).toThrow();
  });
});

describe('publicEmailRowSchema', () => {
  it('accepts a row with engagement counts', () => {
    expect(() =>
      publicEmailRowSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        subject: 'Hi',
        recipientName: 'Sarah',
        recipientEmail: 'sarah@acme.com',
        sentAt: '2026-05-25T01:00:00.000Z',
        deliveryStatus: 'sent',
        openCount: 3,
        clickCount: 1,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter @dealflow/shared test -- email-tracking`
Expected: FAIL — module not found.

- [ ] **Step 3: Extend `sendEmailBodySchema`**

Open `packages/shared/src/emails.ts`. Add the new fields to the existing schema (mind the existing field — don't duplicate). After this step, the schema should look like:

```typescript
import { z } from 'zod';

export const sendEmailBodySchema = z.object({
  contactId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  cc: z.array(z.string().email()).max(20).optional(),
  bcc: z.array(z.string().email()).max(20).optional(),
  trackEnabled: z.boolean().optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailBodySchema>;
```

Preserve any other exports the file already has — only extend the schema.

- [ ] **Step 4: Extend `PublicActivity`**

Open `packages/shared/src/activities.ts`. Append these fields to the `PublicActivity` interface, right before the `createdAt` field:

```typescript
  // Email-tracking columns (defaults safe for non-email activities)
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
```

- [ ] **Step 5: Create `email-tracking.ts`**

Create `packages/shared/src/email-tracking.ts`:

```typescript
import { z } from 'zod';

export const EMAIL_EVENT_TYPES = ['sent', 'open', 'click'] as const;
export const emailEventTypeSchema = z.enum(EMAIL_EVENT_TYPES);
export type EmailEventType = z.infer<typeof emailEventTypeSchema>;

export const publicEmailEventSchema = z.object({
  id: z.string().uuid(),
  eventType: emailEventTypeSchema,
  url: z.string().nullable(),
  occurredAt: z.string(),
});
export type PublicEmailEvent = z.infer<typeof publicEmailEventSchema>;

export const publicEmailRowSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().nullable(),
  recipientName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  sentAt: z.string(),
  deliveryStatus: z.enum(['sent', 'failed']),
  openCount: z.number().int().nonnegative(),
  clickCount: z.number().int().nonnegative(),
});
export type PublicEmailRow = z.infer<typeof publicEmailRowSchema>;

export const emailEngagementRollupSchema = z.object({
  sent: z.number().int().nonnegative(),
  opened: z.number().int().nonnegative(),
  openedPct: z.number().min(0).max(1),
  clickedWith: z.number().int().nonnegative(),
  clickedWithPct: z.number().min(0).max(1),
  lastActivityAt: z.string().nullable(),
});
export type EmailEngagementRollup = z.infer<typeof emailEngagementRollupSchema>;

export const EMAIL_ROLLUP_ENTITY_TYPES = ['contact', 'company', 'deal'] as const;
export const emailRollupEntityTypeSchema = z.enum(EMAIL_ROLLUP_ENTITY_TYPES);
export type EmailRollupEntityType = z.infer<typeof emailRollupEntityTypeSchema>;

export const EMAIL_DASHBOARD_STATUSES = ['all', 'opened', 'clicked', 'failed'] as const;
export const EMAIL_DASHBOARD_RANGES = ['7d', '30d', 'all'] as const;
export const emailDashboardQuerySchema = z.object({
  status: z.enum(EMAIL_DASHBOARD_STATUSES).default('all'),
  range: z.enum(EMAIL_DASHBOARD_RANGES).default('7d'),
  q: z.string().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type EmailDashboardQuery = z.infer<typeof emailDashboardQuerySchema>;

export interface EmailDashboardResponse {
  items: PublicEmailRow[];
  nextCursor: string | null;
}
```

- [ ] **Step 6: Re-export from shared index**

Edit `packages/shared/src/index.ts` — append:

```typescript
export * from './email-tracking.js';
```

- [ ] **Step 7: Run tests to verify pass**

Run: `pnpm --filter @dealflow/shared test -- email-tracking`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @dealflow/shared typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/emails.ts packages/shared/src/activities.ts packages/shared/src/email-tracking.ts packages/shared/src/email-tracking.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): email tracking schemas + cc/bcc/trackEnabled on send"
```

---

## Task 3: HMAC tracking token (sign + verify)

**Files:**
- Create: `apps/api/src/lib/email-tracking-token.ts`
- Create: `apps/api/test/lib/email-tracking-token.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/lib/email-tracking-token.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { signTrackingToken, verifyTrackingToken } from '../../src/lib/email-tracking-token.js';

const SECRET = 'a'.repeat(64);
const ACTIVITY_ID = '11111111-1111-1111-1111-111111111111';

describe('email-tracking-token', () => {
  it('signs and verifies a round-trip', () => {
    const token = signTrackingToken(ACTIVITY_ID, SECRET);
    const result = verifyTrackingToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.activityId).toBe(ACTIVITY_ID);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signTrackingToken(ACTIVITY_ID, SECRET);
    const result = verifyTrackingToken(token, 'b'.repeat(64));
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed token (no dot)', () => {
    expect(verifyTrackingToken('garbage', SECRET).ok).toBe(false);
    expect(verifyTrackingToken('', SECRET).ok).toBe(false);
  });

  it('rejects a token with tampered activity id', () => {
    const token = signTrackingToken(ACTIVITY_ID, SECRET);
    const [, sig] = token.split('.');
    const tampered = 'AAAAAAAAAAAAAAAAAAAAAAAAAA.' + sig;
    expect(verifyTrackingToken(tampered, SECRET).ok).toBe(false);
  });

  it('produces URL-safe output (no +, /, =)', () => {
    const token = signTrackingToken(ACTIVITY_ID, SECRET);
    expect(token).not.toMatch(/[+/=]/);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter @dealflow/api test -- email-tracking-token`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `apps/api/src/lib/email-tracking-token.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Buffer {
  // Pad to a multiple of 4
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * Sign a tracking token for the given activity id. Format:
 *   <base64url(activityId-bytes)>.<base64url(HMAC-SHA256(secret, activityId-bytes))>
 *
 * `activityId` is a UUID v4 string; we hash its raw 16-byte form for compactness.
 * Anyone with the secret can forge; HMAC ensures tampering is detectable.
 */
export function signTrackingToken(activityId: string, secret: string): string {
  const idBytes = uuidToBytes(activityId);
  const sig = createHmac('sha256', secret).update(idBytes).digest();
  return `${base64url(idBytes)}.${base64url(sig)}`;
}

export type TokenResult = { ok: true; activityId: string } | { ok: false; error: string };

/** Constant-time verify. Returns the decoded activity id on success. */
export function verifyTrackingToken(token: string, secret: string): TokenResult {
  if (!token || typeof token !== 'string') return { ok: false, error: 'empty' };
  const dot = token.indexOf('.');
  if (dot < 0) return { ok: false, error: 'malformed' };
  const idPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let idBytes: Buffer;
  let providedSig: Buffer;
  try {
    idBytes = fromBase64url(idPart);
    providedSig = fromBase64url(sigPart);
  } catch {
    return { ok: false, error: 'decode' };
  }
  if (idBytes.length !== 16) return { ok: false, error: 'bad_id_length' };
  const expected = createHmac('sha256', secret).update(idBytes).digest();
  if (providedSig.length !== expected.length) return { ok: false, error: 'bad_sig_length' };
  if (!timingSafeEqual(providedSig, expected)) return { ok: false, error: 'bad_sig' };
  return { ok: true, activityId: bytesToUuid(idBytes) };
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error('Invalid UUID');
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(buf: Buffer): string {
  const h = buf.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @dealflow/api test -- email-tracking-token`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/email-tracking-token.ts apps/api/test/lib/email-tracking-token.test.ts
git commit -m "feat(api): HMAC-signed email tracking tokens (sign + verify)"
```

---

## Task 4: HTML wrapping (pixel injection + link rewriting)

**Files:**
- Create: `apps/api/src/lib/email-html-wrap.ts`
- Create: `apps/api/test/lib/email-html-wrap.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/lib/email-html-wrap.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { wrapBodyAsHtml } from '../../src/lib/email-html-wrap.js';

const PIXEL_URL = 'https://crm.test/track/open/tok';
const rewriter = (url: string) => `https://crm.test/track/click/tok?u=${encodeURIComponent(url)}`;

describe('wrapBodyAsHtml', () => {
  it('returns both html and text strings', () => {
    const out = wrapBodyAsHtml('hello', { pixelUrl: PIXEL_URL, rewriteLink: rewriter });
    expect(out.text).toBe('hello');
    expect(out.html).toContain('hello');
  });

  it('embeds the pixel <img> with display:none', () => {
    const { html } = wrapBodyAsHtml('hi', { pixelUrl: PIXEL_URL, rewriteLink: rewriter });
    expect(html).toContain(`src="${PIXEL_URL}"`);
    expect(html).toContain('display:none');
  });

  it('preserves line breaks as <br>', () => {
    const { html } = wrapBodyAsHtml('a\nb\nc', { pixelUrl: PIXEL_URL, rewriteLink: rewriter });
    expect(html).toContain('a<br>b<br>c');
  });

  it('escapes HTML special characters', () => {
    const { html } = wrapBodyAsHtml('<script>alert(1)</script>', {
      pixelUrl: PIXEL_URL,
      rewriteLink: rewriter,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rewrites a single https link', () => {
    const { html } = wrapBodyAsHtml('Visit https://docs.acme.com/x for details', {
      pixelUrl: PIXEL_URL,
      rewriteLink: rewriter,
    });
    expect(html).toContain('href="https://crm.test/track/click/tok?u=');
    expect(html).toContain('docs.acme.com');
  });

  it('rewrites multiple links independently', () => {
    const { html } = wrapBodyAsHtml('https://a.com and https://b.com', {
      pixelUrl: PIXEL_URL,
      rewriteLink: rewriter,
    });
    // Both URLs should be wrapped
    const aMatches = (html.match(/href="/g) ?? []).length;
    expect(aMatches).toBeGreaterThanOrEqual(2);
  });

  it('omits the pixel when pixelUrl is null', () => {
    const { html } = wrapBodyAsHtml('hi', { pixelUrl: null, rewriteLink: rewriter });
    expect(html).not.toContain('<img');
  });

  it('does not rewrite links when rewriteLink is null', () => {
    const { html } = wrapBodyAsHtml('https://a.com', { pixelUrl: PIXEL_URL, rewriteLink: null });
    expect(html).toContain('https://a.com');
    expect(html).not.toContain('/track/click/');
  });

  it('keeps the text version unmodified', () => {
    const body = 'Visit https://a.com';
    const { text } = wrapBodyAsHtml(body, { pixelUrl: PIXEL_URL, rewriteLink: rewriter });
    expect(text).toBe(body);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter @dealflow/api test -- email-html-wrap`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Create `apps/api/src/lib/email-html-wrap.ts`:

```typescript
export interface WrapOptions {
  /** Absolute URL the recipient's mail client GETs when the body renders. Set to null to omit the pixel. */
  pixelUrl: string | null;
  /** Maps an original URL → the click-redirect URL. Set to null to skip link rewriting. */
  rewriteLink: ((originalUrl: string) => string) | null;
}

export interface WrappedBody {
  /** Multipart/alternative HTML half. */
  html: string;
  /** Multipart/alternative plain-text half (unchanged from caller input). */
  text: string;
}

/**
 * Wrap a plain-text email body in minimal HTML suitable for tracking.
 *
 *   • Escapes HTML-significant characters so user input can't break out.
 *   • Replaces every `http(s)://` URL in the body with an anchor pointing at
 *     the click-redirect endpoint (when `rewriteLink` is provided).
 *   • Appends an invisible 1x1 tracking pixel referencing `pixelUrl`.
 *
 * Returns BOTH html and text — the SMTP transport sends them as a
 * multipart/alternative payload so HTML-blocking clients still see the
 * unmodified plaintext.
 */
export function wrapBodyAsHtml(plainBody: string, opts: WrapOptions): WrappedBody {
  // 1. Find and tokenise URLs BEFORE escaping (so we keep them intact).
  //    URL regex: http(s)://<non-whitespace>+, conservative — punctuation at the end
  //    is stripped from the captured URL but stays in surrounding text.
  const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/gi;
  const parts: { kind: 'text' | 'url'; value: string }[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(plainBody)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ kind: 'text', value: plainBody.slice(lastIndex, m.index) });
    }
    parts.push({ kind: 'url', value: m[0]! });
    lastIndex = m.index + m[0]!.length;
  }
  if (lastIndex < plainBody.length) {
    parts.push({ kind: 'text', value: plainBody.slice(lastIndex) });
  }

  // 2. Build HTML by escaping text parts and (optionally) wrapping URL parts in anchors.
  let inner = '';
  for (const p of parts) {
    if (p.kind === 'text') {
      inner += escapeHtml(p.value).replace(/\n/g, '<br>');
    } else {
      const href = opts.rewriteLink ? opts.rewriteLink(p.value) : p.value;
      const display = escapeHtml(p.value);
      inner += `<a href="${escapeAttr(href)}">${display}</a>`;
    }
  }

  const pixel = opts.pixelUrl
    ? `<img src="${escapeAttr(opts.pixelUrl)}" width="1" height="1" alt="" style="display:none;border:0">`
    : '';

  const html =
    '<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#111">' +
    `<div>${inner}</div>${pixel}` +
    '</body></html>';

  return { html, text: plainBody };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @dealflow/api test -- email-html-wrap`
Expected: PASS — 9/9.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/email-html-wrap.ts apps/api/test/lib/email-html-wrap.test.ts
git commit -m "feat(api): wrapBodyAsHtml — pixel injection + safe link rewriting"
```

---

## Task 5: Extend email provider (cc/bcc/html)

**Files:**
- Modify: `packages/email/src/provider.ts`
- Modify: `packages/email/src/providers/smtp.ts`
- Modify: `packages/email/src/providers/smtp.test.ts`

- [ ] **Step 1: Append failing tests for cc/bcc/html**

Open `packages/email/src/providers/smtp.test.ts`. Look at the existing tests to confirm the `sendMail` mock pattern, then append a new describe block:

```typescript
describe('SmtpEmailProvider — cc/bcc/html extensions', () => {
  it('passes cc and bcc arrays through to the transporter', async () => {
    const calls: any[] = [];
    const fakeTransporter = {
      sendMail: async (opts: any) => {
        calls.push(opts);
        return { messageId: 'm-1' };
      },
    };
    const p = new SmtpEmailProvider({ transporter: fakeTransporter as never });
    await p.send({
      from: 'Alice <a@a.com>',
      to: 's@s.com',
      replyTo: 'a@a.com',
      subject: 'Hi',
      text: 'plain',
      cc: ['x@x.com', 'y@y.com'],
      bcc: ['z@z.com'],
    });
    expect(calls[0].cc).toEqual(['x@x.com', 'y@y.com']);
    expect(calls[0].bcc).toEqual(['z@z.com']);
  });

  it('passes html when provided (alongside text)', async () => {
    const calls: any[] = [];
    const fakeTransporter = {
      sendMail: async (opts: any) => {
        calls.push(opts);
        return { messageId: 'm-2' };
      },
    };
    const p = new SmtpEmailProvider({ transporter: fakeTransporter as never });
    await p.send({
      from: 'Alice <a@a.com>',
      to: 's@s.com',
      replyTo: 'a@a.com',
      subject: 'Hi',
      text: 'plain',
      html: '<p>plain</p>',
    });
    expect(calls[0].html).toBe('<p>plain</p>');
    expect(calls[0].text).toBe('plain');
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/email test`
Expected: FAIL — TS errors (cc/bcc/html not in SendEmailInput).

- [ ] **Step 3: Extend `SendEmailInput`**

Open `packages/email/src/provider.ts`. Update the interface:

```typescript
export interface SendEmailInput {
  /** Display name + address part — already concatenated, e.g. `"Alice via DealFlow <noreply@dealflow.app>"`. */
  from: string;
  /** Primary recipient email. */
  to: string;
  /** Where replies should land (typically the sending user's real email). */
  replyTo: string;
  subject: string;
  /** Plain-text body (always present — required as multipart/alternative fallback). */
  text: string;
  /** Optional HTML body. When set, the transport sends multipart/alternative. */
  html?: string;
  /** Optional CC recipients. */
  cc?: string[];
  /** Optional BCC recipients. */
  bcc?: string[];
}
```

- [ ] **Step 4: Pass through in the SMTP provider**

Open `packages/email/src/providers/smtp.ts`. Find the `sendMail` call inside the `send` method. Add `cc`, `bcc`, `html` to the options object — alongside the existing `from`, `to`, `replyTo`, `subject`, `text`. Use conditional spread so undefined fields don't show up:

```typescript
  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    const info = await this.transporter.sendMail({
      from: input.from,
      to: input.to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      ...(input.html !== undefined ? { html: input.html } : {}),
      ...(input.cc !== undefined ? { cc: input.cc } : {}),
      ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
    });
    return { messageId: String(info.messageId ?? '') };
  }
```

If the existing implementation differs in shape, keep its structure and just add the three new options.

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @dealflow/email test`
Expected: PASS — all existing + 2 new tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @dealflow/email typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/email/src/provider.ts packages/email/src/providers/smtp.ts packages/email/src/providers/smtp.test.ts
git commit -m "feat(email): SendEmailInput accepts cc/bcc/html — passes to nodemailer"
```

---

## Task 6: Env vars (`PUBLIC_API_URL` + `EMAIL_TRACKING_SECRET`)

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Read the current env.ts**

Run: `cat apps/api/src/env.ts | head -40`
Confirm there's an `envSchema` zod object. Then extend it.

- [ ] **Step 2: Add two fields**

Edit `apps/api/src/env.ts`. Inside the existing `z.object({ ... })` envSchema, add:

```typescript
  PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
  EMAIL_TRACKING_SECRET: z.string().min(32).optional(),
```

`EMAIL_TRACKING_SECRET` is optional — when absent, tracking is silently disabled (the send path skips the wrap step). This keeps test environments and fresh dev setups from breaking.

- [ ] **Step 3: Document in `.env.example`**

Append to `apps/api/.env.example`:

```
# Email tracking (outbound v1)
# Public URL where the API is reachable from the internet. Used to build
# absolute tracking pixel + click-redirect URLs that go in outgoing emails.
PUBLIC_API_URL=http://localhost:3000

# Secret for HMAC-signing tracking tokens. Must be 32+ characters.
# Generate once with: openssl rand -hex 32
# Rotating it invalidates in-flight tracking tokens (acceptable for v1).
# Leave unset to disable tracking entirely.
EMAIL_TRACKING_SECRET=
```

- [ ] **Step 4: Set a real secret in local .env (gitignored)**

Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Take the 64-char hex output and append to `apps/api/.env`:

```
PUBLIC_API_URL=http://localhost:3000
EMAIL_TRACKING_SECRET=<paste the hex here>
```

(Note: `apps/api/.env` is gitignored — your local secret never reaches the repo.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/env.ts apps/api/.env.example
git commit -m "feat(api): PUBLIC_API_URL + EMAIL_TRACKING_SECRET env vars"
```

---

## Task 7: POST `/api/v1/emails` — CC/BCC + tracking integration

**Files:**
- Modify: `apps/api/src/modules/emails/routes.ts`
- Modify: `apps/api/src/modules/activities/activities.repo.ts` (extend create to accept new optional fields)
- Modify: `apps/api/test/modules/emails/routes.test.ts`

- [ ] **Step 1: Append failing tests**

Open `apps/api/test/modules/emails/routes.test.ts`. Append a new describe block:

```typescript
describe('POST /api/v1/emails — tracking + cc/bcc', () => {
  it('persists cc/bcc and tracking_enabled when supplied', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: {
        contactId,
        subject: 'Hi',
        body: 'Hello there',
        cc: ['x@x.com'],
        bcc: ['y@y.com'],
        trackEnabled: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const activity = res.json().activity;
    expect(activity.ccEmails).toEqual(['x@x.com']);
    expect(activity.bccEmails).toEqual(['y@y.com']);
    expect(activity.trackingEnabled).toBe(true);
    expect(activity.deliveryStatus).toBe('sent');
    expect(activity.openCount).toBe(0);
    expect(activity.clickCount).toBe(0);
  });

  it('defaults trackEnabled to true when omitted', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Hi', body: 'b' },
    });
    expect(res.json().activity.trackingEnabled).toBe(true);
  });

  it('persists trackEnabled=false when caller opts out', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Hi', body: 'b', trackEnabled: false },
    });
    expect(res.json().activity.trackingEnabled).toBe(false);
  });

  it('writes an email_events sent row on success', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Hi', body: 'b' },
    });
    const activityId = res.json().activity.id;
    const events = await testDb.db
      .select()
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.activityId, activityId));
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('sent');
  });

  it('rejects cc with an invalid email', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Hi', body: 'b', cc: ['not-an-email'] },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

If the existing test file doesn't have `configureSmtp` / `createContactWithEmail` helpers, define them inline at the top of the describe (or add to a shared helper). Look at the file's existing setup pattern.

Add the missing imports at the top of the file:

```typescript
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- emails/routes`
Expected: FAIL — the route currently ignores cc/bcc/trackEnabled and never writes email_events.

- [ ] **Step 3: Extend `activities.repo.ts` create**

Open `apps/api/src/modules/activities/activities.repo.ts`. The `create()` method's `input` type needs to accept optional `ccEmails`, `bccEmails`, `trackingEnabled`, and `deliveryStatus`. Find the `.values()` call and add the new fields:

```typescript
    .values({
      // ... existing fields (orgId, ownerUserId, kind, body, contact/company/deal IDs, etc.)
      ccEmails: input.ccEmails ?? null,
      bccEmails: input.bccEmails ?? null,
      trackingEnabled: input.trackingEnabled ?? true,
      deliveryStatus: input.deliveryStatus ?? 'sent',
    })
```

Update the input type accordingly. The Drizzle inferred shape (`NewActivity`) already has these as optional after Task 1, so the type should just flow. If the repo defines its own input interface, extend that.

Also update the public projection helper (used by `publicActivity`) to include the new columns:

```typescript
  ccEmails: row.ccEmails,
  bccEmails: row.bccEmails,
  trackingEnabled: row.trackingEnabled,
  deliveryStatus: (row.deliveryStatus as 'sent' | 'failed'),
  openCount: row.openCount,
  firstOpenedAt: row.firstOpenedAt?.toISOString() ?? null,
  lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null,
  clickCount: row.clickCount,
  firstClickedAt: row.firstClickedAt?.toISOString() ?? null,
  lastClickedAt: row.lastClickedAt?.toISOString() ?? null,
```

If `publicActivity` lives in `apps/api/src/modules/emails/routes.ts` (where it currently does — review Task 8's context), update it there as well.

- [ ] **Step 4: Extend the POST `/emails` handler**

Open `apps/api/src/modules/emails/routes.ts`. Make these changes:

i. Add imports at the top:

```typescript
import { env } from '../../env.js';
import { signTrackingToken } from '../../lib/email-tracking-token.js';
import { wrapBodyAsHtml } from '../../lib/email-html-wrap.js';
```

ii. Also update `publicActivity` (in the same file, around line 27) to include the tracking columns — same lines from Step 3.

iii. Replace the POST handler with the version below. (Read the existing handler first to confirm where helpers live; this version assumes the existing helpers `loadEmailConfig`, `emailDisabled`, `emailUpstreamError`, the `activitiesRepo` instance and the `integrations` instance are already in scope from the file's outer function.)

```typescript
  app.post('/api/v1/emails', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = sendEmailBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid email payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
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

    const personalisedFrom = `${userRow.name} <${fromAddress}>`;
    const trackEnabled = parsed.data.trackEnabled ?? true;
    const trackingActive = trackEnabled && !!env.EMAIL_TRACKING_SECRET;

    // 1. Pre-create the activity row so we have an ID to embed in tracking URLs.
    const created = await activitiesRepo.create(orgId, userId, {
      kind: 'email',
      body: parsed.data.body,
      contactId: parsed.data.contactId,
      ccEmails: parsed.data.cc ?? null,
      bccEmails: parsed.data.bcc ?? null,
      trackingEnabled: trackEnabled,
      deliveryStatus: 'sent',
    });

    // 2. Build HTML body if tracking is active.
    let html: string | undefined;
    if (trackingActive) {
      const token = signTrackingToken(created.id, env.EMAIL_TRACKING_SECRET!);
      const pixelUrl = `${env.PUBLIC_API_URL}/track/open/${token}`;
      const wrapped = wrapBodyAsHtml(parsed.data.body, {
        pixelUrl,
        rewriteLink: (originalUrl) =>
          `${env.PUBLIC_API_URL}/track/click/${token}?u=${encodeURIComponent(
            Buffer.from(originalUrl, 'utf8').toString('base64url'),
          )}`,
      });
      html = wrapped.html;
    }

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
      });

      // 3. Stamp the SMTP messageId + subject on the activity.
      const [updated] = await deps.db
        .update(schema.activities)
        .set({
          subject: parsed.data.subject,
          externalId: result.messageId,
          updatedAt: new Date(),
        })
        .where(eq(schema.activities.id, created.id))
        .returning();

      // 4. Insert a 'sent' email_events row for the timeline.
      await deps.db.insert(schema.emailEvents).values({
        organizationId: orgId,
        activityId: created.id,
        eventType: 'sent',
      });

      return reply.status(201).send({ activity: publicActivity(updated ?? created) });
    } catch (err) {
      // Send failed — mark the activity row and DON'T record a sent event.
      await deps.db
        .update(schema.activities)
        .set({ deliveryStatus: 'failed', updatedAt: new Date() })
        .where(eq(schema.activities.id, created.id));
      if (err instanceof EmailDisabledError) return emailDisabled(reply);
      req.log.error({ err }, 'POST /emails failed');
      return emailUpstreamError(reply);
    }
  });
```

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- emails/routes`
Expected: PASS — all existing + 5 new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/emails/routes.ts apps/api/src/modules/activities/activities.repo.ts apps/api/test/modules/emails/routes.test.ts
git commit -m "feat(api): POST /emails wires cc/bcc/tracking + multipart HTML"
```

---

## Task 8: Public `/track/open/:token` route

**Files:**
- Create: `apps/api/src/modules/emails/tracking-routes.ts`
- Create: `apps/api/test/modules/emails/tracking-routes.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/modules/emails/tracking-routes.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql, eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import { signTrackingToken } from '../../../src/lib/email-tracking-token.js';

const SECRET = 'a'.repeat(64);

async function createEmailActivity(
  testDb: TestDatabase,
  orgId: string,
  userId: string,
  contactId: string,
  trackingEnabled = true,
): Promise<string> {
  const [row] = await testDb.db
    .insert(schema.activities)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      kind: 'email',
      body: 'Hi',
      contactId,
      trackingEnabled,
    })
    .returning();
  return row!.id;
}

describe('GET /track/open/:token', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db, env: { EMAIL_TRACKING_SECRET: SECRET } });
  }, 30_000);
  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns 200 + a tiny GIF for a valid token', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id);
    const token = signTrackingToken(activityId, SECRET);

    const res = await app.inject({ method: 'GET', url: `/track/open/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('inserts an open event row and increments counters', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id);
    const token = signTrackingToken(activityId, SECRET);

    await app.inject({ method: 'GET', url: `/track/open/${token}` });
    await app.inject({ method: 'GET', url: `/track/open/${token}` });

    const [row] = await testDb.db
      .select()
      .from(schema.activities)
      .where(eq(schema.activities.id, activityId));
    expect(row!.openCount).toBe(2);
    expect(row!.firstOpenedAt).not.toBeNull();
    expect(row!.lastOpenedAt).not.toBeNull();

    const events = await testDb.db
      .select()
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.activityId, activityId));
    expect(events.filter((e) => e.eventType === 'open')).toHaveLength(2);
  });

  it('skips event when tracking_enabled=false on the activity', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id, false);
    const token = signTrackingToken(activityId, SECRET);

    const res = await app.inject({ method: 'GET', url: `/track/open/${token}` });
    expect(res.statusCode).toBe(200);
    const [row] = await testDb.db
      .select()
      .from(schema.activities)
      .where(eq(schema.activities.id, activityId));
    expect(row!.openCount).toBe(0);
  });

  it('returns 200 + GIF for a forged token (no event written)', async () => {
    const res = await app.inject({ method: 'GET', url: '/track/open/garbage.badsig' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
    // No assertion on DB — there's no activity to query against.
  });
});
```

The `buildTestApp` helper may not currently accept an `env` override. If it doesn't, add one (read the helper first): the function should accept `{ db, env? }` and merge env overrides into a local copy. Alternatively, this test can read `EMAIL_TRACKING_SECRET` directly from a stored module export. Adjust based on what `buildTestApp` actually supports — keep tests honest about the test seam.

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- emails/tracking-routes`
Expected: FAIL (404 — route not registered).

- [ ] **Step 3: Implement the route**

Create `apps/api/src/modules/emails/tracking-routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { verifyTrackingToken } from '../../lib/email-tracking-token.js';

/** 43-byte transparent 1x1 GIF. */
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

export interface TrackingRoutesDeps {
  db: Database;
  trackingSecret: string | undefined;
}

export async function registerTrackingRoutes(
  app: FastifyInstance,
  deps: TrackingRoutesDeps,
): Promise<void> {
  app.get('/track/open/:token', async (req, reply) => {
    const { token } = req.params as { token: string };

    function returnPixel() {
      reply.header('Content-Type', 'image/gif');
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      reply.header('Pragma', 'no-cache');
      return reply.send(TRANSPARENT_GIF);
    }

    if (!deps.trackingSecret) return returnPixel();
    const v = verifyTrackingToken(token, deps.trackingSecret);
    if (!v.ok) return returnPixel();

    try {
      const [row] = await deps.db
        .select({
          id: schema.activities.id,
          orgId: schema.activities.organizationId,
          enabled: schema.activities.trackingEnabled,
        })
        .from(schema.activities)
        .where(eq(schema.activities.id, v.activityId))
        .limit(1);
      if (!row || !row.enabled) return returnPixel();

      await deps.db.transaction(async (tx) => {
        await tx.insert(schema.emailEvents).values({
          organizationId: row.orgId,
          activityId: row.id,
          eventType: 'open',
        });
        await tx
          .update(schema.activities)
          .set({
            openCount: sql`${schema.activities.openCount} + 1`,
            firstOpenedAt: sql`COALESCE(${schema.activities.firstOpenedAt}, NOW())`,
            lastOpenedAt: sql`NOW()`,
            updatedAt: new Date(),
          })
          .where(eq(schema.activities.id, row.id));
      });
    } catch (err) {
      req.log.error({ err, token }, '/track/open failed');
      // Fall through — still return the pixel so we don't break the recipient's UI.
    }
    return returnPixel();
  });
}
```

- [ ] **Step 4: Wire in `server.ts`**

Open `apps/api/src/server.ts`. Find where other routes are registered (e.g. after the email routes). Add:

```typescript
    const { registerTrackingRoutes } = await import('./modules/emails/tracking-routes.js');
    await registerTrackingRoutes(app, {
      db: opts.db,
      trackingSecret: env.EMAIL_TRACKING_SECRET,
    });
```

Import `env` at the top of `server.ts` if it isn't already:

```typescript
import { env } from './env.js';
```

The route registers at the root of the app (no `/api/v1` prefix) — that's intentional, so tracking URLs are short in plain-text inboxes.

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- emails/tracking-routes`
Expected: PASS for the 4 open tests (click tests come in Task 9).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/emails/tracking-routes.ts apps/api/test/modules/emails/tracking-routes.test.ts apps/api/src/server.ts
git commit -m "feat(api): public /track/open/:token route with HMAC verification"
```

---

## Task 9: Public `/track/click/:token` route

**Files:**
- Modify: `apps/api/src/modules/emails/tracking-routes.ts`
- Modify: `apps/api/test/modules/emails/tracking-routes.test.ts`

- [ ] **Step 1: Append failing tests**

Open `apps/api/test/modules/emails/tracking-routes.test.ts`. Append:

```typescript
describe('GET /track/click/:token', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db, env: { EMAIL_TRACKING_SECRET: SECRET } });
  }, 30_000);
  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  function encodeUrl(url: string): string {
    return Buffer.from(url, 'utf8').toString('base64url');
  }

  it('302-redirects on a valid token + valid URL', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id);
    const token = signTrackingToken(activityId, SECRET);
    const target = 'https://docs.example.com/x';

    const res = await app.inject({
      method: 'GET',
      url: `/track/click/${token}?u=${encodeUrl(target)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(target);
  });

  it('inserts a click event with the URL', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id);
    const token = signTrackingToken(activityId, SECRET);

    await app.inject({
      method: 'GET',
      url: `/track/click/${token}?u=${encodeUrl('https://a.com/path')}`,
    });

    const events = await testDb.db
      .select()
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.activityId, activityId));
    const clicks = events.filter((e) => e.eventType === 'click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.url).toBe('https://a.com/path');

    const [row] = await testDb.db
      .select()
      .from(schema.activities)
      .where(eq(schema.activities.id, activityId));
    expect(row!.clickCount).toBe(1);
  });

  it('400s on a forged token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/track/click/garbage.badsig?u=${encodeUrl('https://a.com')}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s when u is missing', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id);
    const token = signTrackingToken(activityId, SECRET);
    const res = await app.inject({ method: 'GET', url: `/track/click/${token}` });
    expect(res.statusCode).toBe(400);
  });

  it('400s on a non-http URL scheme', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id);
    const token = signTrackingToken(activityId, SECRET);
    const res = await app.inject({
      method: 'GET',
      url: `/track/click/${token}?u=${encodeUrl('javascript:alert(1)')}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('still redirects when tracking_enabled=false (no event recorded)', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id, false);
    const token = signTrackingToken(activityId, SECRET);

    const res = await app.inject({
      method: 'GET',
      url: `/track/click/${token}?u=${encodeUrl('https://a.com')}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://a.com');
    const events = await testDb.db
      .select()
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.activityId, activityId));
    expect(events.filter((e) => e.eventType === 'click')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- emails/tracking-routes`
Expected: 6 new tests fail (route not registered yet).

- [ ] **Step 3: Add the click handler**

Edit `apps/api/src/modules/emails/tracking-routes.ts`. Inside `registerTrackingRoutes`, after the `/track/open/:token` handler, add:

```typescript
  app.get('/track/click/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const { u } = req.query as { u?: string };

    if (!u) {
      return reply.status(400).send('Invalid tracking link');
    }
    // Decode the base64url-encoded URL.
    let decoded: string;
    try {
      decoded = Buffer.from(u, 'base64url').toString('utf8');
    } catch {
      return reply.status(400).send('Invalid tracking link');
    }
    // Enforce http(s) scheme — never blind-redirect (open redirect vuln).
    if (!/^https?:\/\//i.test(decoded)) {
      return reply.status(400).send('Invalid tracking link');
    }

    if (!deps.trackingSecret) {
      // No secret configured: just redirect without recording.
      return reply.redirect(302, decoded);
    }
    const v = verifyTrackingToken(token, deps.trackingSecret);
    if (!v.ok) {
      return reply.status(400).send('Invalid tracking link');
    }

    try {
      const [row] = await deps.db
        .select({
          id: schema.activities.id,
          orgId: schema.activities.organizationId,
          enabled: schema.activities.trackingEnabled,
        })
        .from(schema.activities)
        .where(eq(schema.activities.id, v.activityId))
        .limit(1);
      if (row && row.enabled) {
        await deps.db.transaction(async (tx) => {
          await tx.insert(schema.emailEvents).values({
            organizationId: row.orgId,
            activityId: row.id,
            eventType: 'click',
            url: decoded,
          });
          await tx
            .update(schema.activities)
            .set({
              clickCount: sql`${schema.activities.clickCount} + 1`,
              firstClickedAt: sql`COALESCE(${schema.activities.firstClickedAt}, NOW())`,
              lastClickedAt: sql`NOW()`,
              updatedAt: new Date(),
            })
            .where(eq(schema.activities.id, row.id));
        });
      }
    } catch (err) {
      req.log.error({ err, token }, '/track/click write failed');
      // Fall through — redirect anyway.
    }
    return reply.redirect(302, decoded);
  });
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- emails/tracking-routes`
Expected: PASS — open (4) + click (6) = 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/emails/tracking-routes.ts apps/api/test/modules/emails/tracking-routes.test.ts
git commit -m "feat(api): /track/click/:token — validates scheme, records click, 302s"
```

---

## Task 10: GET `/api/v1/activities/:id/events`

**Files:**
- Modify: `apps/api/src/modules/activities/routes.ts`
- Modify: `apps/api/test/modules/activities/activities.routes.test.ts`

- [ ] **Step 1: Append failing tests**

Open `apps/api/test/modules/activities/activities.routes.test.ts`. Append:

```typescript
describe('GET /api/v1/activities/:id/events', () => {
  it('returns events ordered by most recent first', async () => {
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
    // Insert 3 events with increasing timestamps.
    await testDb.db.insert(schema.emailEvents).values([
      { organizationId: orgId, activityId: activity!.id, eventType: 'sent' },
      { organizationId: orgId, activityId: activity!.id, eventType: 'open' },
      { organizationId: orgId, activityId: activity!.id, eventType: 'click', url: 'https://a.com' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${activity!.id}/events`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items).toHaveLength(3);
    expect(items[0].eventType).toBe('click');
    expect(items[0].url).toBe('https://a.com');
    expect(items[items.length - 1].eventType).toBe('sent');
  });

  it('404s when activity belongs to another org (tenant isolation)', async () => {
    const a = await signupTestUser(app);
    const b = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: a.orgId, firstName: 'X' })
      .returning();
    const [activity] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: a.orgId,
        ownerUserId: a.userId,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
      })
      .returning();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${activity!.id}/events`,
      headers: { cookie: b.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- activities/activities.routes`
Expected: 2 new tests fail (route doesn't exist).

- [ ] **Step 3: Add the route handler**

Open `apps/api/src/modules/activities/routes.ts`. Add `desc` to the drizzle-orm import if absent. Inside `registerActivitiesRoutes`, after the existing `GET /api/v1/activities/:id` handler, add:

```typescript
  app.get('/api/v1/activities/:id/events', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    // Tenant check: verify the activity belongs to this org. Avoid leaking
    // existence to other tenants — return 404 either way.
    const [act] = await deps.db
      .select({ id: schema.activities.id })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.organizationId, orgId),
          eq(schema.activities.id, params.data.id),
        ),
      )
      .limit(1);
    if (!act) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Activity not found' } });
    }
    const rows = await deps.db
      .select()
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.activityId, params.data.id))
      .orderBy(desc(schema.emailEvents.occurredAt));
    const items = rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      url: r.url,
      occurredAt: r.occurredAt.toISOString(),
    }));
    return reply.send({ items });
  });
```

Add `desc` and `and, eq` to the drizzle-orm imports at the top if not already present.

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- activities/activities.routes`
Expected: PASS — existing tests + 2 new.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/activities/routes.ts apps/api/test/modules/activities/activities.routes.test.ts
git commit -m "feat(api): GET /activities/:id/events (timeline endpoint, tenant-scoped)"
```

---

## Task 11: GET `/api/v1/emails` (dashboard list)

**Files:**
- Modify: `apps/api/src/modules/emails/routes.ts`
- Modify: `apps/api/test/modules/emails/routes.test.ts`

- [ ] **Step 1: Append failing tests**

Open `apps/api/test/modules/emails/routes.test.ts`. Append:

```typescript
describe('GET /api/v1/emails (dashboard list)', () => {
  it('returns sent emails for the caller org', async () => {
    const { cookie } = await signupTestUser(app);
    await configureSmtp(app, cookie);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    // Send 2 emails.
    await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'First', body: 'b' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Second', body: 'b' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?range=all',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].subject).toBeDefined();
    expect(items[0].recipientEmail).toBe('sarah@acme.com');
  });

  it('enforces tenant isolation', async () => {
    const a = await signupTestUser(app);
    const b = await signupTestUser(app);
    await configureSmtp(app, a.cookie);
    const contactId = await createContactWithEmail(app, a.cookie, 's@s.com');
    await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie: a.cookie },
      payload: { contactId, subject: 'Hi', body: 'b' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?range=all',
      headers: { cookie: b.cookie },
    });
    expect(res.json().items).toEqual([]);
  });

  it('filters by status=failed', async () => {
    // Setup: directly insert a failed activity, then a sent one.
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X', email: 's@s.com' })
      .returning();
    await testDb.db.insert(schema.activities).values([
      {
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        subject: 'Failed one',
        contactId: contact!.id,
        deliveryStatus: 'failed',
      },
      {
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        subject: 'Sent one',
        contactId: contact!.id,
        deliveryStatus: 'sent',
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?status=failed&range=all',
      headers: { cookie },
    });
    expect(res.json().items.every((i: any) => i.deliveryStatus === 'failed')).toBe(true);
  });

  it('q searches subject case-insensitively', async () => {
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X', email: 's@s.com' })
      .returning();
    await testDb.db.insert(schema.activities).values({
      organizationId: orgId,
      ownerUserId: userId,
      kind: 'email',
      body: 'b',
      subject: 'Q3 PROPOSAL plan',
      contactId: contact!.id,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?q=proposal&range=all',
      headers: { cookie },
    });
    const hits = res.json().items;
    expect(hits.some((i: any) => i.subject.toLowerCase().includes('proposal'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- emails/routes`

- [ ] **Step 3: Implement the route**

Open `apps/api/src/modules/emails/routes.ts`. Add imports if missing:

```typescript
import { and, desc, eq, ilike, gte, lt } from 'drizzle-orm';
import { emailDashboardQuerySchema } from '@dealflow/shared';
```

Inside `registerEmailRoutes`, add this handler:

```typescript
  app.get('/api/v1/emails', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = emailDashboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid filter' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const { status, range, q, cursor } = parsed.data;

    const conds = [
      eq(schema.activities.organizationId, orgId),
      eq(schema.activities.kind, 'email'),
    ];
    if (range !== 'all') {
      const ms = range === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;
      conds.push(gte(schema.activities.createdAt, new Date(Date.now() - ms)));
    }
    if (status === 'failed') {
      conds.push(eq(schema.activities.deliveryStatus, 'failed'));
    } else if (status === 'opened') {
      conds.push(sql`${schema.activities.openCount} > 0`);
    } else if (status === 'clicked') {
      conds.push(sql`${schema.activities.clickCount} > 0`);
    }
    if (q) {
      conds.push(ilike(schema.activities.subject, `%${q}%`));
    }
    if (cursor) {
      const decoded = new Date(cursor);
      if (!Number.isNaN(decoded.getTime())) {
        conds.push(lt(schema.activities.createdAt, decoded));
      }
    }

    const PAGE_SIZE = 50;
    const rows = await deps.db
      .select({
        id: schema.activities.id,
        subject: schema.activities.subject,
        sentAt: schema.activities.createdAt,
        deliveryStatus: schema.activities.deliveryStatus,
        openCount: schema.activities.openCount,
        clickCount: schema.activities.clickCount,
        contactFirstName: schema.contacts.firstName,
        contactLastName: schema.contacts.lastName,
        contactEmail: schema.contacts.email,
      })
      .from(schema.activities)
      .leftJoin(schema.contacts, eq(schema.activities.contactId, schema.contacts.id))
      .where(and(...conds))
      .orderBy(desc(schema.activities.createdAt))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const sliced = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const items = sliced.map((r) => ({
      id: r.id,
      subject: r.subject,
      recipientName: [r.contactFirstName, r.contactLastName].filter(Boolean).join(' ') || null,
      recipientEmail: r.contactEmail,
      sentAt: r.sentAt.toISOString(),
      deliveryStatus: r.deliveryStatus as 'sent' | 'failed',
      openCount: r.openCount,
      clickCount: r.clickCount,
    }));
    const nextCursor = hasMore && sliced.length > 0 ? sliced[sliced.length - 1]!.sentAt.toISOString() : null;
    return reply.send({ items, nextCursor });
  });
```

Add `sql` to the drizzle-orm imports if not present.

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- emails/routes`
Expected: PASS — all existing + 4 new tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/emails/routes.ts apps/api/test/modules/emails/routes.test.ts
git commit -m "feat(api): GET /emails dashboard (filters + cursor pagination)"
```

---

## Task 12: GET `/api/v1/emails/engagement/:entityType/:id`

**Files:**
- Modify: `apps/api/src/modules/emails/routes.ts`
- Modify: `apps/api/test/modules/emails/routes.test.ts`

- [ ] **Step 1: Append failing tests**

Open `apps/api/test/modules/emails/routes.test.ts`. Append:

```typescript
describe('GET /api/v1/emails/engagement/:entityType/:id', () => {
  it('returns a zero rollup when entity has no sent emails', async () => {
    const { cookie, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/emails/engagement/contact/${contact!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.sent).toBe(0);
    expect(r.opened).toBe(0);
    expect(r.openedPct).toBe(0);
    expect(r.clickedWith).toBe(0);
    expect(r.lastActivityAt).toBeNull();
  });

  it('computes counts and percentages correctly', async () => {
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    // 4 emails: 2 opened (1 also clicked), 2 untouched.
    await testDb.db.insert(schema.activities).values([
      { organizationId: orgId, ownerUserId: userId, kind: 'email', body: 'a', contactId: contact!.id, openCount: 2, clickCount: 1 },
      { organizationId: orgId, ownerUserId: userId, kind: 'email', body: 'b', contactId: contact!.id, openCount: 1, clickCount: 0 },
      { organizationId: orgId, ownerUserId: userId, kind: 'email', body: 'c', contactId: contact!.id, openCount: 0, clickCount: 0 },
      { organizationId: orgId, ownerUserId: userId, kind: 'email', body: 'd', contactId: contact!.id, openCount: 0, clickCount: 0 },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/emails/engagement/contact/${contact!.id}`,
      headers: { cookie },
    });
    const r = res.json();
    expect(r.sent).toBe(4);
    expect(r.opened).toBe(2);
    expect(r.openedPct).toBeCloseTo(0.5, 5);
    expect(r.clickedWith).toBe(1);
    expect(r.clickedWithPct).toBeCloseTo(0.25, 5);
  });

  it('400s on an unknown entity type', async () => {
    const { cookie, orgId } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/emails/engagement/widget/${orgId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --filter @dealflow/api test -- emails/routes`

- [ ] **Step 3: Add the handler**

Open `apps/api/src/modules/emails/routes.ts`. Add the import:

```typescript
import { emailRollupEntityTypeSchema } from '@dealflow/shared';
```

Inside `registerEmailRoutes`, add:

```typescript
  app.get(
    '/api/v1/emails/engagement/:entityType/:id',
    { preHandler: requireOrg },
    async (req, reply) => {
      const params = req.params as { entityType: string; id: string };
      const entityType = emailRollupEntityTypeSchema.safeParse(params.entityType);
      if (!entityType.success) {
        return reply.status(400).send({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Bad entity type' },
        });
      }
      // params.id is also UUID-ish; trust the join below to fail cleanly otherwise.
      const orgId = req.session!.currentOrgId!;
      const fkColumn =
        entityType.data === 'contact'
          ? schema.activities.contactId
          : entityType.data === 'company'
            ? schema.activities.companyId
            : schema.activities.dealId;

      const [agg] = await deps.db
        .select({
          sent: sql<number>`COUNT(*)::int`,
          opened: sql<number>`COUNT(*) FILTER (WHERE ${schema.activities.openCount} > 0)::int`,
          clickedWith: sql<number>`COUNT(*) FILTER (WHERE ${schema.activities.clickCount} > 0)::int`,
          lastActivityAt: sql<Date | null>`MAX(${schema.activities.createdAt})`,
        })
        .from(schema.activities)
        .where(
          and(
            eq(schema.activities.organizationId, orgId),
            eq(schema.activities.kind, 'email'),
            eq(fkColumn, params.id),
          ),
        );

      const sent = agg?.sent ?? 0;
      const opened = agg?.opened ?? 0;
      const clickedWith = agg?.clickedWith ?? 0;
      const lastActivityAt = agg?.lastActivityAt ?? null;
      return reply.send({
        sent,
        opened,
        openedPct: sent > 0 ? opened / sent : 0,
        clickedWith,
        clickedWithPct: sent > 0 ? clickedWith / sent : 0,
        lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
      });
    },
  );
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @dealflow/api test -- emails/routes`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/emails/routes.ts apps/api/test/modules/emails/routes.test.ts
git commit -m "feat(api): GET /emails/engagement/:entityType/:id rollup"
```

---

## Task 13: Frontend hooks + query keys

**Files:**
- Modify: `apps/web/src/lib/query-keys.ts`
- Modify: `apps/web/src/features/emails/api.ts`

- [ ] **Step 1: Add query keys**

Edit `apps/web/src/lib/query-keys.ts`. Inside the `activities` block, add a `events` entry. Add a new `emails` block (replacing the existing one if it has only a `status` key — preserve `status` and add the new keys):

```typescript
  activities: {
    forContact: (id: string) => ['activities', 'contact', id] as const,
    forCompany: (id: string) => ['activities', 'company', id] as const,
    forDeal: (id: string) => ['activities', 'deal', id] as const,
    detail: (id: string) => ['activities', 'detail', id] as const,
    events: (id: string) => ['activities', 'detail', id, 'events'] as const,
  },
  emails: {
    // preserve any existing keys (status, etc.)
    list: (params: { status?: string; range?: string; q?: string; cursor?: string | null }) =>
      ['emails', 'list', params] as const,
    engagement: (entityType: string, id: string) =>
      ['emails', 'engagement', entityType, id] as const,
  },
```

If `emails.status` already exists, keep it — just add `list` and `engagement` siblings.

- [ ] **Step 2: Add hooks**

Open `apps/web/src/features/emails/api.ts`. Add at the bottom:

```typescript
import type {
  EmailDashboardResponse,
  EmailEngagementRollup,
  PublicEmailEvent,
} from '@dealflow/shared';

interface EmailEventsResponse {
  items: PublicEmailEvent[];
}

export function useEmailEvents(activityId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.activities.events(activityId ?? ''),
    queryFn: () =>
      apiFetch<EmailEventsResponse>(`/api/v1/activities/${activityId}/events`),
    enabled: !!activityId,
  });
}

export function useEmailsList(params: { status?: string; range?: string; q?: string; cursor?: string | null }) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.range) qs.set('range', params.range);
  if (params.q) qs.set('q', params.q);
  if (params.cursor) qs.set('cursor', params.cursor);
  return useQuery({
    queryKey: queryKeys.emails.list(params),
    queryFn: () => apiFetch<EmailDashboardResponse>(`/api/v1/emails?${qs}`),
  });
}

export function useEmailEngagement(entityType: 'contact' | 'company' | 'deal', id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.emails.engagement(entityType, id ?? ''),
    queryFn: () =>
      apiFetch<EmailEngagementRollup>(`/api/v1/emails/engagement/${entityType}/${id}`),
    enabled: !!id,
  });
}
```

Also, if `useSendEmail` (or however the existing send hook is named) has a typed body, update it to accept the new optional `cc`, `bcc`, `trackEnabled` fields. The shared `SendEmailInput` type now includes them, so re-importing from `@dealflow/shared` may already pull the right shape in.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/query-keys.ts apps/web/src/features/emails/api.ts
git commit -m "feat(web): query keys + hooks for email events / dashboard / engagement"
```

---

## Task 14: Compose dialog — CC/BCC reveal + tracking toggle

**Files:**
- Modify: `apps/web/src/features/emails/compose-email-dialog.tsx`

- [ ] **Step 1: Read the file**

Run: `cat apps/web/src/features/emails/compose-email-dialog.tsx`

Locate the existing form state (likely `useState` for subject + body) and the submit handler.

- [ ] **Step 2: Add three new state fields**

Add near the existing state declarations:

```typescript
const [cc, setCc] = useState('');
const [bcc, setBcc] = useState('');
const [showCcBcc, setShowCcBcc] = useState(false);
const [trackEnabled, setTrackEnabled] = useState(true);
```

- [ ] **Step 3: Add a CC/BCC reveal link + inputs**

Inside the form JSX, locate the To row. Append the reveal link to that row:

```tsx
{!showCcBcc && (
  <button
    type="button"
    onClick={() => setShowCcBcc(true)}
    className="ml-2 text-xs text-blue-600 hover:underline"
  >
    + Cc · Bcc
  </button>
)}
```

When `showCcBcc` is true, render the two extra inputs immediately after the To row (before the Subject row):

```tsx
{showCcBcc && (
  <>
    <div className="mb-2">
      <Label htmlFor="cc" className="text-xs">Cc</Label>
      <Input
        id="cc"
        value={cc}
        onChange={(e) => setCc(e.target.value)}
        placeholder="comma-separated emails"
      />
    </div>
    <div className="mb-2">
      <Label htmlFor="bcc" className="text-xs">Bcc</Label>
      <Input
        id="bcc"
        value={bcc}
        onChange={(e) => setBcc(e.target.value)}
        placeholder="comma-separated emails"
      />
    </div>
  </>
)}
```

- [ ] **Step 4: Add the tracking toggle**

Below the body textarea, before the submit button row:

```tsx
<label className="mt-2 flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={trackEnabled}
    onChange={(e) => setTrackEnabled(e.target.checked)}
  />
  Track opens and clicks
</label>
```

- [ ] **Step 5: Update the submit handler**

Inside the existing submit handler, parse cc/bcc by splitting on commas + trimming + filtering empties + light email-format validation. Then include them in the POST payload:

```typescript
function parseEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@.,]{2,}$/.test(s));
}

// In the submit handler, replace the existing payload-build with:
const ccList = parseEmails(cc);
const bccList = parseEmails(bcc);
await sendEmail.mutateAsync({
  contactId,
  subject,
  body,
  ...(ccList.length > 0 ? { cc: ccList } : {}),
  ...(bccList.length > 0 ? { bcc: bccList } : {}),
  trackEnabled,
});
```

If `sendEmail` is exposed as `useSendEmail()`, its mutationFn's input type was already extended in Task 13's type chain (via `@dealflow/shared`). If the local mutationFn signature is narrower, widen it to accept the new fields.

After successful submit, reset the new fields too:

```typescript
setCc('');
setBcc('');
setShowCcBcc(false);
setTrackEnabled(true);
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/emails/compose-email-dialog.tsx
git commit -m "feat(web): compose dialog — CC/BCC reveal + tracking toggle"
```

---

## Task 15: Tracking badge on activity feed rows

**Files:**
- Create: `apps/web/src/features/emails/email-tracking-badge.tsx`
- Modify: `apps/web/src/features/activities/activity-feed.tsx`

- [ ] **Step 1: Build the badge component**

Create `apps/web/src/features/emails/email-tracking-badge.tsx`:

```tsx
import type { PublicActivity } from '@dealflow/shared';

interface Props {
  activity: PublicActivity;
}

/** Renders a tracking summary for an email activity. Returns null for non-emails or untracked sends. */
export function EmailTrackingBadge({ activity }: Props) {
  if (activity.kind !== 'email') return null;
  if (activity.deliveryStatus === 'failed') {
    return (
      <div className="mt-1 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
          ⚠ Send failed
        </span>
      </div>
    );
  }
  if (!activity.trackingEnabled) return null;

  const opened = activity.openCount > 0;
  const clicked = activity.clickCount > 0;

  if (!opened && !clicked) {
    return (
      <div className="mt-1 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
          📤 Sent · awaiting open
        </span>
      </div>
    );
  }

  const lastAt =
    activity.lastClickedAt && activity.lastOpenedAt
      ? activity.lastClickedAt > activity.lastOpenedAt
        ? activity.lastClickedAt
        : activity.lastOpenedAt
      : (activity.lastClickedAt ?? activity.lastOpenedAt);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {opened && (
        <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800">
          👁 Opened {activity.openCount}×
        </span>
      )}
      {clicked && (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800">
          🖱 Clicked {activity.clickCount}×
        </span>
      )}
      {lastAt && (
        <span className="text-[11px] text-neutral-400">· last {timeAgo(lastAt)}</span>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
```

- [ ] **Step 2: Embed in the activity feed**

Open `apps/web/src/features/activities/activity-feed.tsx`. Add the import:

```typescript
import { EmailTrackingBadge } from '@/features/emails/email-tracking-badge';
```

Find the row renderer for activities. Locate where the body/subject preview is displayed (the existing layout). Add the badge just after the subject and just before the body preview:

```tsx
<EmailTrackingBadge activity={activity} />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/emails/email-tracking-badge.tsx apps/web/src/features/activities/activity-feed.tsx
git commit -m "feat(web): email tracking badge on activity feed rows"
```

---

## Task 16: Engagement timeline on activity detail page

**Files:**
- Create: `apps/web/src/features/emails/email-engagement-timeline.tsx`
- Modify: `apps/web/src/routes/app.activities.$id.tsx`

- [ ] **Step 1: Build the timeline component**

Create `apps/web/src/features/emails/email-engagement-timeline.tsx`:

```tsx
import type { PublicActivity } from '@dealflow/shared';
import { useEmailEvents } from './api';

interface Props {
  activity: PublicActivity;
}

export function EmailEngagementTimeline({ activity }: Props) {
  const q = useEmailEvents(activity.id);

  if (activity.kind !== 'email') return null;
  if (activity.deliveryStatus === 'failed') {
    return (
      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-400">Engagement</h2>
        <p className="mt-2 text-sm text-red-600">⚠ This email failed to send. No engagement events recorded.</p>
      </section>
    );
  }
  if (!activity.trackingEnabled) {
    return (
      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-400">Engagement</h2>
        <p className="mt-2 text-sm text-neutral-500">Tracking was disabled for this send.</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-neutral-400">Engagement</h2>
      <div className="mt-2 flex gap-4 text-sm">
        <div>👁 <strong>{activity.openCount}</strong> opens</div>
        <div>🖱 <strong>{activity.clickCount}</strong> clicks</div>
      </div>
      {q.isPending && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}
      {q.data && q.data.items.length === 0 && (
        <p className="mt-3 text-sm text-neutral-400">No engagement yet.</p>
      )}
      {q.data && q.data.items.length > 0 && (
        <ol className="mt-3 space-y-2 border-l border-neutral-200 pl-4">
          {q.data.items.map((e) => (
            <li key={e.id} className="relative -ml-[7px] flex items-start gap-3 text-sm">
              <span
                className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white ring-1 ring-neutral-300 ${
                  e.eventType === 'open'
                    ? 'bg-green-500'
                    : e.eventType === 'click'
                      ? 'bg-blue-500'
                      : 'bg-neutral-400'
                }`}
              />
              <div>
                <div>
                  {e.eventType === 'click' ? (
                    <>Clicked → <span className="text-neutral-600">{e.url ?? ''}</span></>
                  ) : e.eventType === 'open' ? (
                    'Opened'
                  ) : (
                    'Sent'
                  )}
                </div>
                <div className="text-xs text-neutral-400">{new Date(e.occurredAt).toLocaleString()}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-neutral-400">
        Note: some opens may be auto-fetches by privacy-protecting email clients (Apple Mail Privacy, corporate scanners).
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Embed in the activity detail page**

Open `apps/web/src/routes/app.activities.$id.tsx`. Add the import:

```typescript
import { EmailEngagementTimeline } from '@/features/emails/email-engagement-timeline';
```

Inside the page component, after the existing body preview block and before the CustomFieldsBlock section, add:

```tsx
{a.kind === 'email' && <EmailEngagementTimeline activity={a} />}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/emails/email-engagement-timeline.tsx apps/web/src/routes/app.activities.\$id.tsx
git commit -m "feat(web): engagement timeline on activity detail page"
```

---

## Task 17: Engagement rollup card on contact / company / deal detail pages

**Files:**
- Create: `apps/web/src/features/emails/email-engagement-rollup.tsx`
- Modify: `apps/web/src/routes/app.contacts.$id.tsx`
- Modify: `apps/web/src/routes/app.companies.$id.tsx`
- Modify: `apps/web/src/routes/app.deals.$id.tsx`

- [ ] **Step 1: Build the rollup component**

Create `apps/web/src/features/emails/email-engagement-rollup.tsx`:

```tsx
import { useEmailEngagement } from './api';

interface Props {
  entityType: 'contact' | 'company' | 'deal';
  entityId: string;
}

export function EmailEngagementRollup({ entityType, entityId }: Props) {
  const q = useEmailEngagement(entityType, entityId);
  if (!q.data || q.data.sent === 0) return null;
  const r = q.data;
  return (
    <section className="mt-4 rounded-md border border-neutral-200 bg-white p-3 text-sm">
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Email engagement</div>
      <div className="flex flex-wrap gap-4">
        <div>📤 <strong>{r.sent}</strong> sent</div>
        <div>👁 <strong>{r.opened}</strong> opened <span className="text-neutral-400">({Math.round(r.openedPct * 100)}%)</span></div>
        <div>🖱 <strong>{r.clickedWith}</strong> with clicks <span className="text-neutral-400">({Math.round(r.clickedWithPct * 100)}%)</span></div>
        {r.lastActivityAt && (
          <div className="ml-auto text-neutral-400">Last activity: {new Date(r.lastActivityAt).toLocaleString()}</div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Embed on contact detail page**

Open `apps/web/src/routes/app.contacts.$id.tsx`. Add import:

```typescript
import { EmailEngagementRollup } from '@/features/emails/email-engagement-rollup';
```

After the existing built-in fields `<dl>` block and before the `<CustomFieldsBlock>` section:

```tsx
<EmailEngagementRollup entityType="contact" entityId={c.id} />
```

- [ ] **Step 3: Embed on company detail page**

Open `apps/web/src/routes/app.companies.$id.tsx`. Same import + same placement, `entityType="company"`, `entityId={c.id}` (or whatever the variable is in the file).

- [ ] **Step 4: Embed on deal detail page**

Open `apps/web/src/routes/app.deals.$id.tsx`. Same import + same placement, `entityType="deal"`, `entityId={d.id}`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/emails/email-engagement-rollup.tsx apps/web/src/routes/app.contacts.\$id.tsx apps/web/src/routes/app.companies.\$id.tsx apps/web/src/routes/app.deals.\$id.tsx
git commit -m "feat(web): email engagement rollup card on contact/company/deal detail"
```

---

## Task 18: `/app/emails` dashboard route + sidebar link

**Files:**
- Create: `apps/web/src/routes/app.emails.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx` (or wherever the sidebar nav lives — check the file structure)

- [ ] **Step 1: Build the dashboard page**

Create `apps/web/src/routes/app.emails.tsx`:

```tsx
import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEmailsList } from '@/features/emails/api';

export const Route = createFileRoute('/app/emails')({
  component: EmailsDashboardPage,
});

function EmailsDashboardPage() {
  const [status, setStatus] = useState<'all' | 'opened' | 'clicked' | 'failed'>('all');
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('7d');
  const [q, setQ] = useState('');
  const list = useEmailsList({ status, range, q: q || undefined });

  return (
    <main className="p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Emails</h1>
        <p className="text-sm text-neutral-500">Track sent emails, opens, and clicks across your org.</p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
        >
          <option value="all">All</option>
          <option value="opened">Opened</option>
          <option value="clicked">Clicked</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as typeof range)}
          className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Search subject…"
          className="h-9 flex-1 max-w-xs rounded-md border border-neutral-200 bg-white px-3 text-sm"
        />
      </div>

      {list.isPending && <p className="text-sm text-neutral-500">Loading…</p>}
      {list.data && list.data.items.length === 0 && (
        <p className="text-sm text-neutral-400">No sent emails match your filters.</p>
      )}
      {list.data && list.data.items.length > 0 && (
        <table className="w-full overflow-hidden rounded-md border border-neutral-200 bg-white text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Sent</th>
              <th className="px-3 py-2 text-left">Recipient</th>
              <th className="px-3 py-2 text-left">Subject</th>
              <th className="px-3 py-2 text-left">Engagement</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((e) => (
              <tr key={e.id} className="border-t border-neutral-100">
                <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                  {new Date(e.sentAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  {e.recipientName ?? e.recipientEmail ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <Link
                    to="/app/activities/$id"
                    params={{ id: e.id }}
                    className="hover:underline"
                  >
                    {e.subject ?? '(no subject)'}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {e.deliveryStatus === 'failed' && <span className="text-red-700">⚠ failed</span>}
                  {e.deliveryStatus === 'sent' && e.openCount === 0 && e.clickCount === 0 && (
                    <span className="text-neutral-400">📤 sent</span>
                  )}
                  {e.openCount > 0 && (
                    <span className="mr-2 text-green-700">👁 {e.openCount}</span>
                  )}
                  {e.clickCount > 0 && (
                    <span className="text-blue-700">🖱 {e.clickCount}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Add sidebar link**

Find the sidebar (run `grep -r "Tasks" apps/web/src/components | head -5` to locate it). The Tasks link will be the easiest landmark — add a new Emails link right after it:

```tsx
<Link to="/app/emails" className="…existing classnames…">
  Emails
</Link>
```

Match the existing pattern in the file exactly.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dealflow/web typecheck`
Expected: clean (with `routeTree.gen.ts` regenerated to include the new route).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/app.emails.tsx apps/web/src/components/ apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /app/emails dashboard route + sidebar link"
```

---

## Task 19: Cross-package validation + tag

**Files:** none new.

- [ ] **Step 1: Full test matrix**

Run: `pnpm -r test`
Expected: all green. Known pre-existing `tasks.routes.test.ts` flake may surface — re-run once; otherwise log and move on.

- [ ] **Step 2: Typecheck + lint + format**

```bash
pnpm -r typecheck
pnpm lint
pnpm format:check || pnpm format
```

Expected: typecheck/lint clean. If `pnpm format` makes changes, they should be cosmetic only — review the diff.

- [ ] **Step 3: Stage formatter changes if any + commit**

```bash
git add -A
git diff --cached --stat
git commit -m "chore: lint + format after email tracking" || echo "nothing to commit"
```

- [ ] **Step 4: Manual smoke test**

Generate an `EMAIL_TRACKING_SECRET` if you don't have one yet:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste it into `apps/api/.env`. Also ensure `PUBLIC_API_URL=http://localhost:3000` is set.

Start the stack (`pnpm dev`). Sign up a fresh user. Then:

1. Settings → AI/SMTP — configure SMTP (Gmail App Password works).
2. Create a contact with a real email address you control.
3. Open the contact, click ✉️ Email. Compose dialog opens. Add a CC (another address you control), keep "Track opens and clicks" checked.
4. In the body, paste a real URL like `https://example.com/test`. Send.
5. Open your inbox (the contact's email). Confirm the email arrived. Open it — wait a few seconds.
6. Back in DealFlow, go to the contact detail page. Confirm the activity feed shows the badge: `👁 Opened 1×`.
7. Click the link in the email. Confirm it redirects to example.com.
8. Back in DealFlow, refresh. Badge now shows `👁 Opened 1× · 🖱 Clicked 1×`.
9. Click the "Open ↗" link on the row → lands on `/app/activities/$id`. Confirm the Engagement timeline shows both events.
10. Sidebar → Emails. Confirm the dashboard lists the sent email.
11. Compose another email, this time uncheck "Track opens and clicks". Send. Confirm the email arrives, but in DealFlow the feed row shows no badge (silent — confirms opt-out works).

- [ ] **Step 5: Tag + push**

```bash
git tag -a v0.1-email-tracking -m "Email Tracking v1 sub-plan complete"
git push origin main
git push origin v0.1-email-tracking
```

---

## Deferred to follow-up sub-plans (called out explicitly)

- **Reply detection** — separate sub-plan. Requires building an inbound email pipeline (IMAP polling, dedicated MX, or webhook from a service like Postmark Inbound). Architecturally independent — share no code with this sub-plan.
- **Attachments / inline images** — separate sub-plan. Needs decisions on storage backend (local filesystem vs S3), upload protocol (multipart vs base64), size limits, MIME validation, and a frontend file picker. The compose dialog will gain attach UI; this sub-plan deliberately doesn't add it.
- **True bounce detection** — also needs inbound parsing. `delivery_status` here only reflects what SMTP told us synchronously.
- **HTML rich-text editor** in compose — out of scope. The textarea + auto-wrap is intentionally simple.
- **Drag-to-reorder custom fields** — already deferred from the prior sub-plan; not part of this one.

## Implementer notes

- **The HMAC secret is sensitive.** Treat `EMAIL_TRACKING_SECRET` like `INTEGRATION_ENCRYPTION_KEY` — never commit, never log. The `.env` file is already gitignored.
- **Drizzle-kit generate is broken in this repo** (snapshot collision since Custom Fields). Task 1 hand-writes the SQL. If a future task adds more migrations, follow the same pattern: hand-write the SQL file and the `_journal.json` entry.
- **The Custom Fields plan's response-wrapper note still applies**: contacts/companies/deals routes wrap responses as `{ contact|company|deal: ... }`. Activities responses are `{ activity: ... }`. Adjust JSON navigation accordingly.
- **`activities.routes.test.ts` has been intermittently flaky.** One re-run is acceptable. Don't dig into the flake unless this sub-plan's tests are the ones failing.
- **Public tracking endpoints must be unauthenticated.** Don't add `requireOrg` to `/track/open/:token` or `/track/click/:token` — recipient mail clients can't carry session cookies.
- **Token decoding uses `base64url`.** Buffer.toString('base64url') is supported in Node 16+. The format intentionally avoids `+`, `/`, `=` so tokens are URL-safe without further encoding.
- **The merge of `kind === 'email'` checks** — every UI component that renders engagement data gates on `activity.kind === 'email'`. Don't render badges/timeline/rollup on `note` or `task` activities.
