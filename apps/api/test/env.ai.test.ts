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
