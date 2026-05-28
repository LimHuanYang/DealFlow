import { eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import type {
  AttachmentCacheDays,
  PublicAIProviderConfig,
  PublicIntegrations,
  PublicSmtpConfig,
  UpdateIntegrationsInput,
} from '@dealflow/shared';

interface StoredAIProvider {
  apiKey: string; // encrypted
  model?: string;
}

interface StoredSmtp {
  host: string;
  port: number;
  user: string;
  pass: string; // encrypted
  fromEmail: string;
  fromName?: string;
}

interface StoredEmail {
  attachmentCacheDays?: string;
}

interface StoredIntegrations {
  anthropic?: StoredAIProvider | null;
  gemini?: StoredAIProvider | null;
  grok?: StoredAIProvider | null;
  smtp?: StoredSmtp | null;
  email?: StoredEmail;
}

export interface DecryptedAIProvider {
  apiKey: string;
  model?: string;
}

export interface DecryptedSmtp {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromEmail: string;
  fromName?: string;
}

export interface DecryptedIntegrations {
  anthropic: DecryptedAIProvider | null;
  gemini: DecryptedAIProvider | null;
  grok: DecryptedAIProvider | null;
  smtp: DecryptedSmtp | null;
}

/**
 * Per-org integration credential store. Secrets (api keys + smtp pass) are
 * encrypted at rest with AES-256-GCM using the deployment-level key passed in
 * at construction. Non-secrets (models, hosts, ports, emails) live alongside
 * encrypted fields in the same JSONB column.
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
      smtp: this.decryptSmtp(stored.smtp),
    };
  }

  /** Public masked view for the Settings UI. Never returns real secrets. */
  async getMasked(orgId: string): Promise<PublicIntegrations> {
    const stored = await this.loadStored(orgId);
    const decrypted = {
      anthropic: this.decryptAI(stored.anthropic),
      gemini: this.decryptAI(stored.gemini),
      grok: this.decryptAI(stored.grok),
      smtp: this.decryptSmtp(stored.smtp),
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
      smtp: maskSmtp(decrypted.smtp),
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
    if (patch.smtp !== undefined) {
      next.smtp =
        patch.smtp === null
          ? null
          : {
              host: patch.smtp.host,
              port: patch.smtp.port,
              user: patch.smtp.user,
              pass: encryptSecret(patch.smtp.pass, this.encryptionKey),
              fromEmail: patch.smtp.fromEmail,
              fromName: patch.smtp.fromName,
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

  private decryptSmtp(stored: StoredSmtp | null | undefined): DecryptedSmtp | null {
    if (!stored) return null;
    return {
      host: stored.host,
      port: stored.port,
      user: stored.user,
      pass: decryptSecret(stored.pass, this.encryptionKey),
      fromEmail: stored.fromEmail,
      fromName: stored.fromName,
    };
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

function maskSmtp(d: DecryptedSmtp | null): PublicSmtpConfig {
  if (!d) {
    return {
      configured: false,
      host: null,
      port: null,
      user: null,
      fromEmail: null,
      fromName: null,
      passMask: '',
    };
  }
  return {
    configured: true,
    host: d.host,
    port: d.port,
    user: d.user,
    fromEmail: d.fromEmail,
    fromName: d.fromName ?? null,
    passMask: '',
  };
}
