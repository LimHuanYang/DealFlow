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
  it('nlFilter throws AIDisabledError', async () => {
    const provider = new GrokAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { chat: { completions: { create: vi.fn() } } } as any,
      model: 'grok-4',
    });
    await expect(provider.nlFilter({ query: 'x', entity: 'deals' })).rejects.toBeInstanceOf(
      AIDisabledError,
    );
  });
});

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
