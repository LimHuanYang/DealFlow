# EngineMailer Email Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DealFlow's per-org SMTP sending with EngineMailer's REST API, and replace the self-hosted tracking pixel + ngrok with EngineMailer's native open/click webhooks; gate "send from your own domain" behind a per-org `plan` flag.

**Architecture:** A new `EngineMailerEmailProvider` implements the existing `EmailProvider` interface (so send sites are untouched). Per-org credentials live in the existing AES-256-GCM `org_integrations` store. A single public webhook route ingests EngineMailer events and updates the activity's existing tracking counters. Custom sending domain is a Pro feature behind `organizations.plan`.

**Tech Stack:** Node 20 + Fastify 5 + Drizzle + postgres-js (Supabase); React 19 + TanStack Query/Router + Tailwind v4 + shadcn/Radix; Vitest; Zod (`@dealflow/shared`).

**Spec:** `docs/superpowers/specs/2026-06-09-enginemailer-email-design.md`
**Mockups:** `2026-06-09-enginemailer-mockup.html`, `…-sender-identity-mockup.html`, `…-email-paywall-mockup.html`

---

## ✅ REVISION 2026-06-09 (post Task-0 spike) — THIS OVERRIDES the task bodies below where they conflict

Task 0 is **complete** — confirmed contract in `docs/superpowers/research/2026-06-09-enginemailer-api-findings.md`. Decisions:

- **Scope cut:** sending requires the user's own **verified domain** (no shared DealFlow domain) and there is **no Reply-To**. So we adopt the **single verified-domain model** and **shelve the Pro paywall**. → **CUT Task 7** (org plan endpoint) and **CUT Task 12** (custom-domain UI). Keep the cheap `organizations.plan` column in Task 1 (future-proof; nothing reads it yet).
- **Sender config** is `{ apiKey, fromName, fromEmail }` only (no `replyTo`, no `sendingMode`, no custom domain). `fromEmail`'s domain must be verified in EngineMailer.
- **Task 3 adapter — confirmed contract:** `POST https://api.enginemailer.com/RESTAPI/V2/Submission/SendEmail`; header **`APIKey: <key>`**; JSON body `{ ToEmail, SenderEmail, SenderName, Subject, SubmittedContent, CCEmails?, BCCEmails?, Attachments? }` (HTML goes in `SubmittedContent`; **drop `replyTo`/`activityId`/`CustomRef`** — unsupported). Success = `res.json().Result.StatusCode === '200'`; return `{ messageId: res.json().Result.TransactionID }`; throw on non-200 or missing Result.
- **Task 8 webhook — confirmed contract:** verify a **`?key=` query param** equals `ENGINE_MAILER_WEBHOOK_SECRET` via `crypto.timingSafeEqual` (EngineMailer has **no HMAC** — the secret rides in the URL). Event values are lowercase **`opened` / `clicked` / `delivered` / `bounce` / `spam-complaint`** (+ `unsubscribed`). Match by **`payload.details.txid`** → `activities.external_id`. Mapper keys off `details` not a CustomRef.
- **Task 9:** store `Result.TransactionID` as `activities.external_id` on send (the webhook linkage). `SendEmailInput.activityId` is NOT needed → skip that part of Task 3.
- **Task 11 UI:** Email card = API key + **Sender email** (on a verified domain) + Sender name + Save + Send test. No Reply-To / managed-domain fields. Add a short "tracking setup" note: in EngineMailer → Domains › your domain › Webhooks, paste `${PUBLIC_API_URL}/api/v1/webhooks/engine-mailer?key=<secret>` under **Open** and **Click** (and Bounce/Spam) and enable each.
- **Env:** `ENGINE_MAILER_WEBHOOK_SECRET` is the URL key (not an HMAC secret). `PUBLIC_EMAIL_DOMAIN` is no longer needed (drop it). `ENGINE_MAILER_API_KEY` already in `.env`.
- **Reply-To limitation:** accepted — replies go to the verified-domain mailbox the mail is sent from.

**Net task list:** 0 ✅, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 13. (7 and 12 cut.)

---

## File Structure (decomposition)

**Create**
- `packages/email/src/providers/engine-mailer.ts` — `EngineMailerEmailProvider implements EmailProvider`
- `packages/email/src/providers/engine-mailer.test.ts`
- `apps/api/src/modules/emails/engine-mailer-webhook.ts` — inbound webhook route + signature verify
- `apps/api/src/modules/emails/webhook-event-mapper.ts` — pure event→activity-update mapper
- `apps/api/src/modules/emails/webhook-event-mapper.test.ts`
- `apps/api/test/modules/emails/engine-mailer-webhook.test.ts`
- `packages/db/migrations/0013_org_plan_and_email.sql` (+ journal entry)
- `apps/web/src/features/integrations/email-integration-section.tsx` — free Email card
- `apps/web/src/features/integrations/custom-domain-section.tsx` — Pro upsell + domain verify
- `docs/superpowers/research/2026-06-09-enginemailer-api-findings.md` — Task 0 spike output

**Modify**
- `packages/email/src/factory.ts` — `EmailConfig.engineMailer`, `buildEmailProvider`, `describeEmail`, `isEmailEnabled`; drop SMTP
- `packages/email/src/index.ts` — export EngineMailer provider, drop SMTP
- `packages/shared/src/team.ts` (or new `email.ts`) — `engineMailerConfigSchema`, `orgPlanSchema`, DTOs
- `packages/shared/src/error.ts` — new ERROR_CODES
- `apps/api/src/modules/integrations/repo.ts` — `engineMailer` block replaces `smtp`
- `apps/api/src/modules/integrations/routes.ts` — config/test/custom-domain routes
- `apps/api/src/modules/orgs/routes.ts` (or members/orgs) — accept `plan` on org update
- `apps/api/src/lib/email.ts` — stamp `externalId`, stop pixel wrapping
- `apps/api/src/lib/email-html-wrap.ts` — remove pixel/redirect injection
- `apps/api/src/server.ts` — register webhook route; deregister `/track/*`
- `apps/api/src/env.ts` + `apps/api/.env.example` — `PUBLIC_EMAIL_DOMAIN`, `ENGINE_MAILER_WEBHOOK_SECRET`
- `apps/web/src/features/integrations/api.ts` — hooks
- `apps/web/src/routes/app.settings.*` — mount the two new sections

**Delete**
- `apps/api/src/modules/emails/tracking-routes.ts` + its registration
- `apps/api/src/lib/email-tracking-token.ts` + test
- `packages/email/src/providers/smtp.ts` + `smtp.test.ts`
- `apps/web/src/features/integrations/smtp-integration-section.tsx`

---

## Task 0: Spike — confirm EngineMailer API contract

**Files:**
- Create: `docs/superpowers/research/2026-06-09-enginemailer-api-findings.md`

This is a research task, not TDD. The findings set the constants used in Task 3 and Task 8.

- [ ] **Step 1: Gather the contract from EngineMailer's real docs/dashboard.** Using the EngineMailer account + dashboard (and https://enginemailer.zendesk.com docs), record the EXACT values for each item below. Make ONE real test send + trigger ONE open to capture a live webhook payload.

- [ ] **Step 2: Write findings doc** with these required fields (fill every one with the real value, or `UNAVAILABLE` + consequence):

```markdown
# EngineMailer API findings (2026-06-09)

## Send (transactional)
- Endpoint URL + method:            e.g. POST https://api.enginemailer.com/v2/Send
- Auth:                             e.g. header `Authorization: Bearer <key>` OR body field
- Request body field names:         to / from / fromName / replyTo / subject / html / text / cc / bcc / attachments / customRef
- Custom-ref/tag field that round-trips to the webhook:  <name or UNAVAILABLE>
- Response field holding the message id:                 e.g. MessageID

## Webhook
- Event type field + values:        e.g. "Event": "Open" | "Click" | "Delivered" | "Bounce" | "Spam"
- Click event includes clicked URL? field name:          <name or UNAVAILABLE>
- Field that echoes our customRef OR the message id:      <name>
- Signature/verification mechanism:  e.g. header `X-EngineMailer-Signature` = HMAC-SHA256(body, secret)  OR  shared key in URL query
- Sample captured payloads (open + click): <paste JSON>

## Custom domain (Option B)
- Can ONE account hold multiple verified sending domains?  yes/no
- API to add a domain + read DKIM/SPF records + check status?  endpoints or UNAVAILABLE
- If UNAVAILABLE: Option B degrades to manual setup (show static records + instructions)

## SMTP relay available? (informational)  yes/no
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/research/2026-06-09-enginemailer-api-findings.md
git commit -m "docs: EngineMailer API contract findings (spike)"
```

> Tasks 3 & 8 below are written against a **default assumed contract** (clearly marked). If Step 2 finds different values, change only the constants block at the top of `engine-mailer.ts` / the field names in `webhook-event-mapper.ts` — the structure stays the same.

---

## Task 1: `organizations.plan` column (+ `activities.externalId` if missing)

**Files:**
- Create: `packages/db/migrations/0013_org_plan_and_email.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (append entry, following 0011/0012 precedent)
- Modify: `packages/db/src/schema/organizations.ts` (add `plan` column); `packages/db/src/schema/activities.ts` (ensure `externalId`)

- [ ] **Step 1: Confirm current columns.** Open `packages/db/src/schema/organizations.ts` and `activities.ts`. Note whether `activities.externalId` already exists (used to store the provider message id). If it exists, the migration only adds `organizations.plan`.

- [ ] **Step 2: Write the migration SQL** (`0013_org_plan_and_email.sql`):

```sql
ALTER TABLE "public"."organizations"
  ADD COLUMN IF NOT EXISTS "plan" text NOT NULL DEFAULT 'free';

ALTER TABLE "public"."organizations"
  DROP CONSTRAINT IF EXISTS "organizations_plan_check";
ALTER TABLE "public"."organizations"
  ADD CONSTRAINT "organizations_plan_check" CHECK ("plan" IN ('free','pro'));

-- Only if activities.external_id does NOT already exist:
ALTER TABLE "public"."activities"
  ADD COLUMN IF NOT EXISTS "external_id" text;
```

- [ ] **Step 3: Append the journal entry** in `meta/_journal.json` (copy the shape of the 0012 entry: bump `idx`, set `tag` to `0013_org_plan_and_email`, set `when` to a fixed integer timestamp — reuse the previous entry's pattern; the repo journals by hand because `drizzle-kit generate` is broken here).

- [ ] **Step 4: Add the Drizzle column(s)** in `organizations.ts`:

```typescript
plan: text('plan').notNull().default('free'),
```
And in `activities.ts` (only if missing): `externalId: text('external_id'),`

- [ ] **Step 5: Apply + verify against Supabase.**

Run: `lean-ctx -c pnpm --filter @dealflow/db migrate`
Expected: applies `0013` with no error; re-running is a no-op (idempotent `IF NOT EXISTS`).
Then verify: a quick query shows `organizations.plan` defaults to `'free'`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0013_org_plan_and_email.sql packages/db/migrations/meta/_journal.json packages/db/src/schema/organizations.ts packages/db/src/schema/activities.ts
git commit -m "feat(db): add organizations.plan + activities.external_id"
```

---

## Task 2: Shared schemas, types & error codes

**Files:**
- Modify: `packages/shared/src/error.ts`
- Create: `packages/shared/src/email-integration.ts`
- Modify: `packages/shared/src/index.ts` (export the new module)
- Test: `packages/shared/src/email-integration.test.ts`

- [ ] **Step 1: Write failing test** (`email-integration.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { engineMailerConfigSchema, orgPlanSchema } from './email-integration.js';

describe('engineMailerConfigSchema', () => {
  it('accepts a full shared-mode config', () => {
    const r = engineMailerConfigSchema.parse({
      apiKey: 'k', fromName: 'Acme', replyTo: 'a@acme.com', sendingMode: 'shared',
    });
    expect(r.sendingMode).toBe('shared');
  });
  it('requires fromEmail when sendingMode is custom', () => {
    const r = engineMailerConfigSchema.safeParse({
      fromName: 'Acme', replyTo: 'a@acme.com', sendingMode: 'custom',
    });
    expect(r.success).toBe(false);
  });
  it('allows omitting apiKey on update (unchanged-when-blank)', () => {
    const r = engineMailerConfigSchema.safeParse({
      fromName: 'Acme', replyTo: 'a@acme.com', sendingMode: 'shared',
    });
    expect(r.success).toBe(true);
  });
});

describe('orgPlanSchema', () => {
  it('accepts free and pro, rejects others', () => {
    expect(orgPlanSchema.parse('free')).toBe('free');
    expect(orgPlanSchema.parse('pro')).toBe('pro');
    expect(orgPlanSchema.safeParse('enterprise').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/shared test email-integration`
Expected: FAIL — cannot find module `./email-integration.js`.

- [ ] **Step 3: Implement** (`email-integration.ts`):

```typescript
import { z } from 'zod';

export const orgPlanSchema = z.enum(['free', 'pro']);
export type OrgPlan = z.infer<typeof orgPlanSchema>;

export const engineMailerConfigSchema = z
  .object({
    apiKey: z.string().min(1).optional(), // optional on update: blank = keep existing
    fromName: z.string().min(1).max(120),
    replyTo: z.string().email(),
    sendingMode: z.enum(['shared', 'custom']),
    fromEmail: z.string().email().optional(),
  })
  .refine((v) => v.sendingMode !== 'custom' || !!v.fromEmail, {
    message: 'fromEmail is required when sendingMode is "custom"',
    path: ['fromEmail'],
  });
export type EngineMailerConfigInput = z.infer<typeof engineMailerConfigSchema>;

export interface PublicEmailIntegration {
  connected: boolean;
  fromName: string | null;
  replyTo: string | null;
  sendingMode: 'shared' | 'custom';
  fromEmail: string | null;
  domainVerified: boolean;
  keyHint: string | null; // e.g. "••••7Q4a"
}

export interface DnsRecord { type: 'TXT' | 'CNAME'; host: string; value: string; }
export interface CustomDomainStatus {
  domain: string | null;
  records: DnsRecord[];
  status: 'unset' | 'pending' | 'verified';
}
```

- [ ] **Step 4: Add error codes** in `error.ts` (append to the existing `ERROR_CODES` object/union, matching the file's current style):

```typescript
EMAIL_NOT_CONFIGURED: 'EMAIL_NOT_CONFIGURED',
PLAN_UPGRADE_REQUIRED: 'PLAN_UPGRADE_REQUIRED',
DOMAIN_NOT_VERIFIED: 'DOMAIN_NOT_VERIFIED',
WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
```

- [ ] **Step 5: Export** the new module from `packages/shared/src/index.ts`:

```typescript
export * from './email-integration.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `lean-ctx -c pnpm --filter @dealflow/shared test email-integration`
Expected: PASS (3 + 1 cases).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/email-integration.ts packages/shared/src/email-integration.test.ts packages/shared/src/index.ts packages/shared/src/error.ts
git commit -m "feat(shared): EngineMailer config + org plan schemas + error codes"
```

---

## Task 3: `EngineMailerEmailProvider` (TDD)

**Files:**
- Create: `packages/email/src/providers/engine-mailer.ts`
- Test: `packages/email/src/providers/engine-mailer.test.ts`

> **Default assumed contract** (override from Task 0 findings if different): `POST` to `EM_SEND_URL`, header `Authorization: Bearer <apiKey>`, JSON body `{ ToEmail, FromName, FromEmail, ReplyTo, Subject, HtmlBody, TextBody, CustomRef }`, response `{ MessageID }`. `CustomRef` carries our `activityId` and is echoed by the webhook.

- [ ] **Step 1: Write failing test:**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EngineMailerEmailProvider } from './engine-mailer.js';

describe('EngineMailerEmailProvider', () => {
  it('POSTs to the send endpoint with auth + maps fields, returns messageId', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ MessageID: 'em-123' }), { status: 200 }));
    const p = new EngineMailerEmailProvider({
      apiKey: 'secret', fromEmail: 'notifications@dealflow.app', fromName: 'Acme',
      replyTo: 'a@acme.com', fetchImpl: fetchMock,
    });

    const out = await p.send({
      from: 'unused', to: 'bob@x.com', replyTo: 'a@acme.com',
      subject: 'Hi', text: 'plain', html: '<p>hi</p>', activityId: 'act-9',
    });

    expect(out.messageId).toBe('em-123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body);
    expect(body.ToEmail).toBe('bob@x.com');
    expect(body.ReplyTo).toBe('a@acme.com');
    expect(body.CustomRef).toBe('act-9'); // activityId round-trips for webhook matching
  });

  it('throws on non-2xx', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    const p = new EngineMailerEmailProvider({
      apiKey: 'bad', fromEmail: 'x@y.com', fromName: 'X', replyTo: 'x@y.com', fetchImpl: fetchMock,
    });
    await expect(p.send({ from: '', to: 'b@x.com', replyTo: 'x@y.com', subject: 's', text: 't' }))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/email test engine-mailer`
Expected: FAIL — cannot find `./engine-mailer.js`.

- [ ] **Step 3: Add `activityId` to `SendEmailInput`** in `packages/email/src/provider.ts` (optional field):

```typescript
  /** DealFlow activity id; sent as provider CustomRef so the tracking webhook can map events back. */
  activityId?: string;
```

- [ ] **Step 4: Implement** (`engine-mailer.ts`):

```typescript
import { type EmailProvider, type SendEmailInput, type SendEmailOutput } from '../provider.js';

// === EngineMailer contract — confirm/adjust from Task 0 findings ===
const EM_SEND_URL = 'https://api.enginemailer.com/v2/Send';

export interface EngineMailerProviderOptions {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  fetchImpl?: typeof fetch;
}

export class EngineMailerEmailProvider implements EmailProvider {
  constructor(private readonly opts: EngineMailerProviderOptions) {}

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(EM_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        ToEmail: input.to,
        FromEmail: this.opts.fromEmail,
        FromName: this.opts.fromName,
        ReplyTo: input.replyTo || this.opts.replyTo,
        Subject: input.subject,
        TextBody: input.text,
        HtmlBody: input.html,
        Cc: input.cc,
        Bcc: input.bcc,
        CustomRef: input.activityId, // echoed by webhook
      }),
    });
    if (!res.ok) {
      throw new Error(`EngineMailer send failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { MessageID?: string };
    return { messageId: data.MessageID ?? '' };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `lean-ctx -c pnpm --filter @dealflow/email test engine-mailer`
Expected: PASS (2 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/email/src/providers/engine-mailer.ts packages/email/src/providers/engine-mailer.test.ts packages/email/src/provider.ts
git commit -m "feat(email): EngineMailerEmailProvider (REST send via fetch)"
```

---

## Task 4: Factory swap — wire EngineMailer, remove SMTP

**Files:**
- Modify: `packages/email/src/factory.ts`, `packages/email/src/index.ts`
- Delete: `packages/email/src/providers/smtp.ts`, `packages/email/src/providers/smtp.test.ts`
- Test: `packages/email/src/factory.test.ts` (already exists — update)

- [ ] **Step 1: Update `factory.test.ts`** to assert the new behavior:

```typescript
import { describe, it, expect } from 'vitest';
import { buildEmailProvider, isEmailEnabled, describeEmail } from './factory.js';
import { EngineMailerEmailProvider } from './providers/engine-mailer.js';
import { NoopEmailProvider } from './providers/noop.js';

const cfg = (over = {}) => ({
  engineMailer: { apiKey: 'k', fromEmail: 'n@dealflow.app', fromName: 'Acme', replyTo: 'a@acme.com', ...over },
});

describe('factory', () => {
  it('builds EngineMailer provider when configured', () => {
    expect(buildEmailProvider(cfg())).toBeInstanceOf(EngineMailerEmailProvider);
  });
  it('falls back to Noop when not configured', () => {
    expect(buildEmailProvider({})).toBeInstanceOf(NoopEmailProvider);
  });
  it('isEmailEnabled requires apiKey + fromEmail', () => {
    expect(isEmailEnabled(cfg())).toBe(true);
    expect(isEmailEnabled({ engineMailer: { apiKey: '', fromEmail: '', fromName: '', replyTo: '' } })).toBe(false);
  });
  it('describeEmail reports provider + from address', () => {
    expect(describeEmail(cfg())).toEqual({ provider: 'engine-mailer', fromAddress: 'n@dealflow.app' });
    expect(describeEmail({})).toEqual({ provider: 'none', fromAddress: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/email test factory`
Expected: FAIL — `engineMailer` not handled / SMTP types referenced.

- [ ] **Step 3: Rewrite `factory.ts`:**

```typescript
import { type EmailProvider } from './provider.js';
import { NoopEmailProvider } from './providers/noop.js';
import { EngineMailerEmailProvider } from './providers/engine-mailer.js';

export interface EngineMailerConfig {
  apiKey?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
}
export interface EmailConfig {
  engineMailer?: EngineMailerConfig;
}

export function isEmailEnabled(cfg: EmailConfig): boolean {
  const e = cfg.engineMailer;
  return Boolean(e?.apiKey && e?.fromEmail && e?.fromName && e?.replyTo);
}

export function describeEmail(cfg: EmailConfig): {
  provider: 'engine-mailer' | 'none';
  fromAddress: string | null;
} {
  if (isEmailEnabled(cfg)) return { provider: 'engine-mailer', fromAddress: cfg.engineMailer!.fromEmail ?? null };
  return { provider: 'none', fromAddress: null };
}

export function buildEmailProvider(cfg: EmailConfig): EmailProvider {
  if (!isEmailEnabled(cfg)) return new NoopEmailProvider();
  const e = cfg.engineMailer!;
  return new EngineMailerEmailProvider({
    apiKey: e.apiKey!, fromEmail: e.fromEmail!, fromName: e.fromName!, replyTo: e.replyTo!,
  });
}
```

- [ ] **Step 4: Update `index.ts`:**

```typescript
export * from './provider.js';
export { NoopEmailProvider } from './providers/noop.js';
export { EngineMailerEmailProvider } from './providers/engine-mailer.js';
export * from './factory.js';
```

- [ ] **Step 5: Delete SMTP files + nodemailer dep.**

Run: `git rm packages/email/src/providers/smtp.ts packages/email/src/providers/smtp.test.ts`
Then remove `nodemailer` (+ `@types/nodemailer`) from `packages/email/package.json` dependencies.

- [ ] **Step 6: Run tests + typecheck**

Run: `lean-ctx -c pnpm --filter @dealflow/email test` then `lean-ctx -c pnpm --filter @dealflow/email exec tsc --noEmit`
Expected: PASS; no references to `SmtpEmailProvider`/`SmtpConfig` remain.

- [ ] **Step 7: Commit**

```bash
git add -A packages/email
git commit -m "feat(email): swap factory to EngineMailer; remove SMTP provider + nodemailer"
```

---

## Task 5: `OrgIntegrationsRepo` — `engineMailer` block replaces `smtp`

**Files:**
- Modify: `apps/api/src/modules/integrations/repo.ts`
- Test: `apps/api/test/modules/integrations/repo.test.ts` (extend existing, or create)

- [ ] **Step 1: Write failing test** (round-trip encrypt/decrypt + masked view):

```typescript
import { describe, it, expect } from 'vitest';
import { startTestPostgres } from '../../helpers/postgres.js';
import { OrgIntegrationsRepo } from '../../../src/modules/integrations/repo.js';
import { randomBytes } from 'node:crypto';

describe('OrgIntegrationsRepo engineMailer', () => {
  it('stores encrypted apiKey, returns it decrypted, masks it for the UI', async () => {
    const { db, stop } = await startTestPostgres();
    try {
      const repo = new OrgIntegrationsRepo(db, randomBytes(32));
      const orgId = /* seed an org, get id */ await seedOrg(db);
      await repo.saveEngineMailer(orgId, {
        apiKey: 'super-secret-7Q4a', fromName: 'Acme', replyTo: 'a@acme.com', sendingMode: 'shared',
      });
      const dec = await repo.getDecrypted(orgId);
      expect(dec.engineMailer?.apiKey).toBe('super-secret-7Q4a');
      const masked = await repo.getMasked(orgId);
      expect(masked.email.keyHint).toMatch(/7Q4a$/);
      expect(JSON.stringify(masked)).not.toContain('super-secret-7Q4a');
    } finally { await stop(); }
  });

  it('keeps the existing apiKey when update omits it', async () => {
    const { db, stop } = await startTestPostgres();
    try {
      const repo = new OrgIntegrationsRepo(db, randomBytes(32));
      const orgId = await seedOrg(db);
      await repo.saveEngineMailer(orgId, { apiKey: 'first-key', fromName: 'A', replyTo: 'a@a.com', sendingMode: 'shared' });
      await repo.saveEngineMailer(orgId, { fromName: 'B', replyTo: 'b@b.com', sendingMode: 'shared' });
      const dec = await repo.getDecrypted(orgId);
      expect(dec.engineMailer?.apiKey).toBe('first-key');
      expect(dec.engineMailer?.fromName).toBe('B');
    } finally { await stop(); }
  });
});
```
(Use the same org-seeding helper the existing repo/members tests use; if none, insert a row into `organizations` directly and return its id.)

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/api test integrations/repo`
Expected: FAIL — `saveEngineMailer` not a function / `engineMailer` undefined.

- [ ] **Step 3: Implement in `repo.ts`.** Replace the `StoredSmtp`/`DecryptedSmtp` interfaces and their use with EngineMailer equivalents, following the existing AES-256-GCM `encryptSecret`/`decryptSecret` pattern used for `smtp.pass`:

```typescript
interface StoredEngineMailer {
  apiKey: string;        // encrypted
  fromName: string;
  replyTo: string;
  sendingMode: 'shared' | 'custom';
  fromEmail?: string;
  customDomain?: string;
  domainVerified?: boolean;
}
export interface DecryptedEngineMailer {
  apiKey: string; fromName: string; replyTo: string;
  sendingMode: 'shared' | 'custom'; fromEmail?: string;
  customDomain?: string; domainVerified?: boolean;
}
```
- In `StoredIntegrations`/`DecryptedIntegrations`: replace `smtp` with `engineMailer`.
- Add `async saveEngineMailer(orgId, input)`: load existing stored block; if `input.apiKey` is omitted/blank, keep the existing encrypted key, else `encryptSecret(input.apiKey)`; persist the merged block to the JSONB column.
- `getDecrypted`: decrypt `engineMailer.apiKey`; return `engineMailer` (or null).
- `getMasked`: return `PublicEmailIntegration` under an `email` key: `{ connected: !!apiKey, fromName, replyTo, sendingMode, fromEmail, domainVerified, keyHint: lastFour(apiKey) }`. Add a private `lastFour(plain) => '••••' + plain.slice(-4)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `lean-ctx -c pnpm --filter @dealflow/api test integrations/repo`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/integrations/repo.ts apps/api/test/modules/integrations/repo.test.ts
git commit -m "feat(api): org integrations store EngineMailer config (encrypted)"
```

---

## Task 6: Integration routes — save config + send test email

**Files:**
- Modify: `apps/api/src/modules/integrations/routes.ts`
- Test: `apps/api/test/modules/integrations/routes.test.ts`

- [ ] **Step 1: Write failing test:**

```typescript
it('PATCH /integrations saves EngineMailer config (admin) and masks the key', async () => {
  const { app, ownerToken } = await setup(); // existing harness
  const res = await app.inject({
    method: 'PATCH', url: '/api/v1/integrations',
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { engineMailer: { apiKey: 'k-7Q4a', fromName: 'Acme', replyTo: 'a@acme.com', sendingMode: 'shared' } },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().email.keyHint).toMatch(/7Q4a$/);
});

it('PATCH /integrations is forbidden for members', async () => {
  const { app, memberToken } = await setup();
  const res = await app.inject({
    method: 'PATCH', url: '/api/v1/integrations',
    headers: { authorization: `Bearer ${memberToken}` },
    payload: { engineMailer: { apiKey: 'k', fromName: 'A', replyTo: 'a@a.com', sendingMode: 'shared' } },
  });
  expect(res.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/api test integrations/routes`
Expected: FAIL — route ignores `engineMailer` / no masking.

- [ ] **Step 3: Implement** in `routes.ts`. Add/extend the `PATCH /api/v1/integrations` handler: validate `req.body.engineMailer` with `engineMailerConfigSchema`, guard with `requireRole(['owner','admin'])`, call `repo.saveEngineMailer(orgId, parsed)`, return `repo.getMasked(orgId)`. Keep/extend `POST /api/v1/integrations/test-email`: build provider via `buildEmailProvider({ engineMailer: await repo.getDecrypted(orgId).engineMailer })` and send a canned test message to the requester; if not configured, 400 `EMAIL_NOT_CONFIGURED`.

- [ ] **Step 4: Run test to verify it passes**

Run: `lean-ctx -c pnpm --filter @dealflow/api test integrations/routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/integrations/routes.ts apps/api/test/modules/integrations/routes.test.ts
git commit -m "feat(api): save EngineMailer config + send test email (owner/admin)"
```

---

## Task 7: Org plan flag endpoint (owner-only)

**Files:**
- Modify: `apps/api/src/modules/orgs/routes.ts` (or wherever `PATCH org` lives — see `modules/members/routes.ts` orgs handlers)
- Test: same module's routes test

- [ ] **Step 1: Write failing test:**

```typescript
it('owner can set org plan to pro; member cannot', async () => {
  const { app, ownerToken, memberToken } = await setup();
  const ok = await app.inject({ method: 'PATCH', url: '/api/v1/orgs/current',
    headers: { authorization: `Bearer ${ownerToken}` }, payload: { plan: 'pro' } });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().plan).toBe('pro');

  const no = await app.inject({ method: 'PATCH', url: '/api/v1/orgs/current',
    headers: { authorization: `Bearer ${memberToken}` }, payload: { plan: 'pro' } });
  expect(no.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/api test orgs`
Expected: FAIL — `plan` not accepted / route missing.

- [ ] **Step 3: Implement.** In the org-update handler, accept optional `plan` validated by `orgPlanSchema`, guard with `requireRole(['owner'])` for the `plan` field specifically, update `organizations.plan`, return the updated org (including `plan`). (This is the temporary "upgrade" path until Stripe.)

- [ ] **Step 4: Run test to verify it passes**

Run: `lean-ctx -c pnpm --filter @dealflow/api test orgs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/orgs apps/api/test/modules
git commit -m "feat(api): owner can set org plan (free/pro) — temporary upgrade path"
```

---

## Task 8: Webhook event mapper (pure) + ingestion route

**Files:**
- Create: `apps/api/src/modules/emails/webhook-event-mapper.ts` (+ `.test.ts`)
- Create: `apps/api/src/modules/emails/engine-mailer-webhook.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/src/env.ts`, `apps/api/.env.example`
- Test: `apps/api/test/modules/emails/engine-mailer-webhook.test.ts`

> Field names below are the **default assumed contract** — reconcile with Task 0 findings.

- [ ] **Step 1: Write failing test for the pure mapper:**

```typescript
import { describe, it, expect } from 'vitest';
import { mapEngineMailerEvent } from './webhook-event-mapper.js';

describe('mapEngineMailerEvent', () => {
  it('maps Open to an open update', () => {
    expect(mapEngineMailerEvent({ Event: 'Open', CustomRef: 'act-1' }))
      .toEqual({ activityId: 'act-1', kind: 'open' });
  });
  it('maps Click and captures the url', () => {
    expect(mapEngineMailerEvent({ Event: 'Click', CustomRef: 'act-1', Url: 'https://x.com' }))
      .toEqual({ activityId: 'act-1', kind: 'click', url: 'https://x.com' });
  });
  it('maps Delivered/Bounce to delivery updates', () => {
    expect(mapEngineMailerEvent({ Event: 'Bounce', CustomRef: 'act-1' }))
      .toEqual({ activityId: 'act-1', kind: 'delivery', deliveryStatus: 'bounced' });
  });
  it('returns null for unknown events / missing ref', () => {
    expect(mapEngineMailerEvent({ Event: 'Whatever', CustomRef: 'act-1' })).toBeNull();
    expect(mapEngineMailerEvent({ Event: 'Open' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/api test webhook-event-mapper`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapper:**

```typescript
export interface EngineMailerEvent {
  Event?: string; CustomRef?: string; MessageID?: string; Url?: string;
}
export type ActivityUpdate =
  | { activityId: string; kind: 'open' }
  | { activityId: string; kind: 'click'; url?: string }
  | { activityId: string; kind: 'delivery'; deliveryStatus: 'delivered' | 'bounced' | 'spam' };

export function mapEngineMailerEvent(ev: EngineMailerEvent): ActivityUpdate | null {
  const id = ev.CustomRef;
  if (!id) return null;
  switch ((ev.Event ?? '').toLowerCase()) {
    case 'open': return { activityId: id, kind: 'open' };
    case 'click': return { activityId: id, kind: 'click', url: ev.Url };
    case 'delivered': return { activityId: id, kind: 'delivery', deliveryStatus: 'delivered' };
    case 'bounce': return { activityId: id, kind: 'delivery', deliveryStatus: 'bounced' };
    case 'spam': case 'complaint': return { activityId: id, kind: 'delivery', deliveryStatus: 'spam' };
    default: return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `lean-ctx -c pnpm --filter @dealflow/api test webhook-event-mapper`
Expected: PASS (4 cases).

- [ ] **Step 5: Add env vars** in `env.ts` (zod env schema) + `.env.example`:

```
PUBLIC_EMAIL_DOMAIN=dealflow.app
ENGINE_MAILER_WEBHOOK_SECRET=replace-me
```
(`.env.example` placeholders only — never commit real secrets.)

- [ ] **Step 6: Write failing integration test for the route** (valid signature increments openCount; bad signature → 401):

```typescript
import { createHmac } from 'node:crypto';
it('valid open webhook increments the activity openCount', async () => {
  const { app, db, secret } = await setup(); // sets ENGINE_MAILER_WEBHOOK_SECRET=secret
  const activityId = await seedEmailActivity(db); // openCount=0
  const body = JSON.stringify({ Event: 'Open', CustomRef: activityId });
  const sig = createHmac('sha256', 'secret').update(body).digest('hex');
  const res = await app.inject({
    method: 'POST', url: '/api/v1/webhooks/engine-mailer',
    headers: { 'content-type': 'application/json', 'x-enginemailer-signature': sig },
    payload: body,
  });
  expect(res.statusCode).toBe(200);
  const a = await getActivity(db, activityId);
  expect(a.openCount).toBe(1);
  expect(a.firstOpenedAt).not.toBeNull();
});

it('rejects an invalid signature with 401', async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: 'POST', url: '/api/v1/webhooks/engine-mailer',
    headers: { 'content-type': 'application/json', 'x-enginemailer-signature': 'wrong' },
    payload: JSON.stringify({ Event: 'Open', CustomRef: 'x' }),
  });
  expect(res.statusCode).toBe(401);
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/api test engine-mailer-webhook`
Expected: FAIL — route not registered (404).

- [ ] **Step 8: Implement the route** (`engine-mailer-webhook.ts`). Register a `POST /api/v1/webhooks/engine-mailer` with `config: { rawBody: true }` (or read the raw payload) so the HMAC is computed over the exact bytes. Verify `hmacSHA256(rawBody, ENGINE_MAILER_WEBHOOK_SECRET) === signatureHeader` using `crypto.timingSafeEqual`; else `reply.code(401).send({ error: { code: 'WEBHOOK_SIGNATURE_INVALID' } })`. Parse → `mapEngineMailerEvent` → if null, `return reply.code(200).send({ ok: true })`. Else look up the activity by `activityId` (the `CustomRef`); if not found, log + 200. Else apply the update via a small repo method:
  - open → `openCount = openCount + 1`, `firstOpenedAt = COALESCE(firstOpenedAt, now())`, `lastOpenedAt = now()`
  - click → `clickCount = clickCount + 1`, `firstClickedAt = COALESCE(...)`, `lastClickedAt = now()` (+ store url if a column exists)
  - delivery → set `deliveryStatus`
  Always end `reply.code(200).send({ ok: true })` (EngineMailer doesn't retry non-200). Register in `server.ts` (public — no `requireOrg`/auth preHandler).

- [ ] **Step 9: Run test to verify it passes**

Run: `lean-ctx -c pnpm --filter @dealflow/api test engine-mailer-webhook`
Expected: PASS (both cases).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/emails/webhook-event-mapper.ts apps/api/src/modules/emails/webhook-event-mapper.test.ts apps/api/src/modules/emails/engine-mailer-webhook.ts apps/api/src/server.ts apps/api/src/env.ts apps/api/.env.example apps/api/test/modules/emails/engine-mailer-webhook.test.ts
git commit -m "feat(api): EngineMailer tracking webhook (signed) -> activity open/click counters"
```

---

## Task 9: Wire send sites — stamp externalId, stop pixel wrapping

**Files:**
- Modify: `apps/api/src/lib/email.ts`, `apps/api/src/lib/email-html-wrap.ts`

- [ ] **Step 1: Write failing test** (sending stores the returned messageId on the activity; html is NOT pixel-wrapped):

```typescript
it('records the EngineMailer messageId as the activity externalId and does not inject a pixel', async () => {
  // arrange: configured engineMailer + a stub provider returning messageId 'em-77'
  const { sendTrackedEmail, getActivity } = await setupEmailLib({ messageId: 'em-77' });
  const activityId = await sendTrackedEmail({ to: 'b@x.com', subject: 's', html: '<p>hi</p>', text: 't' });
  const a = await getActivity(activityId);
  expect(a.externalId).toBe('em-77');
  expect(a.bodyHtml ?? '').not.toContain('/track/open/'); // no pixel
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/api test lib/email`
Expected: FAIL — still injects pixel / doesn't set externalId.

- [ ] **Step 3: Implement.** In `email.ts`: pass `activityId` into `provider.send(...)`; after send, persist `messageId` to `activities.externalId`. Remove the call that wraps HTML with the tracking pixel/redirects. In `email-html-wrap.ts`: delete the pixel `<img>` injection and the click-redirect URL rewriting; keep only the plain-text→HTML wrapper if other code uses it (otherwise delete the file and its imports).

- [ ] **Step 4: Run test to verify it passes**

Run: `lean-ctx -c pnpm --filter @dealflow/api test lib/email`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/email.ts apps/api/src/lib/email-html-wrap.ts apps/api/test
git commit -m "feat(api): stamp provider messageId on activity; stop self-hosted pixel injection"
```

---

## Task 10: Remove the self-hosted tracking endpoints + token util

**Files:**
- Delete: `apps/api/src/modules/emails/tracking-routes.ts`, `apps/api/src/lib/email-tracking-token.ts` (+ test)
- Modify: `apps/api/src/server.ts` (remove registration), any imports; runbook docs

- [ ] **Step 1: Write failing test** asserting the old routes are gone:

```typescript
it('GET /track/open/:token is no longer registered', async () => {
  const { app } = await setup();
  const res = await app.inject({ method: 'GET', url: '/track/open/anything' });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `lean-ctx -c pnpm --filter @dealflow/api test track`
Expected: FAIL — route still returns 200 (a 1×1 gif).

- [ ] **Step 3: Delete + deregister.**

Run: `git rm apps/api/src/modules/emails/tracking-routes.ts apps/api/src/lib/email-tracking-token.ts apps/api/src/lib/email-tracking-token.test.ts`
Remove the `app.register(trackingRoutes…)` line + import from `server.ts`. Grep for `EMAIL_TRACKING_SECRET` and `/track/` and remove dead references (keep `.env` key removal for the deploy runbook note, not code).

- [ ] **Step 4: Run test to verify it passes + full api suite**

Run: `lean-ctx -c pnpm --filter @dealflow/api test`
Expected: the 404 test PASSES; whole suite green.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api
git commit -m "refactor(api): remove self-hosted tracking pixel/redirect + HMAC token (EngineMailer webhooks replace it)"
```

---

## Task 11: Web — Email integration section (free state) + hooks

**Files:**
- Create: `apps/web/src/features/integrations/email-integration-section.tsx`
- Delete: `apps/web/src/features/integrations/smtp-integration-section.tsx`
- Modify: `apps/web/src/features/integrations/api.ts`, the Settings route that mounts sections

Follows the approved paywall mockup State 1 (free Email card). ui-ux-pro-max: visible labels, helper text, one primary CTA, SVG (lucide) icons, owner/admin gating, free sending never blocked.

- [ ] **Step 1: Add hooks** in `api.ts`: `useEmailIntegration()` (GET masked), `useUpdateEmailIntegration()` (PATCH), reuse `useTestEmail()`. Use the existing query-key + fetch helpers in that file.

- [ ] **Step 2: Implement `email-integration-section.tsx`** — a card with: connected banner (key hint), `From name` input, `Reply-To` input (type=email), read-only "Sending address: notifications@<PUBLIC_EMAIL_DOMAIN> — managed", `Save` (primary, shows loading) + `Send test email` (secondary). Disable inputs + show a lock note for non-owner/admin (reuse the role check used by other settings sections). Mirror the markup/classes of the existing `ai-integrations-section.tsx`.

- [ ] **Step 3: Swap mounting + delete SMTP section.** In the Settings page, replace `<SmtpIntegrationSection/>` with `<EmailIntegrationSection/>`.
Run: `git rm apps/web/src/features/integrations/smtp-integration-section.tsx`

- [ ] **Step 4: Typecheck + live check.**

Run: `lean-ctx -c pnpm --filter @dealflow/web exec tsc --noEmit`
Then with the dev stack up, open `/app/settings` and confirm the Email card renders, Save persists (key shows masked), Send test works. (Playwright snapshot is fine for the controller.)

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/features/integrations
git commit -m "feat(web): EngineMailer email settings section (free); remove SMTP section"
```

---

## Task 12: Web — Custom domain section (Pro upsell + verification) + gating

**Files:**
- Create: `apps/web/src/features/integrations/custom-domain-section.tsx`
- Modify: `apps/web/src/features/integrations/api.ts`, Settings route, `apps/api/src/modules/integrations/routes.ts` (custom-domain endpoints)

Follows paywall mockup States 1 (locked card) → 2 (upgrade dialog) → 3 (DNS verify).

- [ ] **Step 1 (API): add custom-domain endpoints (Pro-gated) + test.**

```typescript
it('POST /integrations/custom-domain returns 403 PLAN_UPGRADE_REQUIRED for a free org', async () => {
  const { app, ownerToken } = await setup(); // org plan defaults to 'free'
  const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/custom-domain',
    headers: { authorization: `Bearer ${ownerToken}` }, payload: { domain: 'acme.com' } });
  expect(res.statusCode).toBe(403);
  expect(res.json().error.code).toBe('PLAN_UPGRADE_REQUIRED');
});
```
Run it (FAIL), then implement: both `POST /custom-domain` and `POST /custom-domain/verify` require `requireRole(['owner','admin'])` AND `org.plan === 'pro'` (else 403 `PLAN_UPGRADE_REQUIRED`). Return `CustomDomainStatus`. If Task 0 found no domain API, return static DKIM/SPF records (from `PUBLIC_EMAIL_DOMAIN` config) + `status:'pending'`, and `verify` flips to `'verified'` once EngineMailer reports it (or, interim, a manual owner confirmation). Run → PASS. Commit.

- [ ] **Step 2 (Web): add hooks** `useCustomDomain()`, `useVerifyDomain()`, `useUpgradePlan()` (PATCH org `plan`).

- [ ] **Step 3 (Web): implement `custom-domain-section.tsx`.** Read `org.plan`:
  - `free` → render the locked upsell card (lucide lock + "Pro" pill, benefit list, `$12/mo`, primary `Upgrade to Pro` → opens the confirm dialog; dialog's primary calls `useUpgradePlan()` for now).
  - `pro` → render the verification card (From-email input, DNS records table with copy buttons, `Verify domain` primary, status pill Verifying→Verified). Members read-only.
  Apply ui-ux-pro-max: `disabled-states`, `progressive-disclosure` (DNS only in pro), `primary-action`, `color-not-only` (lock icon + text), `input-helper-text`.

- [ ] **Step 4: Mount** `<CustomDomainSection/>` under the Email section in Settings.

- [ ] **Step 5: Typecheck + live check** (free shows upsell; toggling plan to pro via the dialog shows the DNS card).

Run: `lean-ctx -c pnpm --filter @dealflow/web exec tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src/features/integrations apps/api/src/modules/integrations
git commit -m "feat: Pro custom-domain section (upsell + DNS verify) gated by org plan"
```

---

## Task 13: Cross-package validation + browser pass + tag

**Files:** none (verification + docs)

- [ ] **Step 1: Full typecheck across packages.**

Run: `lean-ctx -c pnpm -r exec tsc --noEmit`
Expected: clean (no SMTP/nodemailer/tracking-token references).

- [ ] **Step 2: Full test suite.**

Run: `lean-ctx -c pnpm -r test`
Expected: all green (email, shared, api incl. webhook + repo + routes).

- [ ] **Step 3: Live smoke** with the dev stack: Settings → Email saves + test email sends via EngineMailer; trigger an open/click and confirm the activity counters increment from the webhook (not the pixel); confirm `/track/open/...` is 404; free org sees the Pro upsell, pro org sees DNS verify.

- [ ] **Step 4: Update the testing checklist HTML** (the repo's manual-test checklist) to swap "SMTP" → "EngineMailer" and "pixel/ngrok" → "webhook".

- [ ] **Step 5: Commit + tag.**

```bash
git add -A
git commit -m "chore: EngineMailer email integration — validation pass + checklist"
git tag -a enginemailer-email -m "EngineMailer send + webhook tracking; SMTP/pixel/ngrok removed; Pro custom domain"
git push origin main --tags
```

---

## Self-Review

**Spec coverage:** §2.1 replace SMTP → T4,T11; §2.2 delete pixel/ngrok → T9,T10; §2.3 sender A/B → T11(A),T12(B); §2.4 plan flag, Stripe out → T1,T7,T12; §3 Phase-0 spike → T0; §4 data model → T1,T5; §5 shared → T2; §6.1 provider → T3,T4; §6.2 integrations routes → T6,T12; §6.3 webhook → T8; §6.4 send sites → T9; §6.5 removals → T4,T9,T10; §7 frontend → T11,T12; §8 migration → T1,T11(reconnect copy); §9 error handling → T6,T8,T12; §10 testing → every task + T13. No uncovered requirement.

**Placeholder scan:** EngineMailer request/webhook field names are marked "default assumed contract — reconcile with Task 0"; they are concrete (not TBD) and isolated to one constants block. No "TODO/handle edge cases" left vague.

**Type consistency:** `engineMailerConfigSchema`/`PublicEmailIntegration`/`CustomDomainStatus`/`orgPlanSchema` (T2) reused verbatim in T5/T6/T12; `SendEmailInput.activityId` (T3) consumed in T8 mapper via `CustomRef` and in T9; `mapEngineMailerEvent` shape (T8) matches the route's apply logic; `getMasked` returns under `email` key (T5) matched by `res.json().email.keyHint` (T6) and `useEmailIntegration` (T11).
