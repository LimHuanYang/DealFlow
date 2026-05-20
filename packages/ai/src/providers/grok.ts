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
import {
  SUMMARIZE_SYSTEM,
  EXTRACT_SYSTEM,
  DRAFT_EMAIL_SYSTEM,
  parseExtractJson,
  parseDraftEmailJson,
} from './prompts.js';

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
  async nlFilter(_input: NlFilterInput): Promise<NlFilterOutput> {
    throw new AIDisabledError();
  }
}
