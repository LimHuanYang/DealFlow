import { Resend } from 'resend';
import { type EmailProvider } from './provider.js';
import { NoopEmailProvider } from './providers/noop.js';
import { ResendEmailProvider } from './providers/resend.js';

export interface EmailConfig {
  /** Resend API key. Required to enable email. */
  apiKey?: string;
  /** Envelope From address — must be a verified domain in Resend. */
  from?: string;
  /** Display name appended to the From line, e.g. "DealFlow". Optional. */
  name?: string;
}

/** True iff a real ResendEmailProvider would be constructed. */
export function isEmailEnabled(cfg: EmailConfig): boolean {
  return Boolean(cfg.apiKey && cfg.from);
}

/**
 * Public description used by `GET /api/v1/email/status`. When email is enabled,
 * returns the formatted From line so the UI can show the operator exactly what
 * recipients will see. When disabled, both fields are absent.
 */
export function describeEmail(cfg: EmailConfig): {
  provider: 'resend' | 'none';
  from: string | null;
} {
  if (!isEmailEnabled(cfg)) return { provider: 'none', from: null };
  const fromLine = cfg.name ? `${cfg.name} <${cfg.from}>` : (cfg.from ?? null);
  return { provider: 'resend', from: fromLine };
}

/**
 * Build the runtime EmailProvider. Falls back to NoopEmailProvider when keys
 * are missing — that way the API still boots cleanly; routes only return 503
 * when called.
 */
export function buildEmailProvider(cfg: EmailConfig): EmailProvider {
  if (!isEmailEnabled(cfg)) return new NoopEmailProvider();
  if (!cfg.apiKey) return new NoopEmailProvider();
  const client = new Resend(cfg.apiKey);
  return new ResendEmailProvider({ client });
}
