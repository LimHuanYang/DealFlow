import { createTransport, type Transporter } from 'nodemailer';
import { type EmailProvider } from './provider.js';
import { NoopEmailProvider } from './providers/noop.js';
import { SmtpEmailProvider } from './providers/smtp.js';
import { EngineMailerEmailProvider } from './providers/engine-mailer.js';

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
  /** Optional display name. */
  fromName?: string;
}

export interface EngineMailerConfig {
  /** EngineMailer API key. */
  apiKey?: string;
  /** Verified sending address (domain must be verified in EngineMailer). */
  fromEmail?: string;
  /** Sender display name. */
  fromName?: string;
}

export interface EmailConfig {
  engineMailer?: EngineMailerConfig;
  /** @deprecated SMTP is being retired in favor of EngineMailer; removed in EM10. */
  smtp?: SmtpConfig;
}

/** True iff the EngineMailer config has the minimum required fields. */
export function isEngineMailerEnabled(cfg: EmailConfig): boolean {
  const e = cfg.engineMailer;
  return Boolean(e?.apiKey && e?.fromEmail && e?.fromName);
}

/** True iff the SMTP config has the minimum required fields. */
export function isSmtpEnabled(cfg: EmailConfig): boolean {
  const s = cfg.smtp;
  return Boolean(s?.host && s?.user && s?.pass && s?.fromEmail);
}

/** True iff any provider is configured. */
export function isEmailEnabled(cfg: EmailConfig): boolean {
  return isEngineMailerEnabled(cfg) || isSmtpEnabled(cfg);
}

/** Reports the active provider + raw From address for the status endpoint. */
export function describeEmail(cfg: EmailConfig): {
  provider: 'engine-mailer' | 'smtp' | 'none';
  fromAddress: string | null;
} {
  if (isEngineMailerEnabled(cfg)) {
    return { provider: 'engine-mailer', fromAddress: cfg.engineMailer!.fromEmail ?? null };
  }
  if (isSmtpEnabled(cfg)) {
    return { provider: 'smtp', fromAddress: cfg.smtp!.fromEmail ?? null };
  }
  return { provider: 'none', fromAddress: null };
}

/**
 * Builds the runtime EmailProvider. EngineMailer is preferred when configured;
 * SMTP is the legacy fallback (removed in EM10); otherwise Noop.
 */
export function buildEmailProvider(cfg: EmailConfig): EmailProvider {
  if (isEngineMailerEnabled(cfg)) {
    const e = cfg.engineMailer!;
    return new EngineMailerEmailProvider({
      apiKey: e.apiKey!,
      fromEmail: e.fromEmail!,
      fromName: e.fromName!,
    });
  }
  if (isSmtpEnabled(cfg)) {
    const transport: Transporter = createTransport({
      host: cfg.smtp!.host!,
      port: cfg.smtp!.port ?? 587,
      secure: (cfg.smtp!.port ?? 587) === 465,
      auth: { user: cfg.smtp!.user!, pass: cfg.smtp!.pass! },
    });
    return new SmtpEmailProvider({ transport });
  }
  return new NoopEmailProvider();
}
