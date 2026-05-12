export interface DealContext {
  id: string;
  summary: string;
}

export type FilterEntity = 'deals' | 'contacts' | 'companies';

export interface SummarizeNoteInput {
  text: string;
}
export interface SummarizeNoteOutput {
  summary: string;
}

export interface DraftEmailInput {
  dealContext: DealContext;
  intent: string;
}
export interface DraftEmailOutput {
  subject: string;
  body: string;
}

export interface NlFilterInput {
  query: string;
  entity: FilterEntity;
}
export interface NlFilterOutput {
  filter: unknown; // FilterDSL — typed concretely in Sub-Plan 6
}

export interface ExtractContactInput {
  text: string;
}
export interface ExtractContactOutput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  companyName?: string;
}

export interface AIProvider {
  summarizeNote(input: SummarizeNoteInput): Promise<SummarizeNoteOutput>;
  draftEmail(input: DraftEmailInput): Promise<DraftEmailOutput>;
  nlFilter(input: NlFilterInput): Promise<NlFilterOutput>;
  extractContact(input: ExtractContactInput): Promise<ExtractContactOutput>;
}

export class AIDisabledError extends Error {
  constructor() {
    super(
      'AI is disabled. Set AI_PROVIDER=anthropic or AI_PROVIDER=openai and provide an API key.',
    );
    this.name = 'AIDisabledError';
  }
}
