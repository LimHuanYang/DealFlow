export interface SendEmailInput {
  /** Display name + address part — already concatenated, e.g. `"Alice via DealFlow <noreply@dealflow.app>"`. */
  from: string;
  /** Single recipient email — multi-recipient deferred to a later sub-plan. */
  to: string;
  /** Where replies should land (typically the sending user's real email). */
  replyTo: string;
  subject: string;
  /** Plain-text body. The provider may also render an HTML derivative. */
  text: string;
}

export interface SendEmailOutput {
  /** Provider-side message ID (Resend returns one; useful for future inbound matching). */
  messageId: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailOutput>;
}

export class EmailDisabledError extends Error {
  constructor() {
    super('Email is disabled. Set RESEND_API_KEY in apps/api/.env to enable.');
    this.name = 'EmailDisabledError';
  }
}
