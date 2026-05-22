-- Sub-Plan: Custom Fields v1.
-- Adds a central org-scoped metadata table for custom field definitions
-- plus a `custom_fields` jsonb column on each entity table (contacts,
-- companies, deals, activities) that stores values keyed by definition UUID.
-- Notes and tasks share the activities table; the merge helper routes by
-- activity.kind to the right `entity_type` definition set.

CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "options" jsonb,
  "required" boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cfd_org_entity_idx"
  ON "custom_field_definitions" ("organization_id", "entity_type", "position");

CREATE UNIQUE INDEX IF NOT EXISTS "cfd_org_entity_name_unique"
  ON "custom_field_definitions" ("organization_id", "entity_type", "name");

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "custom_fields" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "custom_fields" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "custom_fields" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "custom_fields" jsonb NOT NULL DEFAULT '{}'::jsonb;
