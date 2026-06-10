import { z } from 'zod';

/**
 * Per-org EngineMailer sender identity.
 *
 * The EngineMailer API key is a single app-wide server setting
 * (ENGINE_MAILER_API_KEY) — one EngineMailer account for the whole deployment —
 * so it is NOT part of this per-org config. Each org only sets its sender
 * identity. `fromEmail`'s domain must be a sending domain verified inside
 * EngineMailer (EngineMailer validates `SenderEmail` against a verified domain,
 * and webhooks are only available for verified domains).
 *
 * Note (per the Task-0 spike): EngineMailer's V2 SendEmail has no Reply-To
 * field, so there is intentionally no `replyTo` here — replies land in the
 * verified-domain mailbox the message is sent from.
 */
export const engineMailerConfigSchema = z.object({
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email(),
});
export type EngineMailerConfigInput = z.infer<typeof engineMailerConfigSchema>;

/**
 * Masked view of the email integration for the Settings UI.
 */
export interface PublicEmailIntegration {
  /** Whether the app-wide ENGINE_MAILER_API_KEY is configured on the server. */
  apiKeyConfigured: boolean;
  fromName: string | null;
  fromEmail: string | null;
  /** True iff the app-wide key is set AND this org has a From name + From email. */
  connected: boolean;
}
