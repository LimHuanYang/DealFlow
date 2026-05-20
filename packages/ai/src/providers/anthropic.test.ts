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
