-- Sub-Plan 2b: email becomes a third activity kind.
-- Two new nullable columns carry email-specific data; existing notes/tasks
-- leave both NULL. `kind` stays `text` (no CHECK constraint) — TS-side
-- ACTIVITY_KINDS does the typing.
ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "subject" text,
  ADD COLUMN IF NOT EXISTS "external_id" text;
