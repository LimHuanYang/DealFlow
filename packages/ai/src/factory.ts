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
 * be effectively empty if the factory can't construct any provider, but in
 * practice this is the right signal for the UI.
 */
export function isAIEnabled(cfg: AIConfig): boolean {
  return Boolean(cfg.anthropic?.apiKey || cfg.gemini?.apiKey || cfg.grok?.apiKey);
}

/**
 * Returns the public chain description (name + model per active provider, in
 * Claude → Gemini → Grok order). Used by `GET /api/v1/ai/status`.
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
 * `FallbackAIProvider` so the caller always gets a single `AIProvider`.
 */
export type NamedAIProvider = AIProvider & { readonly name: string };

export function buildAIProvider(
  cfg: AIConfig,
  fallbackOpts?: FallbackAIProviderOptions,
): { chain: NamedAIProvider[]; providers: AIProvider } {
  const chain: NamedAIProvider[] = [];
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
