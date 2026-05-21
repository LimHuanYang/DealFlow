-- Sub-Plan: Per-Org Integration Settings.
-- Adds an `integrations` JSONB column to organizations. Stores per-org
-- AI provider keys (Anthropic / Gemini / Grok) and SMTP credentials.
-- Secrets in the JSONB are encrypted at rest with AES-256-GCM using the
-- deployment-level INTEGRATION_ENCRYPTION_KEY. Plaintext fields (models,
-- hosts, ports, emails) coexist alongside encrypted ones.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "integrations" jsonb NOT NULL DEFAULT '{}'::jsonb;
