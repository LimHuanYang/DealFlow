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

export class NoopAIProvider implements AIProvider {
  async summarizeNote(_input: SummarizeNoteInput): Promise<SummarizeNoteOutput> {
    throw new AIDisabledError();
  }
  async draftEmail(_input: DraftEmailInput): Promise<DraftEmailOutput> {
    throw new AIDisabledError();
  }
  async nlFilter(_input: NlFilterInput): Promise<NlFilterOutput> {
    throw new AIDisabledError();
  }
  async extractContact(_input: ExtractContactInput): Promise<ExtractContactOutput> {
    throw new AIDisabledError();
  }
}
