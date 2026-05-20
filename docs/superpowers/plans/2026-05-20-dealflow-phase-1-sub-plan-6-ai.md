# DealFlow Phase 1 Sub-Plan 6: AI Features (Multi-Provider Fallback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first user-facing AI features in DealFlow — AI-summarized activity history on every contact/company/deal, and AI-extracted contact details from pasted text — with a multi-provider fallback chain (Claude → Gemini → Grok) so a single provider outage never knocks AI offline.

**Architecture:** Three real provider implementations — `AnthropicAIProvider`, `GeminiAIProvider`, `GrokAIProvider` — each implements the existing `AIProvider` interface. A new `FallbackAIProvider` wraps an ordered array of providers and re-tries each method down the chain on any thrown error. The factory builds the chain dynamically from env: only providers whose API key is set are included, always in the order Claude → Gemini → Grok. If no keys are set, the chain is empty and AI routes return 503 with a friendly message. Three new API routes (`/ai/status`, `/ai/summarize-activity`, `/ai/extract-contact`) call the chain. Frontend gets a "Summarize" button in `ActivityFeed`, a "Paste from text" toggle in `CreateContactDialog`, and an AI status section on `/app/settings` showing which providers are active.

**Tech Stack:** `@anthropic-ai/sdk`, `@google/genai`, `openai` (used as an OpenAI-compatible client pointed at xAI's endpoint for Grok). Fastify routes with zod validation, TanStack Query hooks. No DB schema changes.

**Scope decisions:**
- **Three providers, dynamic chain**: each provider participates if its key is present; the chain order is hardcoded Claude → Gemini → Grok. A user with only an Anthropic key gets Claude-only behavior. A user with all three gets full failover.
- **Failover triggers on any thrown error** from the upstream provider — rate-limit (429), upstream 5xx, network/timeout, parse errors all count. The fallback wrapper logs the failure with provider name + method so debugging is straightforward.
- **Two user-facing features in v1**: activity-summary + contact-extraction. The `AIProvider` interface also declares `draftEmail` and `nlFilter` — those stay in the interface but the real implementations throw `AIDisabledError` (so the chain skips past them too). Real implementations land in later sub-plans.
- **API keys in env, not per-org**: One set of keys per deployment. Per-org keys with encrypted storage defer to a later sub-plan.
- **No quota tracking in v1**: providers' own 429s drive the failover; surface as 503 only when ALL providers in the chain fail.
- **Activity summary context cap**: most-recent 50 activities, ≤4000 chars combined.
- **AI status is org-agnostic**: `/api/v1/ai/status` reflects env config across the whole deployment.

---

## File Structure

### New files
- `packages/ai/src/providers/anthropic.ts` — Claude implementation
- `packages/ai/src/providers/anthropic.test.ts`
- `packages/ai/src/providers/gemini.ts` — Google Gemini implementation
- `packages/ai/src/providers/gemini.test.ts`
- `packages/ai/src/providers/grok.ts` — xAI Grok implementation (OpenAI-compatible API)
- `packages/ai/src/providers/grok.test.ts`
- `packages/ai/src/providers/fallback.ts` — try-providers-in-order wrapper
- `packages/ai/src/providers/fallback.test.ts`
- `packages/ai/src/factory.ts` — env-driven chain assembly
- `packages/ai/src/factory.test.ts`
- `packages/shared/src/ai.ts` — public types + zod schemas for AI routes
- `apps/api/src/modules/ai/routes.ts` — GET status, POST summarize-activity, POST extract-contact
- `apps/api/test/modules/ai/ai.routes.test.ts`
- `apps/web/src/features/ai/api.ts` — TanStack Query hooks

### Modified files
- `packages/ai/package.json` — add `@anthropic-ai/sdk`, `@google/genai`, `openai`
- `packages/ai/src/index.ts` — export factory + providers + fallback
- `packages/shared/src/index.ts` — re-export `ai.ts`
- `apps/api/src/env.ts` — add 3 API-key vars + 3 model vars
- `apps/api/src/server.ts` — wire chain, register AI routes
- `apps/api/test/helpers/build-app.ts` — accept optional AI provider override for tests
- `apps/api/.env` — commented AI block (self-host friendly)
- `apps/web/src/lib/query-keys.ts` — add `ai` key namespace
- `apps/web/src/features/activities/activity-feed.tsx` — Summarize button + result display
- `apps/web/src/features/contacts/create-contact-dialog.tsx` — "Paste from text" mode
- `apps/web/src/routes/app.settings.tsx` — AI status section showing the chain

---

## API surface

| Method | Path                            | Purpose                                                                                                |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/ai/status`             | `{ enabled: boolean, providers: Array<{name, model}> }` — reflects the chain order                     |
| POST   | `/api/v1/ai/summarize-activity` | Body: one of `{contactId}` / `{companyId}` / `{dealId}` → `{ summary: string }`                        |
| POST   | `/api/v1/ai/extract-contact`    | Body: `{ text: string }` (1–10000 chars) → `{ extracted: { firstName?, lastName?, ... } }`             |

All routes require `requireOrg`. When the chain is empty (no provider keys set), POSTs return 503 `{ error: { code: 'AI_DISABLED', message: 'AI is not configured on this DealFlow instance.' } }`. GET status always returns 200.

When all chain providers fail (e.g. all upstreams down or all keys invalid), POSTs return 502 `{ error: { code: 'AI_UPSTREAM_ERROR', message: 'AI provider request failed.' } }`.

---

### Task 1: Add provider SDK dependencies

**Files:**
- Modify: `packages/ai/package.json`

- [ ] **Step 1: Add the three SDKs**

Replace `packages/ai/package.json` with:

```json
{
  "name": "@dealflow/ai",
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
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@google/genai": "^0.7.0",
    "openai": "^4.71.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

The `openai` SDK is used for Grok via xAI's OpenAI-compatible endpoint (just override `baseURL`).

- [ ] **Step 2: Install + lockfile update**

Run: `pnpm install`

Expected: lockfile updates, three new `node_modules/...` directories.

- [ ] **Step 3: Verify typecheck still passes**

Run: `pnpm --filter @dealflow/ai typecheck`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/package.json pnpm-lock.yaml
git commit -m "feat(ai): add SDK deps (anthropic, google/genai, openai-for-grok)"
```

---

### Task 2: AnthropicAIProvider

**Files:**
- Create: `packages/ai/src/providers/anthropic.ts`
- Create: `packages/ai/src/providers/anthropic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/providers/anthropic.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { AnthropicAIProvider } from './anthropic.js';
import { AIDisabledError } from '../provider.js';

function fakeClient(textResponse: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: textResponse }],
      }),
    },
  };
}

describe('AnthropicAIProvider.summarizeNote', () => {
  it('returns trimmed summary from model output', async () => {
    const client = fakeClient('  Alice met us at SaaStr.  \n');
    const provider = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'claude-haiku-4-5',
    });
    const out = await provider.summarizeNote({ text: 'history...' });
    expect(out.summary).toBe('Alice met us at SaaStr.');
    const call = client.messages.create.mock.calls[0]![0]!;
    expect(call.model).toBe('claude-haiku-4-5');
    expect(JSON.stringify(call.messages)).toContain('history...');
  });
});

describe('AnthropicAIProvider.extractContact', () => {
  it('parses JSON into structured fields', async () => {
    const json = JSON.stringify({
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@acme.com',
    });
    const client = fakeClient(json);
    const provider = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'claude-haiku-4-5',
    });
    const out = await provider.extractContact({ text: 'Alice Smith\nalice@acme.com' });
    expect(out.firstName).toBe('Alice');
    expect(out.email).toBe('alice@acme.com');
  });

  it('handles fenced JSON response', async () => {
    const client = fakeClient('```json\n{"firstName":"Bob"}\n```');
    const provider = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'claude-haiku-4-5',
    });
    const out = await provider.extractContact({ text: 'Bob' });
    expect(out.firstName).toBe('Bob');
  });

  it('returns empty object for unparseable output', async () => {
    const client = fakeClient('I cannot find any contact info.');
    const provider = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'claude-haiku-4-5',
    });
    const out = await provider.extractContact({ text: 'random' });
    expect(out).toEqual({});
  });
});

describe('AnthropicAIProvider deferred methods', () => {
  it('draftEmail + nlFilter throw AIDisabledError', async () => {
    const provider = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { messages: { create: vi.fn() } } as any,
      model: 'claude-haiku-4-5',
    });
    await expect(
      provider.draftEmail({ dealContext: { id: 'x', summary: 'y' }, intent: 'z' }),
    ).rejects.toBeInstanceOf(AIDisabledError);
    await expect(provider.nlFilter({ query: 'x', entity: 'deals' })).rejects.toBeInstanceOf(
      AIDisabledError,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/ai test anthropic`

Expected: FAIL — `Cannot find module './anthropic.js'`.

- [ ] **Step 3: Implement**

Create `packages/ai/src/providers/anthropic.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import {
  AIDisabledError,
  type AIProvider,
  type DraftEmailInput,
  type DraftEmailOutput,
  type ExtractContactInput,
  type ExtractContactOutput,
  type NlFilterInput,
  type NlFilterOutput,
  type SummarizeNoteInput,
  type SummarizeNoteOutput,
} from '../provider.js';
import { SUMMARIZE_SYSTEM, EXTRACT_SYSTEM, parseExtractJson } from './prompts.js';

export interface AnthropicAIProviderOptions {
  client: Anthropic;
  model: string;
}

export class AnthropicAIProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicAIProviderOptions) {
    this.client = opts.client;
    this.model = opts.model;
  }

  async summarizeNote(input: SummarizeNoteInput): Promise<SummarizeNoteOutput> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system: SUMMARIZE_SYSTEM,
      messages: [{ role: 'user', content: input.text }],
    });
    return { summary: extractText(res).trim() };
  }

  async extractContact(input: ExtractContactInput): Promise<ExtractContactOutput> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 400,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: input.text }],
    });
    return parseExtractJson(extractText(res));
  }

  async draftEmail(_input: DraftEmailInput): Promise<DraftEmailOutput> {
    throw new AIDisabledError();
  }
  async nlFilter(_input: NlFilterInput): Promise<NlFilterOutput> {
    throw new AIDisabledError();
  }
}

function extractText(res: { content: Array<{ type: string; text?: string }> }): string {
  for (const block of res.content) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}
```

- [ ] **Step 4: Create the shared prompts + parser helper**

Create `packages/ai/src/providers/prompts.ts` (used by all three providers — DRY):

```typescript
import type { ExtractContactOutput } from '../provider.js';

export const SUMMARIZE_SYSTEM = [
  'You are a CRM assistant. Read the activity history below and write a concise summary',
  'in 2–4 sentences covering: who the contact is, what we have discussed, and what the',
  'current state is. No preamble, no markdown — just the summary as plain text.',
].join(' ');

export const EXTRACT_SYSTEM = [
  'You are a contact-extraction tool. Read the text below (often an email signature, a',
  'LinkedIn snippet, or a freeform paste) and return a single JSON object with these',
  'optional keys: firstName, lastName, email, phone, title, companyName. Omit any key',
  'you cannot confidently extract. Return ONLY the JSON object — no prose, no markdown',
  'fences. If you cannot extract anything, return {}.',
].join(' ');

/**
 * Parse the model's JSON response. Handles unfenced JSON, ```json fences, or garbage
 * (returns {}). Used by all three providers since model outputs vary in format.
 */
export function parseExtractJson(raw: string): ExtractContactOutput {
  let candidate = raw;
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) candidate = fenceMatch[1];
  candidate = candidate.trim();
  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>;
    const out: ExtractContactOutput = {};
    if (typeof obj.firstName === 'string') out.firstName = obj.firstName;
    if (typeof obj.lastName === 'string') out.lastName = obj.lastName;
    if (typeof obj.email === 'string') out.email = obj.email;
    if (typeof obj.phone === 'string') out.phone = obj.phone;
    if (typeof obj.title === 'string') out.title = obj.title;
    if (typeof obj.companyName === 'string') out.companyName = obj.companyName;
    return out;
  } catch {
    return {};
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @dealflow/ai test anthropic`

Expected: all 5 cases PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/providers/anthropic.ts packages/ai/src/providers/anthropic.test.ts packages/ai/src/providers/prompts.ts
git commit -m "feat(ai): AnthropicAIProvider + shared prompts helper"
```

---

### Task 3: GeminiAIProvider

**Files:**
- Create: `packages/ai/src/providers/gemini.ts`
- Create: `packages/ai/src/providers/gemini.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/providers/gemini.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { GeminiAIProvider } from './gemini.js';
import { AIDisabledError } from '../provider.js';

function fakeClient(textResponse: string) {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: textResponse,
      }),
    },
  };
}

describe('GeminiAIProvider.summarizeNote', () => {
  it('returns trimmed summary from model output', async () => {
    const client = fakeClient('  Bob is interested in pricing.  ');
    const provider = new GeminiAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'gemini-2.5-flash',
    });
    const out = await provider.summarizeNote({ text: 'history' });
    expect(out.summary).toBe('Bob is interested in pricing.');
    const call = client.models.generateContent.mock.calls[0]![0]!;
    expect(call.model).toBe('gemini-2.5-flash');
    expect(JSON.stringify(call)).toContain('history');
  });
});

describe('GeminiAIProvider.extractContact', () => {
  it('parses JSON into structured fields', async () => {
    const client = fakeClient(JSON.stringify({ firstName: 'Bob', email: 'b@x.com' }));
    const provider = new GeminiAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'gemini-2.5-flash',
    });
    const out = await provider.extractContact({ text: 'Bob' });
    expect(out.firstName).toBe('Bob');
    expect(out.email).toBe('b@x.com');
  });
});

describe('GeminiAIProvider deferred methods', () => {
  it('draftEmail + nlFilter throw AIDisabledError', async () => {
    const provider = new GeminiAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { models: { generateContent: vi.fn() } } as any,
      model: 'gemini-2.5-flash',
    });
    await expect(
      provider.draftEmail({ dealContext: { id: 'x', summary: 'y' }, intent: 'z' }),
    ).rejects.toBeInstanceOf(AIDisabledError);
    await expect(provider.nlFilter({ query: 'x', entity: 'deals' })).rejects.toBeInstanceOf(
      AIDisabledError,
    );
  });
});

describe('GeminiAIProvider rejects when response has no text', () => {
  it('throws so the fallback wrapper can retry the next provider', async () => {
    const client = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: '' }),
      },
    };
    const provider = new GeminiAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'gemini-2.5-flash',
    });
    await expect(provider.summarizeNote({ text: 'x' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/ai test gemini`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/ai/src/providers/gemini.ts`:

```typescript
import { GoogleGenAI } from '@google/genai';
import {
  AIDisabledError,
  type AIProvider,
  type DraftEmailInput,
  type DraftEmailOutput,
  type ExtractContactInput,
  type ExtractContactOutput,
  type NlFilterInput,
  type NlFilterOutput,
  type SummarizeNoteInput,
  type SummarizeNoteOutput,
} from '../provider.js';
import { SUMMARIZE_SYSTEM, EXTRACT_SYSTEM, parseExtractJson } from './prompts.js';

export interface GeminiAIProviderOptions {
  client: GoogleGenAI;
  model: string;
}

export class GeminiAIProvider implements AIProvider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(opts: GeminiAIProviderOptions) {
    this.client = opts.client;
    this.model = opts.model;
  }

  async summarizeNote(input: SummarizeNoteInput): Promise<SummarizeNoteOutput> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: input.text,
      config: { systemInstruction: SUMMARIZE_SYSTEM, maxOutputTokens: 400 },
    });
    const text = (res.text ?? '').trim();
    if (!text) throw new Error('Gemini returned an empty response');
    return { summary: text };
  }

  async extractContact(input: ExtractContactInput): Promise<ExtractContactOutput> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: input.text,
      config: { systemInstruction: EXTRACT_SYSTEM, maxOutputTokens: 400 },
    });
    return parseExtractJson(res.text ?? '');
  }

  async draftEmail(_input: DraftEmailInput): Promise<DraftEmailOutput> {
    throw new AIDisabledError();
  }
  async nlFilter(_input: NlFilterInput): Promise<NlFilterOutput> {
    throw new AIDisabledError();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dealflow/ai test gemini`

Expected: all 4 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/providers/gemini.ts packages/ai/src/providers/gemini.test.ts
git commit -m "feat(ai): GeminiAIProvider"
```

---

### Task 4: GrokAIProvider

**Files:**
- Create: `packages/ai/src/providers/grok.ts`
- Create: `packages/ai/src/providers/grok.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/providers/grok.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { GrokAIProvider } from './grok.js';
import { AIDisabledError } from '../provider.js';

function fakeClient(textResponse: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { role: 'assistant', content: textResponse } }],
        }),
      },
    },
  };
}

describe('GrokAIProvider.summarizeNote', () => {
  it('returns trimmed summary from model output', async () => {
    const client = fakeClient('Carol wants a demo.');
    const provider = new GrokAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'grok-4',
    });
    const out = await provider.summarizeNote({ text: 'history' });
    expect(out.summary).toBe('Carol wants a demo.');
    const call = client.chat.completions.create.mock.calls[0]![0]!;
    expect(call.model).toBe('grok-4');
    expect(JSON.stringify(call.messages)).toContain('history');
    // The system prompt is sent as a 'system' message in OpenAI format.
    const sysMsg = call.messages.find((m: { role: string }) => m.role === 'system');
    expect(sysMsg).toBeDefined();
  });
});

describe('GrokAIProvider.extractContact', () => {
  it('parses JSON into structured fields', async () => {
    const client = fakeClient(JSON.stringify({ firstName: 'Carol', title: 'CTO' }));
    const provider = new GrokAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'grok-4',
    });
    const out = await provider.extractContact({ text: 'Carol' });
    expect(out.firstName).toBe('Carol');
    expect(out.title).toBe('CTO');
  });

  it('throws when no choices returned', async () => {
    const client = {
      chat: {
        completions: { create: vi.fn().mockResolvedValue({ choices: [] }) },
      },
    };
    const provider = new GrokAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      model: 'grok-4',
    });
    await expect(provider.summarizeNote({ text: 'x' })).rejects.toThrow();
  });
});

describe('GrokAIProvider deferred methods', () => {
  it('draftEmail + nlFilter throw AIDisabledError', async () => {
    const provider = new GrokAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { chat: { completions: { create: vi.fn() } } } as any,
      model: 'grok-4',
    });
    await expect(
      provider.draftEmail({ dealContext: { id: 'x', summary: 'y' }, intent: 'z' }),
    ).rejects.toBeInstanceOf(AIDisabledError);
    await expect(provider.nlFilter({ query: 'x', entity: 'deals' })).rejects.toBeInstanceOf(
      AIDisabledError,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/ai test grok`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/ai/src/providers/grok.ts`:

```typescript
import type OpenAI from 'openai';
import {
  AIDisabledError,
  type AIProvider,
  type DraftEmailInput,
  type DraftEmailOutput,
  type ExtractContactInput,
  type ExtractContactOutput,
  type NlFilterInput,
  type NlFilterOutput,
  type SummarizeNoteInput,
  type SummarizeNoteOutput,
} from '../provider.js';
import { SUMMARIZE_SYSTEM, EXTRACT_SYSTEM, parseExtractJson } from './prompts.js';

export interface GrokAIProviderOptions {
  /** OpenAI SDK client configured with baseURL='https://api.x.ai/v1'. */
  client: OpenAI;
  model: string;
}

/**
 * xAI Grok is OpenAI-compatible — we use the `openai` SDK with a baseURL
 * override. The factory constructs the client; this class only worries about
 * the request shape and parsing.
 */
export class GrokAIProvider implements AIProvider {
  readonly name = 'grok' as const;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts: GrokAIProviderOptions) {
    this.client = opts.client;
    this.model = opts.model;
  }

  async summarizeNote(input: SummarizeNoteInput): Promise<SummarizeNoteOutput> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SUMMARIZE_SYSTEM },
        { role: 'user', content: input.text },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('Grok returned an empty response');
    return { summary: content.trim() };
  }

  async extractContact(input: ExtractContactInput): Promise<ExtractContactOutput> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 400,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: input.text },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('Grok returned an empty response');
    return parseExtractJson(content);
  }

  async draftEmail(_input: DraftEmailInput): Promise<DraftEmailOutput> {
    throw new AIDisabledError();
  }
  async nlFilter(_input: NlFilterInput): Promise<NlFilterOutput> {
    throw new AIDisabledError();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dealflow/ai test grok`

Expected: all 4 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/providers/grok.ts packages/ai/src/providers/grok.test.ts
git commit -m "feat(ai): GrokAIProvider (xAI via OpenAI-compatible SDK)"
```

---

### Task 5: FallbackAIProvider (chain wrapper)

**Files:**
- Create: `packages/ai/src/providers/fallback.ts`
- Create: `packages/ai/src/providers/fallback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/providers/fallback.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { FallbackAIProvider } from './fallback.js';
import { AIDisabledError } from '../provider.js';
import type { AIProvider } from '../provider.js';

function mockProvider(name: string, summarize: () => Promise<{ summary: string }>): AIProvider {
  return {
    name,
    summarizeNote: summarize,
    extractContact: vi.fn().mockResolvedValue({}),
    draftEmail: vi.fn().mockRejectedValue(new AIDisabledError()),
    nlFilter: vi.fn().mockRejectedValue(new AIDisabledError()),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('FallbackAIProvider', () => {
  it('throws AIDisabledError when chain is empty', async () => {
    const p = new FallbackAIProvider([]);
    await expect(p.summarizeNote({ text: 'x' })).rejects.toBeInstanceOf(AIDisabledError);
  });

  it('uses the first provider when it succeeds', async () => {
    const first = mockProvider('claude', async () => ({ summary: 'first' }));
    const second = mockProvider('gemini', async () => ({ summary: 'second' }));
    const p = new FallbackAIProvider([first, second]);
    const out = await p.summarizeNote({ text: 'x' });
    expect(out.summary).toBe('first');
  });

  it('falls back to the next provider on failure', async () => {
    const first = mockProvider('claude', async () => {
      throw new Error('rate limited');
    });
    const second = mockProvider('gemini', async () => ({ summary: 'second' }));
    const p = new FallbackAIProvider([first, second]);
    const out = await p.summarizeNote({ text: 'x' });
    expect(out.summary).toBe('second');
  });

  it('walks all the way down the chain', async () => {
    const first = mockProvider('claude', async () => {
      throw new Error('fail 1');
    });
    const second = mockProvider('gemini', async () => {
      throw new Error('fail 2');
    });
    const third = mockProvider('grok', async () => ({ summary: 'third' }));
    const p = new FallbackAIProvider([first, second, third]);
    const out = await p.summarizeNote({ text: 'x' });
    expect(out.summary).toBe('third');
  });

  it('throws the last error when all providers fail', async () => {
    const first = mockProvider('claude', async () => {
      throw new Error('fail 1');
    });
    const second = mockProvider('gemini', async () => {
      throw new Error('fail 2');
    });
    const p = new FallbackAIProvider([first, second]);
    await expect(p.summarizeNote({ text: 'x' })).rejects.toThrow('fail 2');
  });

  it('reports which providers ran via onAttempt callback', async () => {
    const attempts: Array<{ name: string; ok: boolean; err?: string }> = [];
    const first = mockProvider('claude', async () => {
      throw new Error('boom');
    });
    const second = mockProvider('gemini', async () => ({ summary: 'g' }));
    const p = new FallbackAIProvider([first, second], {
      onAttempt: (a) => attempts.push({ name: a.name, ok: a.ok, err: a.error?.message }),
    });
    await p.summarizeNote({ text: 'x' });
    expect(attempts).toEqual([
      { name: 'claude', ok: false, err: 'boom' },
      { name: 'gemini', ok: true, err: undefined },
    ]);
  });

  it('skips AIDisabledError providers in the chain transparently', async () => {
    // A provider that throws AIDisabledError is treated like any other failure
    // — we move on to the next. This means draftEmail/nlFilter calls walk to
    // the end of the chain (all throw AIDisabledError) and then surface
    // AIDisabledError to the caller. The route layer then returns 503.
    const first = mockProvider('claude', async () => {
      throw new AIDisabledError();
    });
    const second = mockProvider('gemini', async () => {
      throw new AIDisabledError();
    });
    const p = new FallbackAIProvider([first, second]);
    await expect(p.summarizeNote({ text: 'x' })).rejects.toBeInstanceOf(AIDisabledError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/ai test fallback`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/ai/src/providers/fallback.ts`:

```typescript
import {
  AIDisabledError,
  type AIProvider,
  type DraftEmailInput,
  type DraftEmailOutput,
  type ExtractContactInput,
  type ExtractContactOutput,
  type NlFilterInput,
  type NlFilterOutput,
  type SummarizeNoteInput,
  type SummarizeNoteOutput,
} from '../provider.js';

export interface FallbackAttempt {
  name: string;
  method: string;
  ok: boolean;
  error?: Error;
}

export interface FallbackAIProviderOptions {
  /** Called once per provider attempt — useful for logging which links of the chain fire. */
  onAttempt?: (attempt: FallbackAttempt) => void;
}

/**
 * Wraps an ordered list of AIProviders and tries them sequentially. The first
 * one to succeed wins; if every provider throws, the LAST error bubbles up.
 *
 * If the chain is empty, every method throws `AIDisabledError` — the route
 * layer interprets this as 503 "AI is not configured".
 *
 * Failover triggers on ANY thrown error. This includes:
 *   - 429 (rate-limited) → next provider
 *   - 5xx (upstream down) → next provider
 *   - 401 (bad key) → next provider (best-effort)
 *   - parse errors → next provider
 *   - AIDisabledError from a stubbed method (e.g. draftEmail) → next provider
 */
export class FallbackAIProvider implements AIProvider {
  readonly name = 'fallback' as const;
  constructor(
    private readonly providers: readonly AIProvider[],
    private readonly opts: FallbackAIProviderOptions = {},
  ) {}

  summarizeNote(input: SummarizeNoteInput): Promise<SummarizeNoteOutput> {
    return this.run('summarizeNote', (p) => p.summarizeNote(input));
  }
  extractContact(input: ExtractContactInput): Promise<ExtractContactOutput> {
    return this.run('extractContact', (p) => p.extractContact(input));
  }
  draftEmail(input: DraftEmailInput): Promise<DraftEmailOutput> {
    return this.run('draftEmail', (p) => p.draftEmail(input));
  }
  nlFilter(input: NlFilterInput): Promise<NlFilterOutput> {
    return this.run('nlFilter', (p) => p.nlFilter(input));
  }

  private async run<T>(method: string, fn: (p: AIProvider) => Promise<T>): Promise<T> {
    if (this.providers.length === 0) throw new AIDisabledError();
    let lastError: Error | undefined;
    for (const p of this.providers) {
      try {
        const result = await fn(p);
        this.opts.onAttempt?.({ name: providerName(p), method, ok: true });
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        lastError = e;
        this.opts.onAttempt?.({ name: providerName(p), method, ok: false, error: e });
      }
    }
    // All providers threw — surface the last error.
    throw lastError ?? new Error('FallbackAIProvider: no providers attempted');
  }
}

function providerName(p: AIProvider): string {
  // Providers may expose their own `name` (Anthropic/Gemini/Grok do), else "unknown".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = (p as any).name;
  return typeof n === 'string' ? n : 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dealflow/ai test fallback`

Expected: all 7 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/providers/fallback.ts packages/ai/src/providers/fallback.test.ts
git commit -m "feat(ai): FallbackAIProvider wrapper (sequential try-next-on-error)"
```

---

### Task 6: Factory (env-driven chain) + barrel export

**Files:**
- Create: `packages/ai/src/factory.ts`
- Create: `packages/ai/src/factory.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/factory.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildAIProvider, describeChain, isAIEnabled } from './factory.js';

describe('buildAIProvider chain assembly', () => {
  it('returns disabled chain when no keys set', () => {
    const { chain, providers } = buildAIProvider({
      anthropic: { apiKey: undefined, model: 'claude-haiku-4-5' },
      gemini: { apiKey: undefined, model: 'gemini-2.5-flash' },
      grok: { apiKey: undefined, model: 'grok-4' },
    });
    expect(chain).toEqual([]);
    expect(providers).toBeDefined(); // FallbackAIProvider wraps the empty array
    expect(isAIEnabled({ anthropic: {}, gemini: {}, grok: {} })).toBe(false);
  });

  it('includes only providers with keys, in Claude-first order', () => {
    const { chain } = buildAIProvider({
      anthropic: { apiKey: 'sk-ant', model: 'claude-haiku-4-5' },
      gemini: { apiKey: undefined, model: 'gemini-2.5-flash' },
      grok: { apiKey: 'xai-1', model: 'grok-4' },
    });
    expect(chain.map((c) => c.name)).toEqual(['anthropic', 'grok']);
  });

  it('full chain Claude → Gemini → Grok when all 3 keys set', () => {
    const { chain } = buildAIProvider({
      anthropic: { apiKey: 'sk-ant', model: 'claude-haiku-4-5' },
      gemini: { apiKey: 'g-key', model: 'gemini-2.5-flash' },
      grok: { apiKey: 'xai', model: 'grok-4' },
    });
    expect(chain.map((c) => c.name)).toEqual(['anthropic', 'gemini', 'grok']);
  });
});

describe('isAIEnabled', () => {
  it('true iff at least one provider has a key', () => {
    expect(isAIEnabled({ anthropic: { apiKey: 'k' }, gemini: {}, grok: {} })).toBe(true);
    expect(isAIEnabled({ anthropic: {}, gemini: { apiKey: 'k' }, grok: {} })).toBe(true);
    expect(isAIEnabled({ anthropic: {}, gemini: {}, grok: { apiKey: 'k' } })).toBe(true);
    expect(isAIEnabled({ anthropic: {}, gemini: {}, grok: {} })).toBe(false);
  });
});

describe('describeChain', () => {
  it('returns per-provider name+model in order', () => {
    const desc = describeChain({
      anthropic: { apiKey: 'k', model: 'claude-haiku-4-5' },
      gemini: { apiKey: undefined, model: 'gemini-2.5-flash' },
      grok: { apiKey: 'k', model: 'grok-4' },
    });
    expect(desc).toEqual([
      { name: 'anthropic', model: 'claude-haiku-4-5' },
      { name: 'grok', model: 'grok-4' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/ai test factory`

Expected: FAIL — `Cannot find module './factory.js'`.

- [ ] **Step 3: Implement**

Create `packages/ai/src/factory.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { type AIProvider } from './provider.js';
import { AnthropicAIProvider } from './providers/anthropic.js';
import { GeminiAIProvider } from './providers/gemini.js';
import { GrokAIProvider } from './providers/grok.js';
import { FallbackAIProvider, type FallbackAIProviderOptions } from './providers/fallback.js';

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
}

export interface AIConfig {
  anthropic?: ProviderConfig;
  gemini?: ProviderConfig;
  grok?: ProviderConfig;
}

const DEFAULTS = {
  anthropicModel: 'claude-haiku-4-5',
  geminiModel: 'gemini-2.5-flash',
  grokModel: 'grok-4',
  grokBaseURL: 'https://api.x.ai/v1',
};

/**
 * Returns true if any provider has a non-empty `apiKey`. The chain may still
 * be effectively empty if the factory can't construct any provider (e.g. SDK
 * import failure), but in practice this is the right signal for the UI.
 */
export function isAIEnabled(cfg: AIConfig): boolean {
  return Boolean(cfg.anthropic?.apiKey || cfg.gemini?.apiKey || cfg.grok?.apiKey);
}

/**
 * Returns the public chain description (name + model per active provider, in
 * order). Used by `GET /api/v1/ai/status`.
 */
export function describeChain(cfg: AIConfig): Array<{ name: string; model: string }> {
  const out: Array<{ name: string; model: string }> = [];
  if (cfg.anthropic?.apiKey) {
    out.push({ name: 'anthropic', model: cfg.anthropic.model ?? DEFAULTS.anthropicModel });
  }
  if (cfg.gemini?.apiKey) {
    out.push({ name: 'gemini', model: cfg.gemini.model ?? DEFAULTS.geminiModel });
  }
  if (cfg.grok?.apiKey) {
    out.push({ name: 'grok', model: cfg.grok.model ?? DEFAULTS.grokModel });
  }
  return out;
}

/**
 * Build the runtime provider chain. Order is hardcoded Claude → Gemini → Grok;
 * each link is only included if its `apiKey` is set. Wraps the whole list in
 * `FallbackAIProvider` so the caller always gets a single `AIProvider` they
 * can call methods on.
 */
export function buildAIProvider(
  cfg: AIConfig,
  fallbackOpts?: FallbackAIProviderOptions,
): { chain: AIProvider[]; providers: AIProvider } {
  const chain: AIProvider[] = [];
  if (cfg.anthropic?.apiKey) {
    const client = new Anthropic({ apiKey: cfg.anthropic.apiKey });
    chain.push(
      new AnthropicAIProvider({
        client,
        model: cfg.anthropic.model ?? DEFAULTS.anthropicModel,
      }),
    );
  }
  if (cfg.gemini?.apiKey) {
    const client = new GoogleGenAI({ apiKey: cfg.gemini.apiKey });
    chain.push(
      new GeminiAIProvider({
        client,
        model: cfg.gemini.model ?? DEFAULTS.geminiModel,
      }),
    );
  }
  if (cfg.grok?.apiKey) {
    const client = new OpenAI({ apiKey: cfg.grok.apiKey, baseURL: DEFAULTS.grokBaseURL });
    chain.push(
      new GrokAIProvider({
        client,
        model: cfg.grok.model ?? DEFAULTS.grokModel,
      }),
    );
  }
  return { chain, providers: new FallbackAIProvider(chain, fallbackOpts) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dealflow/ai test factory`

Expected: all 6 cases PASS.

- [ ] **Step 5: Update barrel export**

Replace `packages/ai/src/index.ts`:

```typescript
export * from './provider.js';
export { NoopAIProvider } from './providers/noop.js';
export { AnthropicAIProvider } from './providers/anthropic.js';
export { GeminiAIProvider } from './providers/gemini.js';
export { GrokAIProvider } from './providers/grok.js';
export { FallbackAIProvider, type FallbackAttempt } from './providers/fallback.js';
export * from './factory.js';
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @dealflow/ai typecheck`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/factory.ts packages/ai/src/factory.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): factory builds Claude→Gemini→Grok chain from env"
```

---

### Task 7: API env vars for the 3 providers

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/.env` (append commented block)
- Create: `apps/api/test/env.ai.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/env.ai.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://x:y@localhost:5432/z',
};

describe('AI env vars', () => {
  it('all AI vars default to undefined / model defaults', () => {
    const env = loadEnv(BASE);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.XAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBe('claude-haiku-4-5');
    expect(env.GEMINI_MODEL).toBe('gemini-2.5-flash');
    expect(env.XAI_MODEL).toBe('grok-4');
  });

  it('accepts custom models', () => {
    const env = loadEnv({
      ...BASE,
      ANTHROPIC_API_KEY: 'sk-ant',
      ANTHROPIC_MODEL: 'claude-sonnet-4-5',
      GEMINI_API_KEY: 'g',
      GEMINI_MODEL: 'gemini-2.5-pro',
      XAI_API_KEY: 'x',
      XAI_MODEL: 'grok-4-fast',
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant');
    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-5');
    expect(env.GEMINI_API_KEY).toBe('g');
    expect(env.GEMINI_MODEL).toBe('gemini-2.5-pro');
    expect(env.XAI_API_KEY).toBe('x');
    expect(env.XAI_MODEL).toBe('grok-4-fast');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/api test env.ai`

Expected: FAIL — fields don't exist yet.

- [ ] **Step 3: Add the 6 AI vars to env.ts**

Edit `apps/api/src/env.ts`. Add these inside the `z.object({...})` (alongside existing fields, keep the existing `superRefine` at the end):

```typescript
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
    XAI_API_KEY: z.string().optional(),
    XAI_MODEL: z.string().default('grok-4'),
```

- [ ] **Step 4: Append AI block to `apps/api/.env`**

The file is gitignored. Append (don't replace):

```env

# AI providers (optional). The runtime tries them in order Claude → Gemini → Grok;
# any provider without a key is skipped. If all keys are missing, AI is disabled.
# Errors from one provider transparently fall through to the next.
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-haiku-4-5
# GEMINI_API_KEY=...
# GEMINI_MODEL=gemini-2.5-flash
# XAI_API_KEY=...
# XAI_MODEL=grok-4
```

Skip if lines already present.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @dealflow/api test env.ai`

Expected: both cases PASS.

- [ ] **Step 6: Full API typecheck**

Run: `pnpm --filter @dealflow/api typecheck`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/env.ts apps/api/test/env.ai.test.ts
git commit -m "feat(api): env vars for ANTHROPIC / GEMINI / XAI keys + models"
```

---

### Task 8: Shared zod schemas for AI routes

**Files:**
- Create: `packages/shared/src/ai.ts`
- Create: `packages/shared/src/ai.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/ai.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { summarizeActivityBodySchema, extractContactBodySchema } from './ai.js';

const UUID = '00000000-0000-0000-0000-000000000001';

describe('summarizeActivityBodySchema', () => {
  it('accepts exactly one parent id', () => {
    expect(summarizeActivityBodySchema.safeParse({ contactId: UUID }).success).toBe(true);
    expect(summarizeActivityBodySchema.safeParse({ companyId: UUID }).success).toBe(true);
    expect(summarizeActivityBodySchema.safeParse({ dealId: UUID }).success).toBe(true);
  });
  it('rejects empty payload', () => {
    expect(summarizeActivityBodySchema.safeParse({}).success).toBe(false);
  });
  it('rejects two parents', () => {
    expect(
      summarizeActivityBodySchema.safeParse({ contactId: UUID, dealId: UUID }).success,
    ).toBe(false);
  });
  it('rejects bad uuid', () => {
    expect(summarizeActivityBodySchema.safeParse({ contactId: 'nope' }).success).toBe(false);
  });
});

describe('extractContactBodySchema', () => {
  it('accepts normal text', () => {
    expect(extractContactBodySchema.safeParse({ text: 'Alice' }).success).toBe(true);
  });
  it('rejects empty text', () => {
    expect(extractContactBodySchema.safeParse({ text: '' }).success).toBe(false);
  });
  it('rejects text > 10000 chars', () => {
    expect(extractContactBodySchema.safeParse({ text: 'a'.repeat(10001) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/shared test ai`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/shared/src/ai.ts`:

```typescript
import { z } from 'zod';

const uuid = z.string().uuid();

/** Public response from `GET /api/v1/ai/status`. */
export interface PublicAIStatus {
  enabled: boolean;
  providers: Array<{ name: string; model: string }>;
}

export const summarizeActivityBodySchema = z
  .object({
    contactId: uuid.optional(),
    companyId: uuid.optional(),
    dealId: uuid.optional(),
  })
  .refine(
    (v) => (v.contactId ? 1 : 0) + (v.companyId ? 1 : 0) + (v.dealId ? 1 : 0) === 1,
    { message: 'Set exactly one of contactId, companyId, dealId' },
  );
export type SummarizeActivityInput = z.infer<typeof summarizeActivityBodySchema>;
export interface SummarizeActivityResponse {
  summary: string;
}

export const extractContactBodySchema = z.object({
  text: z.string().min(1).max(10000),
});
export type ExtractContactBodyInput = z.infer<typeof extractContactBodySchema>;

export interface ExtractedContact {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  companyName?: string;
}
export interface ExtractContactResponse {
  extracted: ExtractedContact;
}
```

- [ ] **Step 4: Re-export from index**

Edit `packages/shared/src/index.ts`. Append:

```typescript
export * from './ai.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @dealflow/shared test ai`

Expected: 7/7 PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ai.ts packages/shared/src/ai.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): AI request/response schemas"
```

---

### Task 9: AI routes (status, summarize-activity, extract-contact)

**Files:**
- Create: `apps/api/src/modules/ai/routes.ts`
- Create: `apps/api/test/modules/ai/ai.routes.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/test/helpers/build-app.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/modules/ai/ai.routes.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FallbackAIProvider, AnthropicAIProvider } from '@dealflow/ai';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

async function createContact(
  app: FastifyInstance,
  cookie: string,
  firstName: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    payload: { firstName },
    headers: { cookie },
  });
  return (res.json() as { contact: { id: string } }).contact.id;
}

// Build a real AnthropicAIProvider with a fake SDK that returns a canned response.
function fakeAnthropic(text: string) {
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text }] }),
    },
  };
  return new AnthropicAIProvider({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    model: 'claude-haiku-4-5',
  });
}

describe('GET /api/v1/ai/status', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status' });
    expect(res.statusCode).toBe(401);
  });

  it('reports disabled (empty providers) when no keys are wired', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/status',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; providers: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.providers).toEqual([]);
  });
});

describe('AI status with chain wired', () => {
  it('reports the chain in order', async () => {
    const testDb = await startTestPostgres();
    const providers = [fakeAnthropic('x'), fakeAnthropic('y')]; // two fake links
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider(providers),
      aiStatusDescription: [
        { name: 'anthropic', model: 'claude-haiku-4-5' },
        { name: 'gemini', model: 'gemini-2.5-flash' },
      ],
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/status',
      headers: { cookie },
    });
    const body = res.json() as { enabled: boolean; providers: Array<{ name: string }> };
    expect(body.enabled).toBe(true);
    expect(body.providers.map((p) => p.name)).toEqual(['anthropic', 'gemini']);
    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/ai/summarize-activity', () => {
  it('returns 503 with AI_DISABLED when chain is empty', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: { contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AI_DISABLED');
    await app.close();
    await testDb.stop();
  });

  it('400 when no parent id', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: {},
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });

  it('200 with summary when chain succeeds', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic('CANNED SUMMARY')]),
      aiStatusDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Bob');
    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'Bob said hi', contactId },
      headers: { cookie },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: { contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { summary: string }).summary).toBe('CANNED SUMMARY');
    await app.close();
    await testDb.stop();
  });

  it('404 when parent contact not in org', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic('x')]),
      aiStatusDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: { contactId: '00000000-0000-0000-0000-000000000001' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
    await testDb.stop();
  });

  it('502 when all providers in the chain fail', async () => {
    const testDb = await startTestPostgres();
    const failingClient = {
      messages: { create: async () => { throw new Error('upstream boom'); } },
    };
    const failing = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: failingClient as any,
      model: 'claude-haiku-4-5',
    });
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([failing]),
      aiStatusDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Carol');
    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'hi', contactId },
      headers: { cookie },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: { contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AI_UPSTREAM_ERROR');
    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/ai/extract-contact', () => {
  it('returns structured fields when chain succeeds', async () => {
    const testDb = await startTestPostgres();
    const json = JSON.stringify({ firstName: 'Dan', email: 'd@x.com' });
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic(json)]),
      aiStatusDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/extract-contact',
      payload: { text: 'Dan d@x.com' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { extracted: { firstName: string; email: string } };
    expect(body.extracted.firstName).toBe('Dan');
    expect(body.extracted.email).toBe('d@x.com');
    await app.close();
    await testDb.stop();
  });

  it('400 on empty text', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/extract-contact',
      payload: { text: '' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dealflow/api test ai.routes`

Expected: FAIL — routes not registered + `aiProvider` / `aiStatusDescription` options not accepted by `buildTestApp`.

- [ ] **Step 3: Extend buildTestApp**

Read `apps/api/test/helpers/build-app.ts` first to confirm its current signature.

Extend the options interface:

```typescript
import type { AIProvider } from '@dealflow/ai';
// (keep existing imports)

export interface BuildTestAppOptions {
  db?: Database;
  /** Optional override of the AI chain — used by AI route tests. */
  aiProvider?: AIProvider;
  /** Optional description shown by GET /api/v1/ai/status. */
  aiStatusDescription?: Array<{ name: string; model: string }>;
}
```

Forward both new options to the production `buildApp(...)`.

- [ ] **Step 4: Implement the routes**

Create `apps/api/src/modules/ai/routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { type AIProvider, AIDisabledError } from '@dealflow/ai';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  ERROR_CODES,
  summarizeActivityBodySchema,
  extractContactBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ActivitiesRepo } from '../activities/activities.repo.js';

const MAX_ACTIVITIES = 50;
const MAX_CONTEXT_CHARS = 4000;

export interface AIRoutesDeps {
  db: Database;
  aiProvider: AIProvider;
  aiChainDescription: Array<{ name: string; model: string }>;
}

async function parentExistsInOrg(
  db: Database,
  orgId: string,
  parent: { contactId?: string; companyId?: string; dealId?: string },
): Promise<boolean> {
  if (parent.contactId) {
    const [row] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, orgId),
          eq(schema.contacts.id, parent.contactId),
        ),
      )
      .limit(1);
    return !!row;
  }
  if (parent.companyId) {
    const [row] = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.organizationId, orgId),
          eq(schema.companies.id, parent.companyId),
        ),
      )
      .limit(1);
    return !!row;
  }
  if (parent.dealId) {
    const [row] = await db
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(
        and(eq(schema.deals.organizationId, orgId), eq(schema.deals.id, parent.dealId)),
      )
      .limit(1);
    return !!row;
  }
  return false;
}

function buildActivityContext(
  activities: { kind: string; body: string; createdAt: Date; dueAt: Date | null }[],
): string {
  const lines: string[] = [];
  let chars = 0;
  for (const a of activities.slice(0, MAX_ACTIVITIES)) {
    const when = a.createdAt.toISOString().slice(0, 10);
    const tag =
      a.kind === 'task'
        ? `task${a.dueAt ? ` due ${a.dueAt.toISOString().slice(0, 10)}` : ''}`
        : 'note';
    const line = `[${when}] [${tag}] ${a.body}`;
    if (chars + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    chars += line.length;
  }
  return lines.join('\n');
}

function aiDisabled(reply: import('fastify').FastifyReply) {
  return reply.status(503).send({
    error: {
      code: 'AI_DISABLED',
      message: 'AI is not configured on this DealFlow instance.',
    },
  });
}

function aiUpstreamError(reply: import('fastify').FastifyReply) {
  return reply.status(502).send({
    error: { code: 'AI_UPSTREAM_ERROR', message: 'AI provider request failed.' },
  });
}

export async function registerAIRoutes(
  app: FastifyInstance,
  deps: AIRoutesDeps,
): Promise<void> {
  const activities = new ActivitiesRepo(deps.db);
  const enabled = deps.aiChainDescription.length > 0;

  app.get('/api/v1/ai/status', { preHandler: requireOrg }, async (_req, reply) => {
    return reply.send({ enabled, providers: deps.aiChainDescription });
  });

  app.post(
    '/api/v1/ai/summarize-activity',
    { preHandler: requireOrg },
    async (req, reply) => {
      const parsed = summarizeActivityBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Provide exactly one of contactId, companyId, dealId',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }
      if (!enabled) return aiDisabled(reply);

      const orgId = req.session!.currentOrgId!;
      const ok = await parentExistsInOrg(deps.db, orgId, parsed.data);
      if (!ok) {
        return reply
          .status(404)
          .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Parent not found' } });
      }

      const rows = await activities.listForParent(orgId, parsed.data);
      if (rows.length === 0) {
        return reply.send({ summary: 'No activity yet.' });
      }
      const context = buildActivityContext(rows);
      try {
        const out = await deps.aiProvider.summarizeNote({ text: context });
        return reply.send({ summary: out.summary });
      } catch (err) {
        if (err instanceof AIDisabledError) return aiDisabled(reply);
        req.log.error({ err }, 'summarize-activity: all providers failed');
        return aiUpstreamError(reply);
      }
    },
  );

  app.post(
    '/api/v1/ai/extract-contact',
    { preHandler: requireOrg },
    async (req, reply) => {
      const parsed = extractContactBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Invalid text',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }
      if (!enabled) return aiDisabled(reply);

      try {
        const extracted = await deps.aiProvider.extractContact({ text: parsed.data.text });
        return reply.send({ extracted });
      } catch (err) {
        if (err instanceof AIDisabledError) return aiDisabled(reply);
        req.log.error({ err }, 'extract-contact: all providers failed');
        return aiUpstreamError(reply);
      }
    },
  );
}
```

- [ ] **Step 5: Wire the chain in server.ts**

Edit `apps/api/src/server.ts`. Read the existing file first.

Add the import:
```typescript
import { buildAIProvider, describeChain, type AIProvider } from '@dealflow/ai';
```

Extend `buildApp` options to accept optional overrides:
```typescript
export interface BuildAppOptions {
  env: Env;
  db?: Database;
  aiProvider?: AIProvider;
  aiChainDescription?: Array<{ name: string; model: string }>;
}
```

Inside `buildApp`, after the activities-routes registration, compute the chain (or use the override) and register AI routes:

```typescript
const aiConfig = {
  anthropic: {
    apiKey: opts.env.ANTHROPIC_API_KEY,
    model: opts.env.ANTHROPIC_MODEL,
  },
  gemini: {
    apiKey: opts.env.GEMINI_API_KEY,
    model: opts.env.GEMINI_MODEL,
  },
  grok: {
    apiKey: opts.env.XAI_API_KEY,
    model: opts.env.XAI_MODEL,
  },
};
const aiProvider =
  opts.aiProvider ?? buildAIProvider(aiConfig, {
    onAttempt: (a) => {
      if (!a.ok) {
        app.log.warn({ provider: a.name, method: a.method, err: a.error?.message }, 'AI fallback');
      }
    },
  }).providers;
const aiChainDescription = opts.aiChainDescription ?? describeChain(aiConfig);

const { registerAIRoutes } = await import('./modules/ai/routes.js');
await registerAIRoutes(app, {
  db: opts.db!,
  aiProvider,
  aiChainDescription,
});
```

Also forward `aiProvider` and `aiChainDescription` from `BuildTestAppOptions` to `buildApp` in `apps/api/test/helpers/build-app.ts` (rename the test helper's `aiStatusDescription` to match if you prefer — pick one name and use it consistently).

- [ ] **Step 6: Run the failing test**

Run: `pnpm --filter @dealflow/api test ai.routes`

Expected: all 9 cases PASS.

- [ ] **Step 7: Full API regression**

Run: `pnpm --filter @dealflow/api test`

Expected: prior 194 tests + new AI ones, all passing.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ai/routes.ts apps/api/test/modules/ai/ai.routes.test.ts apps/api/src/server.ts apps/api/test/helpers/build-app.ts
git commit -m "feat(api): AI status + summarize + extract routes (3-provider fallback)"
```

---

### Task 10: Web query keys + AI hooks

**Files:**
- Modify: `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/features/ai/api.ts`

- [ ] **Step 1: Add ai key**

Edit `apps/web/src/lib/query-keys.ts`. Append the `ai` namespace to `queryKeys`:

```typescript
  ai: {
    status: ['ai', 'status'] as const,
  },
```

- [ ] **Step 2: Build the hooks**

Create `apps/web/src/features/ai/api.ts`:

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  ExtractContactResponse,
  PublicAIStatus,
  SummarizeActivityInput,
  SummarizeActivityResponse,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useAIStatus() {
  return useQuery({
    queryKey: queryKeys.ai.status,
    queryFn: () => apiFetch<PublicAIStatus>('/api/v1/ai/status'),
    staleTime: Infinity, // env-driven; refresh on page reload
  });
}

export function useSummarizeActivity() {
  return useMutation({
    mutationFn: (input: SummarizeActivityInput) =>
      apiFetch<SummarizeActivityResponse>('/api/v1/ai/summarize-activity', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useExtractContact() {
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<ExtractContactResponse>('/api/v1/ai/extract-contact', {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @dealflow/web typecheck`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/query-keys.ts apps/web/src/features/ai/api.ts
git commit -m "feat(web): AI query hooks"
```

---

### Task 11: ✨ Summarize button in ActivityFeed

**Files:**
- Modify: `apps/web/src/features/activities/activity-feed.tsx`

- [ ] **Step 1: Add the button + summary display**

Edit `apps/web/src/features/activities/activity-feed.tsx`. Read the existing file first. Then:

1. Add imports near the top:
   ```typescript
   import { useAIStatus, useSummarizeActivity } from '@/features/ai/api';
   ```

2. Inside `ActivityFeed`, before the return, add:
   ```typescript
   const aiStatus = useAIStatus();
   const summarize = useSummarizeActivity();
   const summary = summarize.data?.summary ?? null;
   ```

3. The existing header has `<Button>Note</Button>` + `<Button>Task</Button>`. Add a third Summarize button INSIDE the same flex container, only when AI is enabled:
   ```tsx
   {aiStatus.data?.enabled && (
     <Button
       variant="outline"
       size="sm"
       onClick={() => summarize.mutate(parent)}
       disabled={summarize.isPending}
       data-testid="summarize-activity"
     >
       {summarize.isPending ? 'Summarizing…' : '✨ Summarize'}
     </Button>
   )}
   ```

4. Below the composer area, before the list `<ul>`, render the summary result:
   ```tsx
   {summary && (
     <div
       className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
       data-testid="activity-summary"
     >
       <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-700">
         AI summary
       </p>
       <p className="whitespace-pre-wrap">{summary}</p>
     </div>
   )}
   {summarize.isError && (
     <p className="mb-4 text-sm text-red-600">Couldn't summarize — please try again.</p>
   )}
   ```

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck && pnpm --filter @dealflow/web build`

Expected: no errors. Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/activities/activity-feed.tsx
git commit -m "feat(web): ✨ Summarize button in ActivityFeed"
```

---

### Task 12: ✨ Paste from text mode in CreateContactDialog

**Files:**
- Modify: `apps/web/src/features/contacts/create-contact-dialog.tsx`

- [ ] **Step 1: Add the extract mode**

Edit `apps/web/src/features/contacts/create-contact-dialog.tsx`. Read the file first. The component currently uses `useForm` and destructures `register, handleSubmit, reset, formState`. Add `setValue` to that destructuring.

1. Add imports:
   ```typescript
   import { useAIStatus, useExtractContact } from '@/features/ai/api';
   ```

2. Add state + hooks:
   ```typescript
   const [mode, setMode] = useState<'form' | 'paste'>('form');
   const [pasteText, setPasteText] = useState('');
   const aiStatus = useAIStatus();
   const extract = useExtractContact();
   ```
   (also add `setValue` to the destructured `useForm` return.)

3. Extract handler:
   ```typescript
   async function onExtract() {
     const trimmed = pasteText.trim();
     if (!trimmed) return;
     const res = await extract.mutateAsync(trimmed);
     const e = res.extracted;
     if (e.firstName) setValue('firstName', e.firstName);
     if (e.lastName) setValue('lastName', e.lastName);
     if (e.email) setValue('email', e.email);
     if (e.title) setValue('title', e.title);
     setMode('form');
   }
   ```

4. Mode toggle ABOVE the form, only when AI enabled:
   ```tsx
   {aiStatus.data?.enabled && (
     <div className="mb-3 flex items-center gap-2 text-xs">
       <button
         type="button"
         onClick={() => setMode('form')}
         className={mode === 'form' ? 'font-medium text-neutral-900' : 'text-neutral-500'}
       >
         Manual
       </button>
       <span className="text-neutral-300">·</span>
       <button
         type="button"
         onClick={() => setMode('paste')}
         className={mode === 'paste' ? 'font-medium text-neutral-900' : 'text-neutral-500'}
       >
         ✨ Paste from text
       </button>
     </div>
   )}
   ```

5. When `mode === 'paste'`, render the paste UI ABOVE the existing form (keep form visible so user can review):
   ```tsx
   {mode === 'paste' && (
     <div className="mb-4 flex flex-col gap-2">
       <Label htmlFor="paste-text">
         Paste an email signature, LinkedIn snippet, or freeform text
       </Label>
       <textarea
         id="paste-text"
         value={pasteText}
         onChange={(e) => setPasteText(e.target.value)}
         rows={5}
         className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
         data-testid="paste-text"
       />
       <Button
         type="button"
         size="sm"
         onClick={onExtract}
         disabled={!pasteText.trim() || extract.isPending}
       >
         {extract.isPending ? 'Extracting…' : 'Extract fields'}
       </Button>
       {extract.isError && (
         <p className="text-sm text-red-600">Couldn't extract — please try again.</p>
       )}
     </div>
   )}
   ```

- [ ] **Step 2: Verify typecheck + build**

Run: `pnpm --filter @dealflow/web typecheck && pnpm --filter @dealflow/web build`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/contacts/create-contact-dialog.tsx
git commit -m "feat(web): ✨ Paste from text mode in CreateContactDialog"
```

---

### Task 13: AI status section in Settings

**Files:**
- Modify: `apps/web/src/routes/app.settings.tsx`

- [ ] **Step 1: Add the AI status section**

Edit `apps/web/src/routes/app.settings.tsx`. Read the file first. Then:

1. Add import:
   ```typescript
   import { useAIStatus } from '@/features/ai/api';
   ```

2. Add the hook call inside the component body:
   ```typescript
   const aiStatus = useAIStatus();
   ```

3. After the existing "Default currency" `<section>`, add:
   ```tsx
   <section className="mt-4 rounded-md border border-neutral-200 p-4">
     <h2 className="mb-3 text-base font-medium">AI features</h2>
     {aiStatus.isPending && <p className="text-sm text-neutral-500">Checking…</p>}
     {aiStatus.data?.enabled ? (
       <>
         <p className="mb-2 text-sm text-neutral-700">
           <span className="font-medium text-green-700">Enabled</span> · fallback chain runs
           in order.
         </p>
         <ol className="ml-4 list-decimal space-y-1 text-sm text-neutral-700">
           {aiStatus.data.providers.map((p) => (
             <li key={p.name}>
               <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">{p.name}</code>
               {' · model '}
               <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">{p.model}</code>
             </li>
           ))}
         </ol>
       </>
     ) : (
       aiStatus.data && (
         <p className="text-sm text-neutral-700">
           <span className="font-medium text-neutral-500">Disabled</span> — set any of{' '}
           <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">
             ANTHROPIC_API_KEY
           </code>
           ,{' '}
           <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">GEMINI_API_KEY</code>,
           or{' '}
           <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">XAI_API_KEY</code>{' '}
           in <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">apps/api/.env</code>{' '}
           to enable.
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
git commit -m "feat(web): AI status section (chain order) on Settings page"
```

---

### Task 14: Full validation + push + tag

**Files:** none (verification + git)

- [ ] **Step 1: Format**

Run: `pnpm format`

If files reformat, stage and commit as `style: format` before the next steps.

- [ ] **Step 2: Lint**

Run: `pnpm lint`

Expected: clean.

- [ ] **Step 3: Typecheck (all workspaces)**

Run: `pnpm typecheck`

Expected: clean.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`

Expected: prior tests + new tests from this sub-plan (~30+), all passing.

- [ ] **Step 5: Commit the plan doc (if untracked)**

```bash
git add docs/superpowers/plans/2026-05-20-dealflow-phase-1-sub-plan-6-ai.md
git commit -m "chore(docs): add sub-plan 6 (AI, multi-provider) implementation plan"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

- [ ] **Step 7: Tag**

```bash
git tag -a sub-plan-6-ai -m "Sub-Plan 6: AI features with Claude → Gemini → Grok fallback chain"
git push origin sub-plan-6-ai
```

---

## Self-Review (executed by plan author)

**Spec coverage:**
- "Use AI like Claude → Gemini → Grok" — chain order hardcoded Claude → Gemini → Grok in `factory.ts` (Task 6) ✓
- "Default will be Claude" — Claude is always first in the chain when its key is set ✓
- "If there is error or somethings then use the next AI" — FallbackAIProvider re-tries on ANY thrown error (Task 5) ✓
- "Activity summary" — Task 9 + Task 11 ✓
- "Contact extraction" — Task 9 + Task 12 ✓
- "AI status visible" — Task 9 (status route returns chain) + Task 13 (Settings displays it) ✓
- "Hide UI when disabled" — Tasks 11/12 gate on `aiStatus.data?.enabled` ✓

**Placeholder scan:** No "TBD" / "implement later" / hand-wavy steps. Every code block is complete.

**Type consistency:**
- `PublicAIStatus` shape `{ enabled, providers: Array<{name, model}> }` is identical in Task 8 (shared), Task 9 (route response), Task 10 (hook), Task 13 (UI consumer).
- `SummarizeActivityInput` discriminated union is identical across Tasks 8, 9, 10, 11.
- `ExtractContactResponse.extracted` keys match `ExtractContactOutput` from `packages/ai/src/provider.ts` (firstName, lastName, email, phone, title, companyName).
- `FallbackAIProvider` is the single concrete entry point — all routes and tests consume it via `AIProvider` (the interface).
- All three real providers (`Anthropic`, `Gemini`, `Grok`) expose `name` as a string literal for chain-description purposes.

**Known follow-ups (deliberately out of scope):**
1. Real `draftEmail` + `nlFilter` implementations across all 3 providers.
2. Per-org "AI disabled by admin" toggle.
3. Per-org API keys (currently one set per deployment).
4. Cost/quota tracking dashboard.
5. Activity summary caching.
6. Pickier failover policy (e.g. don't fall back on auth/401 errors — those are config bugs).
