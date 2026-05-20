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
