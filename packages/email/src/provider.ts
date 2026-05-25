export interface SendEmailInput {
  /** Display name + address part — already concatenated, e.g. `"Alice via DealFlow <noreply@dealflow.app>"`. */
  from: string;
  /** Primary recipient email. */
  to: string;
  /** Where replies should land (typically the sending user's real email). */
  replyTo: string;
  subject: string;
  /** Plain-text body (always present — required as multipart/alternative fallback). */
  text: string;
  /** Optional HTML body. When set, the transport sends multipart/alternative. */
  html?: string;
  /** Optional CC recipients. */
  cc?: string[];
  /** Optional BCC recipients. */
  bcc?: string[];
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
