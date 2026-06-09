import { readFile } from 'node:fs/promises';
import {
  type EmailProvider,
  type SendEmailAttachment,
  type SendEmailInput,
  type SendEmailOutput,
} from '../provider.js';

/**
 * EngineMailer transactional send endpoint (REST API V2). Confirmed in the
 * Task-0 spike: auth via the `APIKey` header, JSON body, success response
 * `{ Result: { TransactionID, Status, StatusCode } }`.
 */
const EM_SEND_URL = 'https://api.enginemailer.com/RESTAPI/V2/Submission/SendEmail';

export interface EngineMailerProviderOptions {
  apiKey: string;
  /** Verified sending address (its domain must be verified in EngineMailer). */
  fromEmail: string;
  fromName: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface EngineMailerResult {
  Result?: { TransactionID?: string; Status?: string; StatusCode?: string | number };
}

/**
 * Sends transactional email through EngineMailer's REST API.
 *
 * EngineMailer has a single `SubmittedContent` field (no separate HTML/text)
 * and NO reply-to field, so we send HTML when present (falling back to text)
 * and ignore `replyTo` — replies go to the verified-domain mailbox. The
 * returned `messageId` is EngineMailer's `TransactionID`, which the tracking
 * webhook echoes as `details.txid` for correlation.
 */
export class EngineMailerEmailProvider implements EmailProvider {
  constructor(private readonly opts: EngineMailerProviderOptions) {}

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const body = {
      ToEmail: input.to,
      SenderEmail: this.opts.fromEmail,
      SenderName: this.opts.fromName,
      Subject: input.subject,
      SubmittedContent: input.html ?? input.text,
      CCEmails: input.cc,
      BCCEmails: input.bcc,
      Attachments: await toEngineMailerAttachments(input.attachments),
    };

    const res = await fetchImpl(EM_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', APIKey: this.opts.apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`EngineMailer send failed: HTTP ${res.status} ${await safeText(res)}`);
    }

    const data = (await res.json()) as EngineMailerResult;
    const statusCode = data.Result?.StatusCode;
    if (String(statusCode) !== '200') {
      throw new Error(
        `EngineMailer send rejected: ${data.Result?.Status ?? 'unknown error'} (StatusCode ${statusCode})`,
      );
    }
    return { messageId: data.Result?.TransactionID ?? '' };
  }
}

/** Maps DealFlow attachments to EngineMailer's `[{ Filename, Content(base64) }]`. */
async function toEngineMailerAttachments(
  attachments?: SendEmailAttachment[],
): Promise<{ Filename: string; Content: string }[] | undefined> {
  if (!attachments?.length) return undefined;
  const out: { Filename: string; Content: string }[] = [];
  for (const a of attachments) {
    let content: string | undefined;
    if (a.content) content = a.content.toString('base64');
    else if (a.path) content = (await readFile(a.path)).toString('base64');
    if (content !== undefined) out.push({ Filename: a.filename, Content: content });
  }
  return out.length ? out : undefined;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
