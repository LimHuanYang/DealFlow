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
