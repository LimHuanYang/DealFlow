import type { Resend } from 'resend';
import {
  type EmailProvider,
  type SendEmailInput,
  type SendEmailOutput,
} from '../provider.js';

export interface ResendEmailProviderOptions {
  /** Resend SDK client. Tests pass a fake; the factory passes `new Resend(apiKey)`. */
  client: Resend;
}

/**
 * Real email provider backed by Resend. The Resend SDK returns `{ data, error }`:
 * on success `data.id` is the message id; on failure `error.message` is human-readable.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend' as const;
  private readonly client: Resend;

  constructor(opts: ResendEmailProviderOptions) {
    this.client = opts.client;
  }

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    const result = await this.client.emails.send({
      from: input.from,
      to: [input.to],
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
    });
    if (result.error) {
      throw new Error(`Resend send failed: ${result.error.message}`);
    }
    if (!result.data?.id) {
      throw new Error('Resend send returned no message id');
    }
    return { messageId: result.data.id };
  }
}
