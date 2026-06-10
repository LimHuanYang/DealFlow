import { type EmailProvider } from './provider.js';
import { NoopEmailProvider } from './providers/noop.js';
import { EngineMailerEmailProvider } from './providers/engine-mailer.js';

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
}

/** True iff the EngineMailer config has the minimum required fields. */
export function isEngineMailerEnabled(cfg: EmailConfig): boolean {
  const e = cfg.engineMailer;
  return Boolean(e?.apiKey && e?.fromEmail && e?.fromName);
}

/** True iff any provider is configured. */
export function isEmailEnabled(cfg: EmailConfig): boolean {
  return isEngineMailerEnabled(cfg);
}

/** Reports the active provider + raw From address for the status endpoint. */
export function describeEmail(cfg: EmailConfig): {
  provider: 'engine-mailer' | 'none';
  fromAddress: string | null;
} {
  if (isEngineMailerEnabled(cfg)) {
    return { provider: 'engine-mailer', fromAddress: cfg.engineMailer!.fromEmail ?? null };
  }
  return { provider: 'none', fromAddress: null };
}

/**
 * Builds the runtime EmailProvider. EngineMailer is used when configured;
 * otherwise Noop.
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
  return new NoopEmailProvider();
}
