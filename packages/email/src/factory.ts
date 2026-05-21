import { createTransport, type Transporter } from 'nodemailer';
import { type EmailProvider } from './provider.js';
import { NoopEmailProvider } from './providers/noop.js';
import { SmtpEmailProvider } from './providers/smtp.js';

export interface SmtpConfig {
  /** SMTP host, e.g. `smtp.gmail.com`. */
  host?: string;
  /** SMTP port — 587 (STARTTLS) or 465 (TLS) are typical. */
  port?: number;
  /** SMTP auth username (usually the full email address). */
  user?: string;
  /** SMTP auth password or app password. */
  pass?: string;
  /** Envelope From address. */
  fromEmail?: string;
  /** Optional display name (currently unused in the personal From-line style). */
  fromName?: string;
}

export interface EmailConfig {
  smtp?: SmtpConfig;
}

/** True iff the SMTP config has the minimum required fields. */
export function isEmailEnabled(cfg: EmailConfig): boolean {
  const s = cfg.smtp;
  return Boolean(s?.host && s?.user && s?.pass && s?.fromEmail);
}

/**
 * Returns the active provider + raw From address for the status endpoint.
 */
export function describeEmail(cfg: EmailConfig): {
  provider: 'smtp' | 'none';
  fromAddress: string | null;
} {
  if (isEmailEnabled(cfg)) {
    return { provider: 'smtp', fromAddress: cfg.smtp!.fromEmail ?? null };
  }
  return { provider: 'none', fromAddress: null };
}

/**
 * Build the runtime EmailProvider. SmtpEmailProvider if SMTP config is complete,
 * otherwise NoopEmailProvider.
 */
export function buildEmailProvider(cfg: EmailConfig): EmailProvider {
  if (!isEmailEnabled(cfg)) return new NoopEmailProvider();
  const transport: Transporter = createTransport({
    host: cfg.smtp!.host!,
    port: cfg.smtp!.port ?? 587,
    secure: (cfg.smtp!.port ?? 587) === 465,
    auth: { user: cfg.smtp!.user!, pass: cfg.smtp!.pass! },
  });
  return new SmtpEmailProvider({ transport });
}
