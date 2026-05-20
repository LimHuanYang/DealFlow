# DealFlow Phase 1 Sub-Plan 2b: CRM Email (Outbound + AI Draft) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users send emails directly from a contact's page — each sent email becomes a third kind of activity (alongside note/task), with AI-drafted replies powered by the existing Anthropic/Gemini/Grok fallback chain.

**Architecture:** A new `@dealflow/email` workspace package owns the `EmailProvider` abstraction (mirroring `@dealflow/ai`). `ResendEmailProvider` is the real implementation; a `NoopEmailProvider` keeps tests offline. The factory builds the provider from env (`RESEND_API_KEY` required to enable). Email becomes a third value of `activities.kind` (`'note' | 'task' | 'email'`) — two new nullable columns (`subject`, `external_id`) carry email-specific data. A new `POST /api/v1/emails` route sends + logs; the existing `draftEmail` stubs in all three AI providers get real implementations so AI-drafted email replies just work through the fallback chain we already shipped. Compose dialog lives on the contact detail page; sent emails render in the existing ActivityFeed with a distinct icon. Inbound emails (replies coming back to the CRM) are out of scope — that's a future sub-plan.

**Tech Stack:** `resend` SDK, Fastify routes with zod validation, TanStack Query hooks. No frontend deps added.

**Scope decisions:**
- **Outbound only.** Reply-To is set to the sending user's email so replies land in their actual inbox. Inbound parsing / BCC-to-CRM defer to a later sub-plan.
- **Single recipient (the contact's email).** Multi-recipient TO/CC/BCC defers.
- **Plain text only.** No HTML editor in v1 — `text` field on Resend; Resend renders it as both `text/plain` and a sensible `text/html` derivative automatically.
- **One sender per deployment.** `RESEND_FROM_EMAIL` is the envelope from. Resend requires a verified domain — self-host operator owns this. SaaS owns its own domain.
- **Sender name follows the user.** From line is rendered as `"{user.name} via {RESEND_FROM_NAME} <{RESEND_FROM_EMAIL}>"` so recipients see who actually sent it.
- **Email is disabled when `RESEND_API_KEY` is unset.** UI hides the Email button; routes return 503 `EMAIL_DISABLED`.
- **AI draft uses the existing fallback chain.** No new provider plumbing — just implement `draftEmail` for real in Anthropic/Gemini/Grok (currently they all throw `AIDisabledError`).

---

## File Structure

### New files
- `packages/email/package.json` — new workspace package
- `packages/email/tsconfig.json`
- `packages/email/src/index.ts` — barrel
- `packages/email/src/provider.ts` — `EmailProvider` interface + `EmailDisabledError`
- `packages/email/src/providers/noop.ts`
- `packages/email/src/providers/noop.test.ts`
- `packages/email/src/providers/resend.ts`
- `packages/email/src/providers/resend.test.ts`
- `packages/email/src/factory.ts`
- `packages/email/src/factory.test.ts`
- `packages/db/migrations/0006_activities_email_columns.sql`
- `packages/shared/src/emails.ts` — zod schemas for routes
- `apps/api/src/modules/emails/routes.ts` — POST send, GET status
- `apps/api/test/modules/emails/emails.routes.test.ts`
- `apps/web/src/features/emails/api.ts` — TanStack Query hooks
- `apps/web/src/features/emails/compose-email-dialog.tsx` — composer UI

### Modified files
- `packages/db/src/schema/activities.ts` — add `subject`, `externalId` columns
- `packages/db/migrations/meta/_journal.json` — idx 6
- `packages/shared/src/activities.ts` — `ACTIVITY_KINDS = ['note', 'task', 'email']`, `PublicActivity` gets `subject`/`externalId`
- `packages/shared/src/index.ts` — re-export `emails.ts`
- `packages/ai/src/providers/prompts.ts` — add `DRAFT_EMAIL_SYSTEM` + `parseDraftEmailJson`
- `packages/ai/src/providers/anthropic.ts` — implement `draftEmail` for real
- `packages/ai/src/providers/anthropic.test.ts` — add draftEmail test
- `packages/ai/src/providers/gemini.ts` — implement `draftEmail`
- `packages/ai/src/providers/gemini.test.ts` — add draftEmail test
- `packages/ai/src/providers/grok.ts` — implement `draftEmail`
- `packages/ai/src/providers/grok.test.ts` — add draftEmail test
- `apps/api/src/env.ts` — add `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`
- `apps/api/.env.example` — document new vars
- `apps/api/src/server.ts` — build email provider, register email + AI draft routes
- `apps/api/test/helpers/build-app.ts` — accept `emailProvider`, `emailFrom`, `emailEnabled` overrides
- `apps/api/src/modules/ai/routes.ts` — add POST `/ai/draft-email`
- `apps/api/test/modules/ai/ai.routes.test.ts` — extend with draft-email tests
- `apps/web/src/lib/query-keys.ts` — add `emails` key
- `apps/web/src/routes/app.contacts.$id.tsx` — render Email button
- `apps/web/src/features/activities/activity-feed.tsx` — render `kind === 'email'` row
- `apps/web/src/routes/app.settings.tsx` — Email status section

---

## API surface

| Method | Path                           | Purpose                                                                                          |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/email/status`         | `{ enabled: boolean, from: string \| null }`                                                     |
| POST   | `/api/v1/emails`               | Body: `{ contactId, subject, body }` → sends via provider, creates activity, returns `{activity}` |
| POST   | `/api/v1/ai/draft-email`       | Body: `{ contactId, intent }` → returns `{ subject, body }`                                       |

All routes require `requireOrg`. When `RESEND_API_KEY` is missing, POST `/emails` returns 503 `EMAIL_DISABLED`. When the chain has no AI keys, POST `/ai/draft-email` returns 503 `AI_DISABLED`.

---

### Task 1: Activities schema — `subject` + `external_id` columns + `'email'` as a third kind

**Files:**
- Modify: `packages/db/src/schema/activities.ts`
- Create: `packages/db/migrations/0006_activities_email_columns.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/shared/src/activities.ts`

- [ ] **Step 1: Add the two new columns to the Drizzle schema**

Edit `packages/db/src/schema/activities.ts`. Inside the existing `pgTable('activities', { ... })` columns block, add two new nullable text fields ALONGSIDE the existing `status` / `dueAt` / `completedAt` task-only fields (i.e. before the polymorphic-parent FK columns):

```typescript
    // Email-only fields. NULL for notes/tasks.
    subject: text('subject'),
    externalId: text('external_id'),
```

The full table definition's `kind` field stays as `text` (no DB-level enum) — TypeScript's `ACTIVITY_KINDS` does the strict-typing.

- [ ] **Step 2: Hand-write the migration**

Create `packages/db/migrations/0006_activities_email_columns.sql`:

```sql
-- Sub-Plan 2b: email becomes a third activity kind.
-- Two new nullable columns carry email-specific data; existing notes/tasks
-- leave both NULL. `kind` stays `text` (no CHECK constraint) — TS-side
-- ACTIVITY_KINDS does the typing.
ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "subject" text,
  ADD COLUMN IF NOT EXISTS "external_id" text;
```

- [ ] **Step 3: Register migration in journal**

Edit `packages/db/migrations/meta/_journal.json` — append after the idx-5 entry:

```json
    {
      "idx": 6,
      "version": "7",
      "when": 1779400000000,
      "tag": "0006_activities_email_columns",
      "breakpoints": true
    }
```

- [ ] **Step 4: Apply migration**

Run: `pnpm --filter @dealflow/db db:migrate`

Expected: `[✓] migrations applied successfully!`

- [ ] **Step 5: Verify the new columns exist**

```bash
pnpm --filter @dealflow/db exec node -e "import('postgres').then(({default:postgres})=>{const sql=postgres('postgres://dealflow:dealflow@localhost:5432/dealflow');sql\`SELECT column_name FROM information_schema.columns WHERE table_name='activities' AND column_name IN ('subject','external_id') ORDER BY column_name\`.then(rows=>{console.log(rows);return sql.end();})})"
```

Expected: two rows (`external_id`, `subject`).

- [ ] **Step 6: Extend shared activity types**

Edit `packages/shared/src/activities.ts`:

Replace the `ACTIVITY_KINDS` line to add `'email'`:

```typescript
export const ACTIVITY_KINDS = ['note', 'task', 'email'] as const;
```

Extend the `PublicActivity` interface to include the two new fields:

```typescript
export interface PublicActivity {
  id: string;
  kind: ActivityKind;
  body: string;
  subject: string | null;
  externalId: string | null;
  status: TaskStatus | null;
  dueAt: string | null;
  completedAt: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

The order matters only for readability — alphabetical-ish is fine. Keep `body` and `subject` together since they're both content fields.

- [ ] **Step 7: Run shared tests to confirm no regressions**

Run: `pnpm --filter @dealflow/shared test`

Expected: all activity tests still pass. (Adding `'email'` to the enum makes existing tests strictly stricter, so they remain valid.)

- [ ] **Step 8: Typecheck the db + shared packages**

Run: `pnpm --filter @dealflow/db typecheck && pnpm --filter @dealflow/shared typecheck`

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/activities.ts packages/db/migrations/0006_activities_email_columns.sql packages/db/migrations/meta/_journal.json packages/shared/src/activities.ts
git commit -m "feat(db): add subject + external_id to activities; add 'email' kind (0006)"
```

---

### Task 2: New `@dealflow/email` package skeleton + `NoopEmailProvider`

**Files:**
- Create: `packages/email/package.json`
- Create: `packages/email/tsconfig.json`
- Create: `packages/email/src/provider.ts`
- Create: `packages/email/src/index.ts`
- Create: `packages/email/src/providers/noop.ts`
- Create: `packages/email/src/providers/noop.test.ts`

- [ ] **Step 1: Create `packages/email/package.json`**

```json
{
  "name": "@dealflow/email",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `packages/email/tsconfig.json`**

Mirror the existing `packages/ai/tsconfig.json` (read that first to confirm the exact contents — likely extends the repo root tsconfig with `compilerOptions.outDir: 'dist'` etc.). Use the same shape verbatim.

If `packages/ai/tsconfig.json` reads:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

Use that same content for `packages/email/tsconfig.json`.

- [ ] **Step 3: Define the `EmailProvider` interface**

Create `packages/email/src/provider.ts`:

```typescript
export interface SendEmailInput {
  /** Display name + address part — already concatenated, e.g. `"Alice via DealFlow <noreply@dealflow.app>"`. */
  from: string;
  /** Single recipient email — multi-recipient deferred to a later sub-plan. */
  to: string;
  /** Where replies should land (typically the sending user's real email). */
  replyTo: string;
  subject: string;
  /** Plain-text body. The provider may also render an HTML derivative. */
  text: string;
}

export interface SendEmailOutput {
  /** Provider-side message ID (Resend returns one; useful for future inbound matching). */
  messageId: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailOutput>;
}

export class EmailDisabledError extends Error {
  constructor() {
    super('Email is disabled. Set RESEND_API_KEY in apps/api/.env to enable.');
    this.name = 'EmailDisabledError';
  }
}
```

- [ ] **Step 4: Write the failing test for `NoopEmailProvider`**

Create `packages/email/src/providers/noop.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { NoopEmailProvider } from './noop.js';
import { EmailDisabledError } from '../provider.js';

describe('NoopEmailProvider', () => {
  it('throws EmailDisabledError on send', async () => {
    const p = new NoopEmailProvider();
    await expect(
      p.send({
        from: 'a@x',
        to: 'b@y',
        replyTo: 'a@x',
        subject: 's',
        text: 't',
      }),
    ).rejects.toBeInstanceOf(EmailDisabledError);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @dealflow/email test noop`

Expected: FAIL — `Cannot find module './noop.js'`.

- [ ] **Step 6: Implement `NoopEmailProvider`**

Create `packages/email/src/providers/noop.ts`:

```typescript
import {
  EmailDisabledError,
  type EmailProvider,
  type SendEmailInput,
  type SendEmailOutput,
} from '../provider.js';

export class NoopEmailProvider implements EmailProvider {
  readonly name = 'noop' as const;
  async send(_input: SendEmailInput): Promise<SendEmailOutput> {
    throw new EmailDisabledError();
  }
}
```

- [ ] **Step 7: Create the barrel export**

Create `packages/email/src/index.ts`:

```typescript
export * from './provider.js';
export { NoopEmailProvider } from './providers/noop.js';
```

- [ ] **Step 8: Install + run test**

Run: `pnpm install`

Then: `pnpm --filter @dealflow/email test`

Expected: 1/1 PASS.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @dealflow/email typecheck`

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/email/package.json packages/email/tsconfig.json packages/email/src pnpm-lock.yaml
git commit -m "feat(email): scaffold @dealflow/email package with NoopEmailProvider"
```

---

### Task 3: `ResendEmailProvider` (real)

**Files:**
- Modify: `packages/email/package.json` — add `resend` dependency
- Create: `packages/email/src/providers/resend.ts`
- Create: `packages/email/src/providers/resend.test.ts`

- [ ] **Step 1: Add the Resend SDK to deps**

Edit `packages/email/package.json` — add `"resend": "^4.0.0"` to `dependencies`:

```json
  "dependencies": {
    "resend": "^4.0.0"
  },
```

Run: `pnpm install`

If `4.0.0` doesn't resolve, fall back to the latest 3.x: `pnpm view resend versions --json | tail -10` and pick the latest. Use whatever the registry has.

- [ ] **Step 2: Write the failing test**

Create `packages/email/src/providers/resend.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider } from './resend.js';

function fakeClient(returnValue: { data?: { id: string } | null; error?: { message: string } | null }) {
  return {
    emails: {
      send: vi.fn().mockResolvedValue(returnValue),
    },
  };
}

describe('ResendEmailProvider.send', () => {
  it('returns the messageId from Resend on success', async () => {
    const client = fakeClient({ data: { id: 'msg_abc123' }, error: null });
    const p = new ResendEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    const out = await p.send({
      from: 'Alice via DealFlow <noreply@dealflow.app>',
      to: 'bob@example.com',
      replyTo: 'alice@acme.com',
      subject: 'Re: Pricing',
      text: 'Hi Bob, …',
    });
    expect(out.messageId).toBe('msg_abc123');
    const call = client.emails.send.mock.calls[0]![0]!;
    expect(call.from).toBe('Alice via DealFlow <noreply@dealflow.app>');
    expect(call.to).toEqual(['bob@example.com']);
    expect(call.replyTo).toBe('alice@acme.com');
    expect(call.subject).toBe('Re: Pricing');
    expect(call.text).toBe('Hi Bob, …');
  });

  it('throws when Resend returns an error payload', async () => {
    const client = fakeClient({
      data: null,
      error: { message: 'Invalid API key' },
    });
    const p = new ResendEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    await expect(
      p.send({
        from: 'x',
        to: 'y@z',
        replyTo: 'x',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/Invalid API key/);
  });

  it('throws when both data and error are null/undefined', async () => {
    const client = fakeClient({ data: null, error: null });
    const p = new ResendEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    await expect(
      p.send({ from: 'x', to: 'y@z', replyTo: 'x', subject: 's', text: 't' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @dealflow/email test resend`

Expected: FAIL — `Cannot find module './resend.js'`.

- [ ] **Step 4: Implement `ResendEmailProvider`**

Create `packages/email/src/providers/resend.ts`:

```typescript
import type { Resend } from 'resend';
import {
  type EmailProvider,
  type SendEmailInput,
  type SendEmailOutput,
} from '../provider.js';

export interface ResendEmailProviderOptions {
  /** Resend SDK client. Tests pass a fake; the factory passes `new Resend(apiKey)`. */
  client: Resend;
}

/**
 * Real email provider backed by Resend. The Resend SDK returns `{ data, error }`:
 * on success `data.id` is the message id; on failure `error.message` is human-readable.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend' as const;
  private readonly client: Resend;

  constructor(opts: ResendEmailProviderOptions) {
    this.client = opts.client;
  }

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    const result = await this.client.emails.send({
      from: input.from,
      to: [input.to],
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
    });
    if (result.error) {
      throw new Error(`Resend send failed: ${result.error.message}`);
    }
    if (!result.data?.id) {
      throw new Error('Resend send returned no message id');
    }
    return { messageId: result.data.id };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @dealflow/email test resend`

Expected: 3/3 PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @dealflow/email typecheck`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/email/package.json packages/email/src/providers/resend.ts packages/email/src/providers/resend.test.ts pnpm-lock.yaml
git commit -m "feat(email): ResendEmailProvider"
```

---

### Task 4: Email provider factory

**Files:**
- Create: `packages/email/src/factory.ts`
- Create: `packages/email/src/factory.test.ts`
- Modify: `packages/email/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/email/src/factory.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildEmailProvider, isEmailEnabled, describeEmail } from './factory.js';
import { NoopEmailProvider } from './providers/noop.js';
import { ResendEmailProvider } from './providers/resend.js';

describe('buildEmailProvider', () => {
  it('returns NoopEmailProvider when no apiKey is set', () => {
    const p = buildEmailProvider({ from: 'x@y' });
    expect(p).toBeInstanceOf(NoopEmailProvider);
  });

  it('returns ResendEmailProvider when apiKey is set', () => {
    const p = buildEmailProvider({ apiKey: 're_test', from: 'x@y' });
    expect(p).toBeInstanceOf(ResendEmailProvider);
  });
});

describe('isEmailEnabled', () => {
  it('true iff apiKey + from are both set', () => {
    expect(isEmailEnabled({ apiKey: 'k', from: 'x@y' })).toBe(true);
    expect(isEmailEnabled({ apiKey: 'k' })).toBe(false);
    expect(isEmailEnabled({ from: 'x@y' })).toBe(false);
    expect(isEmailEnabled({})).toBe(false);
  });
});

describe('describeEmail', () => {
  it('returns provider+from when enabled', () => {
    expect(describeEmail({ apiKey: 'k', from: 'x@y', name: 'X' })).toEqual({
      provider: 'resend',
      from: 'X <x@y>',
    });
  });

  it('returns provider:none + null when disabled', () => {
    expect(describeEmail({})).toEqual({ provider: 'none', from: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/email test factory`

Expected: FAIL — `Cannot find module './factory.js'`.

- [ ] **Step 3: Implement the factory**

Create `packages/email/src/factory.ts`:

```typescript
import { Resend } from 'resend';
import { type EmailProvider } from './provider.js';
import { NoopEmailProvider } from './providers/noop.js';
import { ResendEmailProvider } from './providers/resend.js';

export interface EmailConfig {
  /** Resend API key. Required to enable email. */
  apiKey?: string;
  /** Envelope From address — must be a verified domain in Resend. */
  from?: string;
  /** Display name appended to the From line, e.g. "DealFlow". Optional. */
  name?: string;
}

/** True iff a real ResendEmailProvider would be constructed. */
export function isEmailEnabled(cfg: EmailConfig): boolean {
  return Boolean(cfg.apiKey && cfg.from);
}

/**
 * Public description used by `GET /api/v1/email/status`. When email is enabled,
 * returns the formatted From line so the UI can show the operator exactly what
 * recipients will see. When disabled, both fields are absent.
 */
export function describeEmail(cfg: EmailConfig): {
  provider: 'resend' | 'none';
  from: string | null;
} {
  if (!isEmailEnabled(cfg)) return { provider: 'none', from: null };
  const fromLine = cfg.name ? `${cfg.name} <${cfg.from}>` : (cfg.from ?? null);
  return { provider: 'resend', from: fromLine };
}

/**
 * Build the runtime EmailProvider. Falls back to NoopEmailProvider when keys
 * are missing — that way the API still boots cleanly; routes only return 503
 * when called.
 */
export function buildEmailProvider(cfg: EmailConfig): EmailProvider {
  if (!isEmailEnabled(cfg)) return new NoopEmailProvider();
  if (!cfg.apiKey) return new NoopEmailProvider();
  const client = new Resend(cfg.apiKey);
  return new ResendEmailProvider({ client });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dealflow/email test factory`

Expected: 5/5 PASS.

- [ ] **Step 5: Update the barrel**

Edit `packages/email/src/index.ts`:

```typescript
export * from './provider.js';
export { NoopEmailProvider } from './providers/noop.js';
export { ResendEmailProvider } from './providers/resend.js';
export * from './factory.js';
```

- [ ] **Step 6: Full email package test sweep**

Run: `pnpm --filter @dealflow/email test`

Expected: noop (1) + resend (3) + factory (5) = 9 tests passing.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @dealflow/email typecheck`

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/email/src/factory.ts packages/email/src/factory.test.ts packages/email/src/index.ts
git commit -m "feat(email): factory builds Resend provider from env"
```

---

### Task 5: API env vars for Resend

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/.env.example`
- Create: `apps/api/test/env.email.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/env.email.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://x:y@localhost:5432/z',
};

describe('Email env vars', () => {
  it('all email vars default to undefined / sensible defaults', () => {
    const env = loadEnv(BASE);
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.RESEND_FROM_EMAIL).toBeUndefined();
    expect(env.RESEND_FROM_NAME).toBe('DealFlow');
  });

  it('accepts custom values', () => {
    const env = loadEnv({
      ...BASE,
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'noreply@example.com',
      RESEND_FROM_NAME: 'Acme CRM',
    });
    expect(env.RESEND_API_KEY).toBe('re_test_key');
    expect(env.RESEND_FROM_EMAIL).toBe('noreply@example.com');
    expect(env.RESEND_FROM_NAME).toBe('Acme CRM');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/api test env.email`

Expected: FAIL.

- [ ] **Step 3: Add the 3 vars to env.ts**

Edit `apps/api/src/env.ts`. Inside the existing `z.object({ ... })` (alongside the AI env vars), add:

```typescript
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().email().optional(),
    RESEND_FROM_NAME: z.string().default('DealFlow'),
```

Place after the existing `XAI_MODEL` field, before the closing `})` of the `z.object`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dealflow/api test env.email`

Expected: 2/2 PASS.

- [ ] **Step 5: Document in `.env.example`**

Append to `apps/api/.env.example`:

```env

# Email (optional). Resend is the supported provider. RESEND_API_KEY is required
# to enable sending; RESEND_FROM_EMAIL must be a verified domain in your Resend
# dashboard. RESEND_FROM_NAME shows in the From line ("Name <email>").
# RESEND_API_KEY=re_...
# RESEND_FROM_EMAIL=noreply@your-domain.com
# RESEND_FROM_NAME=DealFlow
```

- [ ] **Step 6: Verify build-app helper still works**

The `build-app.ts` helper constructs an `Env` literal directly. The new `RESEND_FROM_NAME` has a default value but the other two are optional — no test helper changes should be needed. Confirm by running:

Run: `pnpm --filter @dealflow/api typecheck`

Expected: no errors. If typecheck complains about the Env literal in `build-app.ts`, add `RESEND_FROM_NAME: 'DealFlow'` to that literal.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/env.ts apps/api/.env.example apps/api/test/env.email.test.ts
git commit -m "feat(api): RESEND_API_KEY / RESEND_FROM_EMAIL / RESEND_FROM_NAME env vars"
```

---

### Task 6: Shared zod schemas for email routes

**Files:**
- Create: `packages/shared/src/emails.ts`
- Create: `packages/shared/src/emails.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/emails.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { sendEmailBodySchema, draftEmailBodySchema } from './emails.js';

const UUID = '00000000-0000-0000-0000-000000000001';

describe('sendEmailBodySchema', () => {
  it('accepts a minimal valid send payload', () => {
    expect(
      sendEmailBodySchema.safeParse({
        contactId: UUID,
        subject: 'Re: Pricing',
        body: 'Hi Bob,\nPlease find pricing attached.',
      }).success,
    ).toBe(true);
  });
  it('rejects empty subject', () => {
    expect(
      sendEmailBodySchema.safeParse({ contactId: UUID, subject: '', body: 'x' }).success,
    ).toBe(false);
  });
  it('rejects empty body', () => {
    expect(
      sendEmailBodySchema.safeParse({ contactId: UUID, subject: 's', body: '' }).success,
    ).toBe(false);
  });
  it('rejects missing contactId', () => {
    expect(sendEmailBodySchema.safeParse({ subject: 's', body: 'b' }).success).toBe(false);
  });
  it('rejects subject over 200 chars', () => {
    expect(
      sendEmailBodySchema.safeParse({ contactId: UUID, subject: 'x'.repeat(201), body: 'b' })
        .success,
    ).toBe(false);
  });
});

describe('draftEmailBodySchema', () => {
  it('accepts contactId + intent', () => {
    expect(
      draftEmailBodySchema.safeParse({ contactId: UUID, intent: 'follow up on demo' }).success,
    ).toBe(true);
  });
  it('rejects missing intent', () => {
    expect(draftEmailBodySchema.safeParse({ contactId: UUID }).success).toBe(false);
  });
  it('rejects empty intent', () => {
    expect(draftEmailBodySchema.safeParse({ contactId: UUID, intent: '' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/shared test emails`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the schemas**

Create `packages/shared/src/emails.ts`:

```typescript
import { z } from 'zod';

const uuid = z.string().uuid();

/** Body for POST /api/v1/emails. Sends to a single contact's email. */
export const sendEmailBodySchema = z.object({
  contactId: uuid,
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
});
export type SendEmailInput = z.infer<typeof sendEmailBodySchema>;
export interface SendEmailResponse {
  activity: import('./activities.js').PublicActivity;
}

/** Body for POST /api/v1/ai/draft-email. */
export const draftEmailBodySchema = z.object({
  contactId: uuid,
  intent: z.string().min(1).max(500),
});
export type DraftEmailBodyInput = z.infer<typeof draftEmailBodySchema>;
export interface DraftEmailResponse {
  subject: string;
  body: string;
}

/** Public response from GET /api/v1/email/status. */
export interface PublicEmailStatus {
  enabled: boolean;
  /** Formatted "Name <email>" string when enabled, else null. */
  from: string | null;
}
```

- [ ] **Step 4: Re-export from shared index**

Edit `packages/shared/src/index.ts`. Append:

```typescript
export * from './emails.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @dealflow/shared test emails`

Expected: 8/8 PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @dealflow/shared typecheck`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/emails.ts packages/shared/src/emails.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): email send + ai-draft zod schemas"
```

---

### Task 7: Real `draftEmail` implementations in all 3 AI providers

**Files:**
- Modify: `packages/ai/src/providers/prompts.ts` — add `DRAFT_EMAIL_SYSTEM` + parser
- Modify: `packages/ai/src/providers/anthropic.ts` — real `draftEmail`
- Modify: `packages/ai/src/providers/anthropic.test.ts` — new test
- Modify: `packages/ai/src/providers/gemini.ts` — real `draftEmail`
- Modify: `packages/ai/src/providers/gemini.test.ts`
- Modify: `packages/ai/src/providers/grok.ts` — real `draftEmail`
- Modify: `packages/ai/src/providers/grok.test.ts`

- [ ] **Step 1: Extend prompts.ts with the draft-email prompt + parser**

Edit `packages/ai/src/providers/prompts.ts`. Append:

```typescript
import type { DraftEmailOutput } from '../provider.js';

export const DRAFT_EMAIL_SYSTEM = [
  'You are a sales-CRM email drafting assistant. Read the activity history and',
  'the user\'s intent below, then write a single email reply. Return a JSON object',
  'with exactly two keys: `subject` (concise, no quotes, no "Re:" prefix unless',
  'truly a reply) and `body` (plain text, 2–5 short paragraphs, no signature).',
  'Be specific, friendly, and assume the recipient already knows you.',
  'Return ONLY the JSON object — no prose, no markdown fences.',
].join(' ');

/**
 * Parse the model's draft-email JSON. Handles fences, naked JSON, garbage.
 * Throws on unparseable input (the caller should fall through to the next
 * provider in the chain).
 */
export function parseDraftEmailJson(raw: string): DraftEmailOutput {
  let candidate = raw;
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) candidate = fenceMatch[1];
  candidate = candidate.trim();
  const obj = JSON.parse(candidate) as Record<string, unknown>;
  if (typeof obj.subject !== 'string' || typeof obj.body !== 'string') {
    throw new Error('Model returned invalid draft email shape');
  }
  return { subject: obj.subject, body: obj.body };
}
```

The `import type { DraftEmailOutput }` line goes at the top of the file. The existing imports for `ExtractContactOutput` stay.

Note: unlike `parseExtractJson`, this one THROWS on bad input rather than returning a fallback object — because for email drafting an empty subject/body is useless, and we want the fallback chain to retry with the next provider.

- [ ] **Step 2: Write the failing tests (one per provider)**

In `packages/ai/src/providers/anthropic.test.ts`, append (inside the file, after the existing describes):

```typescript
describe('AnthropicAIProvider.draftEmail', () => {
  it('parses JSON into {subject, body}', async () => {
    const client = fakeClient(
      JSON.stringify({ subject: 'Hello Alice', body: 'Hi Alice,\nGreat to meet.' }),
    );
    const provider = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'claude-haiku-4-5',
    });
    const out = await provider.draftEmail({
      dealContext: { id: 'c1', summary: 'Met at SaaStr; asked for pricing.' },
      intent: 'follow up with pricing deck',
    });
    expect(out.subject).toBe('Hello Alice');
    expect(out.body).toMatch(/Hi Alice/);
  });

  it('throws when model returns malformed json', async () => {
    const client = fakeClient('not json at all');
    const provider = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'claude-haiku-4-5',
    });
    await expect(
      provider.draftEmail({
        dealContext: { id: 'c1', summary: 'x' },
        intent: 'y',
      }),
    ).rejects.toThrow();
  });
});
```

Run that test:

Run: `pnpm --filter @dealflow/ai test anthropic`

Expected: 5 prior PASS + 2 new tests FAIL (because draftEmail still throws AIDisabledError).

- [ ] **Step 3: Implement Anthropic's draftEmail**

Edit `packages/ai/src/providers/anthropic.ts`. Update the imports section to also import the new prompt helpers:

```typescript
import {
  SUMMARIZE_SYSTEM,
  EXTRACT_SYSTEM,
  DRAFT_EMAIL_SYSTEM,
  parseExtractJson,
  parseDraftEmailJson,
} from './prompts.js';
```

Replace the stub `draftEmail` method body with:

```typescript
  async draftEmail(input: DraftEmailInput): Promise<DraftEmailOutput> {
    const userMessage = `Context:\n${input.dealContext.summary}\n\nIntent:\n${input.intent}`;
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 800,
      system: DRAFT_EMAIL_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });
    return parseDraftEmailJson(extractText(res));
  }
```

Run: `pnpm --filter @dealflow/ai test anthropic`

Expected: 7/7 PASS.

- [ ] **Step 4: Repeat for Gemini**

In `packages/ai/src/providers/gemini.test.ts`, append:

```typescript
describe('GeminiAIProvider.draftEmail', () => {
  it('parses JSON into {subject, body}', async () => {
    const client = fakeClient(
      JSON.stringify({ subject: 'Hi Bob', body: 'Hi Bob,\nFollowing up.' }),
    );
    const provider = new GeminiAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'gemini-2.5-flash',
    });
    const out = await provider.draftEmail({
      dealContext: { id: 'c1', summary: 'history' },
      intent: 'follow up',
    });
    expect(out.subject).toBe('Hi Bob');
    expect(out.body).toMatch(/Bob/);
  });
});
```

In `packages/ai/src/providers/gemini.ts`, update imports:

```typescript
import {
  SUMMARIZE_SYSTEM,
  EXTRACT_SYSTEM,
  DRAFT_EMAIL_SYSTEM,
  parseExtractJson,
  parseDraftEmailJson,
} from './prompts.js';
```

Replace the stub `draftEmail` method body with:

```typescript
  async draftEmail(input: DraftEmailInput): Promise<DraftEmailOutput> {
    const userMessage = `Context:\n${input.dealContext.summary}\n\nIntent:\n${input.intent}`;
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: userMessage,
      config: { systemInstruction: DRAFT_EMAIL_SYSTEM, maxOutputTokens: 800 },
    });
    return parseDraftEmailJson(res.text ?? '');
  }
```

Run: `pnpm --filter @dealflow/ai test gemini`

Expected: 5/5 PASS (4 prior + 1 new).

- [ ] **Step 5: Repeat for Grok**

In `packages/ai/src/providers/grok.test.ts`, append:

```typescript
describe('GrokAIProvider.draftEmail', () => {
  it('parses JSON into {subject, body}', async () => {
    const client = fakeClient(
      JSON.stringify({ subject: 'Hey Carol', body: 'Hi Carol,\nChecking in.' }),
    );
    const provider = new GrokAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'grok-4',
    });
    const out = await provider.draftEmail({
      dealContext: { id: 'c1', summary: 'history' },
      intent: 'check in',
    });
    expect(out.subject).toBe('Hey Carol');
    expect(out.body).toMatch(/Carol/);
  });
});
```

In `packages/ai/src/providers/grok.ts`, update imports:

```typescript
import {
  SUMMARIZE_SYSTEM,
  EXTRACT_SYSTEM,
  DRAFT_EMAIL_SYSTEM,
  parseExtractJson,
  parseDraftEmailJson,
} from './prompts.js';
```

Replace the stub `draftEmail` method body with:

```typescript
  async draftEmail(input: DraftEmailInput): Promise<DraftEmailOutput> {
    const userMessage = `Context:\n${input.dealContext.summary}\n\nIntent:\n${input.intent}`;
    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 800,
      messages: [
        { role: 'system', content: DRAFT_EMAIL_SYSTEM },
        { role: 'user', content: userMessage },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('Grok returned an empty response');
    return parseDraftEmailJson(content);
  }
```

Run: `pnpm --filter @dealflow/ai test grok`

Expected: 5/5 PASS.

- [ ] **Step 6: Full AI package regression**

Run: `pnpm --filter @dealflow/ai test`

Expected: noop (4) + anthropic (7) + gemini (5) + grok (5) + fallback (7) + factory (5) = 33 tests, all passing.

- [ ] **Step 7: Verify typecheck**

Run: `pnpm --filter @dealflow/ai typecheck`

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/providers/prompts.ts packages/ai/src/providers/anthropic.ts packages/ai/src/providers/anthropic.test.ts packages/ai/src/providers/gemini.ts packages/ai/src/providers/gemini.test.ts packages/ai/src/providers/grok.ts packages/ai/src/providers/grok.test.ts
git commit -m "feat(ai): real draftEmail in Anthropic/Gemini/Grok providers"
```

---

### Task 8: API routes — POST /emails, GET /email/status, POST /ai/draft-email

**Files:**
- Create: `apps/api/src/modules/emails/routes.ts`
- Create: `apps/api/test/modules/emails/emails.routes.test.ts`
- Modify: `apps/api/src/modules/ai/routes.ts` — add `/ai/draft-email`
- Modify: `apps/api/test/modules/ai/ai.routes.test.ts` — add draft tests
- Modify: `apps/api/src/server.ts` — wire email provider + register routes
- Modify: `apps/api/test/helpers/build-app.ts` — accept `emailProvider`, `emailFrom`, `emailEnabled`

- [ ] **Step 1: Write the failing emails-route test**

Create `apps/api/test/modules/emails/emails.routes.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ResendEmailProvider } from '@dealflow/email';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

async function createContact(
  app: FastifyInstance,
  cookie: string,
  firstName: string,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    payload: { firstName, email },
    headers: { cookie },
  });
  return (res.json() as { contact: { id: string } }).contact.id;
}

function fakeResend(messageId = 'msg_test_123') {
  const client = {
    emails: {
      send: async () => ({ data: { id: messageId }, error: null }),
    },
  };
  return new ResendEmailProvider({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
  });
}

describe('GET /api/v1/email/status', () => {
  it('reports disabled when no email provider wired', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email/status',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; from: string | null };
    expect(body.enabled).toBe(false);
    expect(body.from).toBeNull();
    await app.close();
    await testDb.stop();
  });

  it('reports enabled + from when provider wired', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProvider: fakeResend(),
      emailEnabled: true,
      emailFrom: 'DealFlow <noreply@dealflow.app>',
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email/status',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; from: string };
    expect(body.enabled).toBe(true);
    expect(body.from).toBe('DealFlow <noreply@dealflow.app>');
    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/emails', () => {
  it('503 EMAIL_DISABLED when no provider wired', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice', 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: { contactId, subject: 'hi', body: 'hello' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EMAIL_DISABLED');
    await app.close();
    await testDb.stop();
  });

  it('400 when contact has no email address', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProvider: fakeResend(),
      emailEnabled: true,
      emailFrom: 'DealFlow <noreply@dealflow.app>',
    });
    const { cookie } = await signupTestUser(app);
    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'NoEmail' },
      headers: { cookie },
    });
    const contactId = (contactRes.json() as { contact: { id: string } }).contact.id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: { contactId, subject: 'hi', body: 'hello' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CONTACT_HAS_NO_EMAIL');
    await app.close();
    await testDb.stop();
  });

  it('404 when contact does not exist in this org', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProvider: fakeResend(),
      emailEnabled: true,
      emailFrom: 'DealFlow <noreply@dealflow.app>',
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: {
        contactId: '00000000-0000-0000-0000-000000000001',
        subject: 'hi',
        body: 'hello',
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
    await testDb.stop();
  });

  it('201 — sends email, returns activity with kind=email + subject + externalId', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProvider: fakeResend('msg_canned_xyz'),
      emailEnabled: true,
      emailFrom: 'DealFlow <noreply@dealflow.app>',
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice', 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: {
        contactId,
        subject: 'Re: pricing',
        body: 'Hi Alice, here is pricing.',
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      activity: {
        kind: string;
        subject: string | null;
        body: string;
        externalId: string | null;
      };
    };
    expect(body.activity.kind).toBe('email');
    expect(body.activity.subject).toBe('Re: pricing');
    expect(body.activity.body).toBe('Hi Alice, here is pricing.');
    expect(body.activity.externalId).toBe('msg_canned_xyz');
    await app.close();
    await testDb.stop();
  });

  it('400 when validation fails (empty subject)', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProvider: fakeResend(),
      emailEnabled: true,
      emailFrom: 'DealFlow <noreply@dealflow.app>',
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice', 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: { contactId, subject: '', body: 'hello' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });

  it('502 EMAIL_UPSTREAM_ERROR when provider throws', async () => {
    const failingClient = {
      emails: {
        send: async () => {
          throw new Error('upstream boom');
        },
      },
    };
    const failingProvider = new ResendEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: failingClient as any,
    });
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProvider: failingProvider,
      emailEnabled: true,
      emailFrom: 'DealFlow <noreply@dealflow.app>',
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice', 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: { contactId, subject: 'hi', body: 'hello' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EMAIL_UPSTREAM_ERROR');
    await app.close();
    await testDb.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/api test emails.routes`

Expected: FAIL — routes not registered.

- [ ] **Step 3: Extend buildTestApp**

Edit `apps/api/test/helpers/build-app.ts`. Read it first to see the existing shape, then extend the options interface:

```typescript
import type { EmailProvider } from '@dealflow/email';
// (keep existing imports)

export interface BuildTestAppOptions {
  db?: Database;
  aiProvider?: AIProvider;
  aiChainDescription?: Array<{ name: string; model: string }>;
  // NEW:
  emailProvider?: EmailProvider;
  emailFrom?: string;
  emailEnabled?: boolean;
}
```

Forward the new options to `buildApp(...)`.

- [ ] **Step 4: Implement the routes**

Create `apps/api/src/modules/emails/routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { type EmailProvider, EmailDisabledError } from '@dealflow/email';
import type { Database, schema as schemaType } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { ERROR_CODES, sendEmailBodySchema } from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ActivitiesRepo } from '../activities/activities.repo.js';

export interface EmailRoutesDeps {
  db: Database;
  emailProvider: EmailProvider;
  /** Pre-formatted "Name <email>" from line. Null when disabled. */
  emailFrom: string | null;
  /** Whether `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are both set. */
  emailEnabled: boolean;
}

function publicActivity(row: typeof schemaType.activities.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    subject: row.subject,
    externalId: row.externalId,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    contactId: row.contactId,
    companyId: row.companyId,
    dealId: row.dealId,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function emailDisabled(reply: import('fastify').FastifyReply) {
  return reply.status(503).send({
    error: {
      code: 'EMAIL_DISABLED',
      message: 'Email is not configured on this DealFlow instance.',
    },
  });
}

function emailUpstreamError(reply: import('fastify').FastifyReply) {
  return reply.status(502).send({
    error: { code: 'EMAIL_UPSTREAM_ERROR', message: 'Email provider request failed.' },
  });
}

export async function registerEmailRoutes(
  app: FastifyInstance,
  deps: EmailRoutesDeps,
): Promise<void> {
  const activities = new ActivitiesRepo(deps.db);

  app.get('/api/v1/email/status', { preHandler: requireOrg }, async (_req, reply) => {
    return reply.send({ enabled: deps.emailEnabled, from: deps.emailFrom });
  });

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
    if (!deps.emailEnabled || !deps.emailFrom) return emailDisabled(reply);

    const orgId = req.session!.currentOrgId!;
    const userId = req.user!.id;

    // Fetch the recipient contact (org-scoped).
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
        error: {
          code: 'CONTACT_HAS_NO_EMAIL',
          message: 'This contact has no email address on file. Add one before sending.',
        },
      });
    }

    // Fetch the sender's display name + email for the from + reply-to lines.
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

    // Personalised from: "Alice via DealFlow <noreply@dealflow.app>".
    const personalisedFrom = `${userRow.name} via ${deps.emailFrom}`;

    try {
      const result = await deps.emailProvider.send({
        from: personalisedFrom,
        to: contactRow.email,
        replyTo: userRow.email,
        subject: parsed.data.subject,
        text: parsed.data.body,
      });
      const created = await activities.create(orgId, userId, {
        kind: 'email',
        body: parsed.data.body,
        contactId: parsed.data.contactId,
      });
      // Stamp the email-specific fields. Repo.create doesn't accept subject/externalId
      // directly — bump them via a direct UPDATE so we keep the repo surface lean.
      const [updated] = await deps.db
        .update(schema.activities)
        .set({ subject: parsed.data.subject, externalId: result.messageId, updatedAt: new Date() })
        .where(eq(schema.activities.id, created.id))
        .returning();
      return reply.status(201).send({ activity: publicActivity(updated ?? created) });
    } catch (err) {
      if (err instanceof EmailDisabledError) return emailDisabled(reply);
      req.log.error({ err }, 'POST /emails failed');
      return emailUpstreamError(reply);
    }
  });
}
```

NOTE on the `create + update` two-step: the existing `ActivitiesRepo.create` (from Sub-Plan 5) doesn't take `subject`/`externalId` parameters, and extending its signature would touch every other call site. Keeping the two-step here is intentional — it isolates email-specific column writes to this route file. Future cleanup: widen `ActivitiesRepo.create` to accept the optional fields and consolidate.

- [ ] **Step 5: Add POST /ai/draft-email**

Edit `apps/api/src/modules/ai/routes.ts`. Append imports:

```typescript
import { draftEmailBodySchema } from '@dealflow/shared';
```

Inside `registerAIRoutes`, after the existing extract-contact route, add:

```typescript
  app.post('/api/v1/ai/draft-email', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = draftEmailBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid draft-email payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    if (!enabled) return aiDisabled(reply);

    const orgId = req.session!.currentOrgId!;
    const ok = await parentExistsInOrg(deps.db, orgId, { contactId: parsed.data.contactId });
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' } });
    }

    // Build context from this contact's activity history (same shape as summarize).
    const rows = await activities.listForParent(orgId, { contactId: parsed.data.contactId });
    const context = rows.length === 0
      ? 'No prior activity with this contact yet.'
      : rows
          .slice(0, 50)
          .map(
            (a) => `[${a.createdAt.toISOString().slice(0, 10)}] [${a.kind}] ${a.body}`,
          )
          .join('\n');

    try {
      const out = await deps.aiProvider.draftEmail({
        dealContext: { id: parsed.data.contactId, summary: context },
        intent: parsed.data.intent,
      });
      return reply.send({ subject: out.subject, body: out.body });
    } catch (err) {
      if (err instanceof AIDisabledError) return aiDisabled(reply);
      req.log.error({ err }, 'ai/draft-email: all providers failed');
      return aiUpstreamError(reply);
    }
  });
```

- [ ] **Step 6: Extend AI route tests to cover draft-email**

Edit `apps/api/test/modules/ai/ai.routes.test.ts`. Append a new describe block (the `fakeAnthropic`, `createContact` helpers are already defined in this file):

```typescript
describe('POST /api/v1/ai/draft-email', () => {
  it('returns 503 with AI_DISABLED when chain is empty', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/draft-email',
      payload: { contactId, intent: 'follow up' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AI_DISABLED');
    await app.close();
    await testDb.stop();
  });

  it('200 with subject + body on success', async () => {
    const testDb = await startTestPostgres();
    const draftJson = JSON.stringify({ subject: 'Hello Alice', body: 'Hi Alice,\nFollowing up.' });
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic(draftJson)]),
      aiChainDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/draft-email',
      payload: { contactId, intent: 'follow up' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { subject: string; body: string };
    expect(body.subject).toBe('Hello Alice');
    expect(body.body).toMatch(/Alice/);
    await app.close();
    await testDb.stop();
  });

  it('404 when contact not in org', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic(JSON.stringify({ subject: 's', body: 'b' }))]),
      aiChainDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/draft-email',
      payload: { contactId: '00000000-0000-0000-0000-000000000001', intent: 'x' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
    await testDb.stop();
  });

  it('400 when intent is missing', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/draft-email',
      payload: { contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });
});
```

- [ ] **Step 7: Wire the email provider in `server.ts`**

Read `apps/api/src/server.ts` first. Add imports:

```typescript
import { buildEmailProvider, describeEmail, type EmailProvider } from '@dealflow/email';
```

Extend `BuildAppOptions`:

```typescript
export interface BuildAppOptions {
  env: Env;
  db?: Database;
  aiProvider?: AIProvider;
  aiChainDescription?: Array<{ name: string; model: string }>;
  emailProvider?: EmailProvider;
  emailFrom?: string;
  emailEnabled?: boolean;
}
```

Inside `buildApp`, after the AI routes registration (and before the build returns), wire email:

```typescript
const emailConfig = {
  apiKey: opts.env.RESEND_API_KEY,
  from: opts.env.RESEND_FROM_EMAIL,
  name: opts.env.RESEND_FROM_NAME,
};
const emailProvider = opts.emailProvider ?? buildEmailProvider(emailConfig);
const emailDescription = describeEmail(emailConfig);
const emailEnabled = opts.emailEnabled ?? emailDescription.provider !== 'none';
const emailFrom = opts.emailFrom ?? emailDescription.from;

const { registerEmailRoutes } = await import('./modules/emails/routes.js');
await registerEmailRoutes(app, {
  db: opts.db!,
  emailProvider,
  emailFrom,
  emailEnabled,
});
```

Wrap inside the `if (opts.db)` block so registration only runs when DB is provided (mirroring activities/AI).

- [ ] **Step 8: Run the email + AI route tests**

Run: `pnpm --filter @dealflow/api test emails.routes`

Expected: 8/8 PASS.

Run: `pnpm --filter @dealflow/api test ai.routes`

Expected: prior tests + 4 new draft-email tests, all passing.

- [ ] **Step 9: Full API regression**

Run: `pnpm --filter @dealflow/api test`

Expected: all passing.

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter @dealflow/api typecheck`

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/emails apps/api/test/modules/emails apps/api/src/modules/ai/routes.ts apps/api/test/modules/ai/ai.routes.test.ts apps/api/src/server.ts apps/api/test/helpers/build-app.ts
git commit -m "feat(api): email send + status + ai-draft-email routes"
```

---

### Task 9: Web hooks — useEmailStatus, useSendEmail, useDraftEmail

**Files:**
- Modify: `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/features/emails/api.ts`

- [ ] **Step 1: Add the emails key namespace**

Edit `apps/web/src/lib/query-keys.ts`. Inside the existing `queryKeys` object, after the `ai` namespace, add:

```typescript
  emails: {
    status: ['emails', 'status'] as const,
  },
```

- [ ] **Step 2: Build the hooks**

Create `apps/web/src/features/emails/api.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DraftEmailBodyInput,
  DraftEmailResponse,
  PublicActivity,
  PublicEmailStatus,
  SendEmailInput,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

interface SendEmailResponse {
  activity: PublicActivity;
}

export function useEmailStatus() {
  return useQuery({
    queryKey: queryKeys.emails.status,
    queryFn: () => apiFetch<PublicEmailStatus>('/api/v1/email/status'),
    staleTime: Infinity,
  });
}

export function useSendEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendEmailInput) =>
      apiFetch<SendEmailResponse>('/api/v1/emails', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      // The new activity belongs to a contact — invalidate that feed.
      const contactId = data.activity.contactId;
      if (contactId) {
        qc.invalidateQueries({ queryKey: ['activities', 'contact', contactId] });
      }
    },
  });
}

export function useDraftEmail() {
  return useMutation({
    mutationFn: (input: DraftEmailBodyInput) =>
      apiFetch<DraftEmailResponse>('/api/v1/ai/draft-email', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/query-keys.ts apps/web/src/features/emails/api.ts
git commit -m "feat(web): email query hooks (status, send, ai-draft)"
```

---

### Task 10: ComposeEmailDialog component (with AI Draft button)

**Files:**
- Create: `apps/web/src/features/emails/compose-email-dialog.tsx`

- [ ] **Step 1: Build the compose dialog**

Create `apps/web/src/features/emails/compose-email-dialog.tsx`:

```typescript
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAIStatus } from '@/features/ai/api';
import { useDraftEmail, useSendEmail } from './api';

interface ComposeEmailDialogProps {
  contactId: string;
  /** Display name for the recipient — used only in the dialog title. */
  recipientName: string;
  /** Email address — used to show the operator who they're emailing. */
  recipientEmail: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Dialog that sends an email to a single contact. Optional AI Draft button
 * (visible when AI is enabled) generates a subject + body from a short intent
 * string the user types.
 */
export function ComposeEmailDialog({
  contactId,
  recipientName,
  recipientEmail,
  trigger,
  open,
  onOpenChange,
}: ComposeEmailDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [intent, setIntent] = useState('');
  const [showDraftPanel, setShowDraftPanel] = useState(false);

  const send = useSendEmail();
  const draft = useDraftEmail();
  const aiStatus = useAIStatus();

  async function onDraft() {
    const trimmed = intent.trim();
    if (!trimmed) return;
    const res = await draft.mutateAsync({ contactId, intent: trimmed });
    setSubject(res.subject);
    setBody(res.body);
    setShowDraftPanel(false);
    setIntent('');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    await send.mutateAsync({ contactId, subject: subject.trim(), body: body.trim() });
    setSubject('');
    setBody('');
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email {recipientName}</DialogTitle>
          <p className="text-xs text-neutral-500">{recipientEmail}</p>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {aiStatus.data?.enabled && (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowDraftPanel((v) => !v)}
                className="text-xs font-medium text-amber-700 hover:text-amber-900"
                data-testid="ai-draft-toggle"
              >
                {showDraftPanel ? 'Hide AI draft' : '✨ AI draft'}
              </button>
            </div>
          )}
          {showDraftPanel && (
            <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <Label htmlFor="intent" className="text-amber-900">
                What should the email do?
              </Label>
              <Input
                id="intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="e.g. follow up on the pricing discussion"
                data-testid="ai-draft-intent"
              />
              <Button
                type="button"
                size="sm"
                onClick={onDraft}
                disabled={!intent.trim() || draft.isPending}
              >
                {draft.isPending ? 'Drafting…' : 'Draft with AI'}
              </Button>
              {draft.isError && (
                <p className="text-sm text-red-600">Couldn't draft — please try again.</p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
              data-testid="email-subject"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email-body">Message</Label>
            <textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              data-testid="email-body"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="submit" disabled={!subject.trim() || !body.trim() || send.isPending}>
              {send.isPending ? 'Sending…' : 'Send email'}
            </Button>
          </div>
          {send.isError && (
            <p className="text-sm text-red-600">Couldn't send — please try again.</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck && pnpm --filter @dealflow/web build`

Expected: no errors. Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/emails/compose-email-dialog.tsx
git commit -m "feat(web): ComposeEmailDialog with AI draft toggle"
```

---

### Task 11: Email button on contact detail page + email-kind rendering in ActivityFeed

**Files:**
- Modify: `apps/web/src/routes/app.contacts.$id.tsx`
- Modify: `apps/web/src/features/activities/activity-feed.tsx`

- [ ] **Step 1: Add Email button to the contact detail page**

Read `apps/web/src/routes/app.contacts.$id.tsx` first. It currently renders the contact's name + fields + an `<ActivityFeed parent={{ contactId: c.id }} />`.

Add the import:

```typescript
import { ComposeEmailDialog } from '@/features/emails/compose-email-dialog';
import { useEmailStatus } from '@/features/emails/api';
import { Button } from '@/components/ui/button';
```

Inside the `ContactDetailPage` component (after the existing data hook calls, before the JSX), add:

```typescript
const emailStatus = useEmailStatus();
```

Where the contact's name renders (typically a `<h1>`), add a button row immediately below it that conditionally shows the Email button when:
1. Email is enabled (`emailStatus.data?.enabled === true`)
2. The contact actually has an email address (`c.email !== null`)

The button uses the dialog's `trigger` prop:

```tsx
{emailStatus.data?.enabled && c.email && (
  <div className="mt-2 mb-4">
    <ComposeEmailDialog
      contactId={c.id}
      recipientName={`${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`}
      recipientEmail={c.email}
      trigger={
        <Button variant="outline" size="sm" data-testid="email-contact">
          ✉️ Email
        </Button>
      }
    />
  </div>
)}
```

Adjust the surrounding JSX to slot this in between the heading and the existing content. Match the file's existing layout patterns.

- [ ] **Step 2: Render email-kind activities in ActivityFeed**

Read `apps/web/src/features/activities/activity-feed.tsx`. The existing `ActivityRow` switches on `activity.kind === 'task'` (TaskItem) vs default (note). Add a third branch for emails.

Update `ActivityRow` to handle three kinds:

```tsx
function ActivityRow({ activity, onToggleDone, onDelete }: ActivityRowProps) {
  if (activity.kind === 'task') {
    return (
      <TaskItem
        task={activity}
        onToggleDone={(id, patch) =>
          onToggleDone(id, patch as { status: 'open' | 'done' })
        }
        onDelete={onDelete}
      />
    );
  }
  if (activity.kind === 'email') {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700">
            ✉️ Email sent
          </p>
          {activity.subject && (
            <p className="mt-0.5 text-sm font-medium text-neutral-900">{activity.subject}</p>
          )}
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{activity.body}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {new Date(activity.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onDelete(activity.id)}
          className="text-xs text-neutral-400 hover:text-red-600"
          aria-label="Delete email"
        >
          ✕
        </button>
      </div>
    );
  }
  // Default: note
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm text-neutral-800">{activity.body}</p>
        <p className="mt-1 text-xs text-neutral-500">
          Note · {new Date(activity.createdAt).toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void onDelete(activity.id)}
        className="text-xs text-neutral-400 hover:text-red-600"
        aria-label="Delete note"
      >
        ✕
      </button>
    </div>
  );
}
```

The existing note branch stays — we just added an email branch before it.

- [ ] **Step 3: Verify typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck && pnpm --filter @dealflow/web build`

Expected: no errors. Build succeeds.

- [ ] **Step 4: Manual smoke test**

Restart `pnpm dev` (so the API picks up `RESEND_API_KEY` if you've added one). Open a contact who has an email address (or edit one to add an email). You should see an `✉️ Email` button. Click it → compose → send. The new activity should appear in the feed with the blue ✉️ Email sent header and the subject in bold.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/app.contacts.$id.tsx apps/web/src/features/activities/activity-feed.tsx
git commit -m "feat(web): Email button on contact + render email-kind in ActivityFeed"
```

---

### Task 12: Email status section in Settings

**Files:**
- Modify: `apps/web/src/routes/app.settings.tsx`

- [ ] **Step 1: Add the Email status section**

Read `apps/web/src/routes/app.settings.tsx`. After the existing "AI features" section, add:

Add the import:

```typescript
import { useEmailStatus } from '@/features/emails/api';
```

Inside the `SettingsForm` component body, after the existing `aiStatus = useAIStatus();` line, add:

```typescript
const emailStatus = useEmailStatus();
```

After the existing AI features `<section>`, add:

```tsx
<section className="mt-4 rounded-md border border-neutral-200 p-4">
  <h2 className="mb-3 text-base font-medium">Email</h2>
  {emailStatus.isPending && <p className="text-sm text-neutral-500">Checking…</p>}
  {emailStatus.data?.enabled ? (
    <p className="text-sm text-neutral-700">
      <span className="font-medium text-green-700">Enabled</span> · sending as{' '}
      <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">
        {emailStatus.data.from}
      </code>
    </p>
  ) : (
    emailStatus.data && (
      <p className="text-sm text-neutral-700">
        <span className="font-medium text-neutral-500">Disabled</span> — set{' '}
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">RESEND_API_KEY</code>{' '}
        and{' '}
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">RESEND_FROM_EMAIL</code>{' '}
        in <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">apps/api/.env</code>{' '}
        (and verify the domain in your Resend dashboard) to enable.
      </p>
    )
  )}
</section>
```

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck && pnpm --filter @dealflow/web build`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/app.settings.tsx
git commit -m "feat(web): Email status section on Settings page"
```

---

### Task 13: Validation + plan doc commit + push + tag

**Files:** none (verification only)

- [ ] **Step 1: Format**

Run: `pnpm format`

If files reformat, commit as `style: format` before proceeding.

- [ ] **Step 2: Lint**

Run: `pnpm lint`

Expected: clean.

- [ ] **Step 3: Typecheck (all workspaces)**

Run: `pnpm typecheck`

Expected: clean.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`

Expected: prior 240+ + new from this sub-plan (~30+), all passing.

- [ ] **Step 5: Commit the plan doc**

```bash
git add docs/superpowers/plans/2026-05-22-dealflow-phase-1-sub-plan-2b-email.md
git commit -m "chore(docs): add sub-plan 2b (email + ai-draft) implementation plan"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

- [ ] **Step 7: Tag**

```bash
git tag -a sub-plan-2b-email -m "Sub-Plan 2b: CRM email (outbound) + AI-drafted replies"
git push origin sub-plan-2b-email
```

- [ ] **Step 8: Optional smoke test**

If you have a real Resend API key + verified domain:

1. Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, optionally `RESEND_FROM_NAME` in `apps/api/.env`
2. Restart `pnpm dev`
3. Visit `/app/settings` — Email section should say "Enabled · sending as DealFlow <noreply@...>"
4. Open a contact with an email address, click ✉️ Email, compose + send
5. Check your inbox at the recipient's address — the email arrived with the personalised From line + your user email in Reply-To
6. Refresh the contact's page — the email shows in the activity feed

If anything breaks, the prompt and parser live in `packages/ai/src/providers/prompts.ts` and the route in `apps/api/src/modules/emails/routes.ts`.

---

## Self-Review (executed by plan author)

**Spec coverage:**
- "Send emails directly from a contact's page" → Tasks 10 (dialog) + 11 (button on contact) ✓
- "Log emails as activities" → Task 8 (POST /emails creates activity with kind=email) ✓
- "Email as 3rd activity kind" → Task 1 (schema + types) + Task 11 (render in feed) ✓
- "AI-drafted email replies" → Task 7 (provider impls) + Task 8 (route) + Task 10 (UI button) ✓
- "Hide UI when disabled" → Tasks 10/11/12 all gate on `emailStatus.data?.enabled` ✓

**Placeholder scan:** No "TBD" / "implement later" / hand-waving. Every code block is concrete.

**Type consistency:**
- `kind: 'email'` is added to `ACTIVITY_KINDS` in Task 1 and read by Task 11's renderer.
- `PublicActivity.subject` and `PublicActivity.externalId` are defined in Task 1 (shared) and populated in Task 8's `publicActivity` mapper.
- `SendEmailInput` is defined in Task 6, consumed by Task 9 (hook) and Task 10 (dialog calls hook).
- `DraftEmailBodyInput` defined in Task 6, consumed by Task 9 + Task 10.
- `PublicEmailStatus` shape `{ enabled, from }` is identical in Task 6 (shared), Task 8 (route response), Task 9 (hook), Task 12 (Settings consumer).
- `EmailProvider` interface defined in Task 2, implemented by Task 2 (Noop) and Task 3 (Resend), consumed by Task 8 (route).
- All three providers' `draftEmail` (Task 7) return `{ subject, body }` matching `DraftEmailOutput` from `packages/ai/src/provider.ts`.

**Known follow-ups (deliberately out of scope):**
1. Inbound emails (BCC-to-CRM, Resend webhooks).
2. Multi-recipient (TO + CC + BCC).
3. Attachments.
4. HTML editor.
5. Email templates (saved snippets).
6. Per-user / per-org sending identity (currently one From per deployment).
7. Email opens / clicks tracking.
8. Widening `ActivitiesRepo.create` to accept `subject`/`externalId` directly so Task 8 doesn't need the create-then-update two-step.
