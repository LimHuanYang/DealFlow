import { eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import type {
  AttachmentCacheDays,
  EngineMailerConfigInput,
  PublicAIProviderConfig,
  PublicEmailIntegration,
  PublicIntegrations,
  UpdateIntegrationsInput,
} from '@dealflow/shared';

interface StoredAIProvider {
  apiKey: string; // encrypted
  model?: string;
}

interface StoredEngineMailer {
  fromName: string;
  fromEmail: string;
}

interface StoredEmail {
  attachmentCacheDays?: string;
}

interface StoredIntegrations {
  anthropic?: StoredAIProvider | null;
  gemini?: StoredAIProvider | null;
  grok?: StoredAIProvider | null;
  engineMailer?: StoredEngineMailer | null;
  email?: StoredEmail;
}

export interface DecryptedAIProvider {
  apiKey: string;
  model?: string;
}

export interface DecryptedEngineMailer {
  fromName: string;
  fromEmail: string;
}

export interface DecryptedIntegrations {
  anthropic: DecryptedAIProvider | null;
  gemini: DecryptedAIProvider | null;
  grok: DecryptedAIProvider | null;
  engineMailer: DecryptedEngineMailer | null;
}

/**
 * Per-org integration credential store. Secrets (AI + EngineMailer API keys) are
 * encrypted at rest with AES-256-GCM using the deployment-level key passed in
 * at construction. Non-secrets (models, emails) live alongside encrypted fields
 * in the same JSONB column.
 */
export class OrgIntegrationsRepo {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
  ) {}

  /** Load + decrypt every secret. Returns nulls for providers the org hasn't set up. */
  async getDecrypted(orgId: string): Promise<DecryptedIntegrations> {
    const stored = await this.loadStored(orgId);
    return {
      anthropic: this.decryptAI(stored.anthropic),
      gemini: this.decryptAI(stored.gemini),
      grok: this.decryptAI(stored.grok),
      engineMailer: this.decryptEngineMailer(stored.engineMailer),
    };
  }

  /** Save the org's EngineMailer sender identity (From name + From email). */
  async saveEngineMailer(orgId: string, input: EngineMailerConfigInput): Promise<void> {
    const current = await this.loadStored(orgId);
    const next: StoredIntegrations = {
      ...current,
      engineMailer: { fromName: input.fromName, fromEmail: input.fromEmail },
    };
    await this.db
      .update(schema.organizations)
      .set({ integrations: next as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(schema.organizations.id, orgId));
  }

  /**
   * Masked EngineMailer view for the Settings UI. The API key is app-wide
   * (server env ENGINE_MAILER_API_KEY), so the caller passes whether it's set.
   */
  async getMaskedEmail(orgId: string, apiKeyConfigured: boolean): Promise<PublicEmailIntegration> {
    const stored = await this.loadStored(orgId);
    const em = this.decryptEngineMailer(stored.engineMailer);
    const fromName = em?.fromName ?? null;
    const fromEmail = em?.fromEmail ?? null;
    return {
      apiKeyConfigured,
      fromName,
      fromEmail,
      connected: apiKeyConfigured && !!fromName && !!fromEmail,
    };
  }

  /** Public masked view for the Settings UI. Never returns real secrets. */
  async getMasked(orgId: string): Promise<PublicIntegrations> {
    const stored = await this.loadStored(orgId);
    const decrypted = {
      anthropic: this.decryptAI(stored.anthropic),
      gemini: this.decryptAI(stored.gemini),
      grok: this.decryptAI(stored.grok),
    };
    const VALID_DAYS = ['7', '30', '90', 'never'] as const;
    const storedDays = stored.email?.attachmentCacheDays;
    const attachmentCacheDays: AttachmentCacheDays =
      typeof storedDays === 'string' && (VALID_DAYS as readonly string[]).includes(storedDays)
        ? (storedDays as AttachmentCacheDays)
        : '30';
    return {
      anthropic: maskAI(decrypted.anthropic),
      gemini: maskAI(decrypted.gemini),
      grok: maskAI(decrypted.grok),
      email: { attachmentCacheDays },
    };
  }

  /**
   * Patch the integrations blob. Only the fields included in `patch` change;
   * everything else is preserved. `null` for a provider clears it entirely.
   */
  async update(orgId: string, patch: UpdateIntegrationsInput): Promise<void> {
    const current = await this.loadStored(orgId);
    const next: StoredIntegrations = { ...current };

    if (patch.anthropic !== undefined) {
      next.anthropic =
        patch.anthropic === null
          ? null
          : {
              apiKey: encryptSecret(patch.anthropic.apiKey, this.encryptionKey),
              model: patch.anthropic.model,
            };
    }
    if (patch.gemini !== undefined) {
      next.gemini =
        patch.gemini === null
          ? null
          : {
              apiKey: encryptSecret(patch.gemini.apiKey, this.encryptionKey),
              model: patch.gemini.model,
            };
    }
    if (patch.grok !== undefined) {
      next.grok =
        patch.grok === null
          ? null
          : {
              apiKey: encryptSecret(patch.grok.apiKey, this.encryptionKey),
              model: patch.grok.model,
            };
    }
    if (patch.email !== undefined && patch.email !== null) {
      next.email = { ...(next.email ?? {}), ...patch.email };
    }

    await this.db
      .update(schema.organizations)
      .set({ integrations: next as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(schema.organizations.id, orgId));
  }

  private async loadStored(orgId: string): Promise<StoredIntegrations> {
    const [row] = await this.db
      .select({ integrations: schema.organizations.integrations })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1);
    return ((row?.integrations as StoredIntegrations | undefined) ?? {}) as StoredIntegrations;
  }

  private decryptAI(stored: StoredAIProvider | null | undefined): DecryptedAIProvider | null {
    if (!stored) return null;
    return {
      apiKey: decryptSecret(stored.apiKey, this.encryptionKey),
      model: stored.model,
    };
  }

  private decryptEngineMailer(
    stored: StoredEngineMailer | null | undefined,
  ): DecryptedEngineMailer | null {
    if (!stored) return null;
    // No secret to decrypt — the API key is app-wide (server env), not per-org.
    return { fromName: stored.fromName, fromEmail: stored.fromEmail };
  }
}

function maskAI(d: DecryptedAIProvider | null): PublicAIProviderConfig {
  if (!d) return { configured: false, apiKeyMask: '', model: null };
  return {
    configured: true,
    apiKeyMask: d.apiKey.slice(-4),
    model: d.model ?? null,
  };
}
