import { z } from 'zod';
import { attachmentCacheDaysSchema, type AttachmentCacheDays } from './emails.js';

const aiProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1).optional(),
});

/**
 * Body for PATCH /api/v1/integrations. All fields optional — clients send only
 * what they want to change. `null` clears a provider entirely.
 */
export const updateIntegrationsBodySchema = z.object({
  anthropic: aiProviderConfigSchema.nullable().optional(),
  gemini: aiProviderConfigSchema.nullable().optional(),
  grok: aiProviderConfigSchema.nullable().optional(),
  email: z
    .object({
      attachmentCacheDays: attachmentCacheDaysSchema,
    })
    .partial()
    .nullable()
    .optional(),
});
export type UpdateIntegrationsInput = z.infer<typeof updateIntegrationsBodySchema>;

/** Body for POST /api/v1/integrations/test-ai. */
export const testAIBodySchema = z.object({
  provider: z.enum(['anthropic', 'gemini', 'grok']),
});
export type TestAIInput = z.infer<typeof testAIBodySchema>;

/**
 * Public (masked) view of an AI provider entry. Returned by GET /integrations.
 * The full apiKey is never sent to the client — only the last 4 chars.
 */
export interface PublicAIProviderConfig {
  configured: boolean;
  /** Last 4 chars of the API key, e.g. `abcd`. Empty string when not configured. */
  apiKeyMask: string;
  model: string | null;
}

export interface PublicIntegrations {
  anthropic: PublicAIProviderConfig;
  gemini: PublicAIProviderConfig;
  grok: PublicAIProviderConfig;
  email: {
    attachmentCacheDays: AttachmentCacheDays;
  };
}

export interface TestResultResponse {
  ok: boolean;
  /** Human-readable error message when ok=false. */
  error?: string;
}
