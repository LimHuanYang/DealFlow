-- Sub-Plan: Email Tracking v1.
-- Adds 8 tracking columns to activities (counters, timestamps, cc/bcc lists,
-- delivery status, tracking-enabled flag) plus a new email_events table
-- holding one row per open/click/sent event. Aggregate counts are
-- denormalized on activities for fast feed-row reads; events power the
-- activity-detail timeline and /app/emails dashboard.

ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "tracking_enabled"  boolean      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "cc_emails"         text[],
  ADD COLUMN IF NOT EXISTS "bcc_emails"        text[],
  ADD COLUMN IF NOT EXISTS "delivery_status"   text         NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS "open_count"        integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_opened_at"   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_opened_at"    timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "click_count"       integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_clicked_at"  timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_clicked_at"   timestamp with time zone;

CREATE TABLE IF NOT EXISTS "email_events" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "activity_id"     uuid NOT NULL REFERENCES "activities"("id")    ON DELETE CASCADE,
  "event_type"      text NOT NULL,
  "url"             text,
  "occurred_at"     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_events_activity_idx"
  ON "email_events" ("activity_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "email_events_org_idx"
  ON "email_events" ("organization_id", "occurred_at");
