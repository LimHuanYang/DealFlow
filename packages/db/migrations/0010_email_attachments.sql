-- Sub-Plan: Email Attachments v1.
-- Adds per-file metadata for outbound email attachments. The user's SMTP
-- provider's Sent folder is the long-term source of truth; cache_path +
-- cache_expires_at are populated only when the org opts in to caching.

CREATE TABLE IF NOT EXISTS "email_attachments" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"  uuid    NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "activity_id"      uuid    NOT NULL REFERENCES "activities"("id")    ON DELETE CASCADE,
  "filename"         text    NOT NULL,
  "mime_type"        text    NOT NULL,
  "size_bytes"       integer NOT NULL,
  "cache_path"       text,
  "cache_expires_at" timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_attachments_activity_idx"
  ON "email_attachments" ("activity_id");

CREATE INDEX IF NOT EXISTS "email_attachments_cache_eviction_idx"
  ON "email_attachments" ("cache_expires_at");
