import { z } from 'zod';

/**
 * EngineMailer per-org email configuration.
 *
 * `apiKey` is optional on update — when omitted/blank the server keeps the
 * existing encrypted key (the "unchanged-when-blank" behavior the old SMTP
 * config used for its password). `fromEmail`'s domain must be a sending domain
 * verified inside EngineMailer: EngineMailer validates `SenderEmail` against a
 * verified domain, and webhooks are only available for verified domains.
 *
 * Note (per the Task-0 spike): EngineMailer's V2 SendEmail has no Reply-To
 * field, so there is intentionally no `replyTo` here — replies land in the
 * verified-domain mailbox the message is sent from.
 */
export const engineMailerConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email(),
});
export type EngineMailerConfigInput = z.infer<typeof engineMailerConfigSchema>;

/**
 * Masked view of the email integration for the Settings UI. Never carries the
 * real API key — only a hint of its last characters.
 */
export interface PublicEmailIntegration {
  connected: boolean;
  fromName: string | null;
  fromEmail: string | null;
  /** Last 4 characters of the API key, masked, e.g. "••••7Q4a"; null if unset. */
  keyHint: string | null;
}
