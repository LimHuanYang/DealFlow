import { createTransport, type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { type EmailProvider } from './provider.js';
import { NoopEmailProvider } from './providers/noop.js';
import { ResendEmailProvider } from './providers/resend.js';
import { SmtpEmailProvider } from './providers/smtp.js';

export interface ResendConfig {
  /** Resend API key. */
  apiKey?: string;
  /** Envelope From address (must be a verified domain in Resend). */
  from?: string;
  /** Optional display name appended to the From line. */
  name?: string;
}

export interface SmtpConfig {
  /** SMTP host, e.g. `smtp.gmail.com`. */
  host?: string;
  /** SMTP port — 587 (STARTTLS) or 465 (TLS) are typical. */
  port?: number;
  /** SMTP auth username (usually the full email address). */
  user?: string;
  /** SMTP auth password or app password. */
  pass?: string;
  /** Envelope From address (usually the same as `user`). */
  from?: string;
  /** Optional display name appended to the From line. */
  name?: string;
}

export interface EmailConfig {
  resend?: ResendConfig;
  smtp?: SmtpConfig;
}

/** True iff at least one provider has the minimal config to send. */
export function isEmailEnabled(cfg: EmailConfig): boolean {
  if (cfg.resend?.apiKey && cfg.resend?.from) return true;
  if (cfg.smtp?.host && cfg.smtp?.user && cfg.smtp?.pass && cfg.smtp?.from) return true;
  return false;
}

/**
 * Public description used by `GET /api/v1/email/status`. Returns the active
 * provider + formatted From line so the UI can show the operator exactly what
 * recipients will see.
 *
 * Order of preference: resend → smtp → none.
 */
export function describeEmail(cfg: EmailConfig): {
  provider: 'resend' | 'smtp' | 'none';
  from: string | null;
} {
  if (cfg.resend?.apiKey && cfg.resend?.from) {
    const fromLine = cfg.resend.name ? `${cfg.resend.name} <${cfg.resend.from}>` : cfg.resend.from;
    return { provider: 'resend', from: fromLine };
  }
  if (cfg.smtp?.host && cfg.smtp?.user && cfg.smtp?.pass && cfg.smtp?.from) {
    const fromLine = cfg.smtp.name ? `${cfg.smtp.name} <${cfg.smtp.from}>` : cfg.smtp.from;
    return { provider: 'smtp', from: fromLine };
  }
  return { provider: 'none', from: null };
}

/**
 * Build the runtime EmailProvider. Order of preference:
 *   1. ResendEmailProvider if `resend.apiKey` + `resend.from` are set
 *   2. SmtpEmailProvider if `smtp.host`/`user`/`pass`/`from` are all set
 *   3. NoopEmailProvider otherwise (every send throws EmailDisabledError)
 */
export function buildEmailProvider(cfg: EmailConfig): EmailProvider {
  if (cfg.resend?.apiKey && cfg.resend?.from) {
    const client = new Resend(cfg.resend.apiKey);
    return new ResendEmailProvider({ client });
  }
  if (cfg.smtp?.host && cfg.smtp?.user && cfg.smtp?.pass && cfg.smtp?.from) {
    const transport: Transporter = createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port ?? 587,
      secure: (cfg.smtp.port ?? 587) === 465,
      auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
    });
    return new SmtpEmailProvider({ transport });
  }
  return new NoopEmailProvider();
}
