import type { GoogleGenAI } from '@google/genai';
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

export interface GeminiAIProviderOptions {
  client: GoogleGenAI;
  model: string;
}

export class GeminiAIProvider implements AIProvider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(opts: GeminiAIProviderOptions) {
    this.client = opts.client;
    this.model = opts.model;
  }

  async summarizeNote(input: SummarizeNoteInput): Promise<SummarizeNoteOutput> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: input.text,
      config: { systemInstruction: SUMMARIZE_SYSTEM, maxOutputTokens: 400 },
    });
    const text = (res.text ?? '').trim();
    if (!text) throw new Error('Gemini returned an empty response');
    return { summary: text };
  }

  async extractContact(input: ExtractContactInput): Promise<ExtractContactOutput> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: input.text,
      config: { systemInstruction: EXTRACT_SYSTEM, maxOutputTokens: 400 },
    });
    return parseExtractJson(res.text ?? '');
  }

  async draftEmail(input: DraftEmailInput): Promise<DraftEmailOutput> {
    const userMessage = `Context:\n${input.dealContext.summary}\n\nIntent:\n${input.intent}`;
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: userMessage,
      config: { systemInstruction: DRAFT_EMAIL_SYSTEM, maxOutputTokens: 800 },
    });
    return parseDraftEmailJson(res.text ?? '');
  }
  async nlFilter(_input: NlFilterInput): Promise<NlFilterOutput> {
    throw new AIDisabledError();
  }
}
