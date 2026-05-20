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
    expect(providers).toBeDefined();
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
