import type { Transporter } from 'nodemailer';
import { type EmailProvider, type SendEmailInput, type SendEmailOutput } from '../provider.js';

export interface SmtpEmailProviderOptions {
  /** Nodemailer transporter (created by the factory from SMTP env vars). Tests pass a fake. */
  transport: Transporter;
}

/**
 * SMTP-backed EmailProvider via nodemailer. The transporter is injected so the
 * factory owns connection config (host/port/auth) and this class only formats
 * the outgoing message.
 *
 * Used as a fallback when Resend isn't available — for example a self-host
 * operator who wants to relay via Gmail, Office 365, or a company SMTP relay.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp' as const;
  private readonly transport: Transporter;

  constructor(opts: SmtpEmailProviderOptions) {
    this.transport = opts.transport;
  }

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    const info = await this.transport.sendMail({
      from: input.from,
      to: input.to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      ...(input.html !== undefined ? { html: input.html } : {}),
      ...(input.cc !== undefined ? { cc: input.cc } : {}),
      ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    });
    if (!info.messageId) {
      throw new Error('SMTP transport returned no message id');
    }
    return { messageId: info.messageId };
  }
}
