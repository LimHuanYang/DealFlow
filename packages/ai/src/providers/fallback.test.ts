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
