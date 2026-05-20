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
