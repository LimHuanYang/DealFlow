-- Data migration: backfill owner_user_id on legacy rows to each org's owner.
--
-- Why this exists: the new member-ownership permission model requires every
-- contact/company/deal/activity to have an owner_user_id. Rows created before
-- that model shipped have owner_user_id IS NULL. This migration assigns each
-- such row to its organization's owner (the org_members row with role='owner';
-- if an org somehow has more than one, the earliest-joined wins via
-- DISTINCT ON ... ORDER BY joined_at ASC).
--
-- Idempotent: every UPDATE is scoped to owner_user_id IS NULL, so re-running
-- after the first apply is a no-op. Orgs without an owner are left untouched
-- (the CTE produces no row for them, so the join matches nothing).
--
-- NOTE: hand-authored (data-only, no schema diff) and registered directly in
-- meta/_journal.json, matching migrations 0004-0010 in this repo. drizzle-kit
-- generate is not used here because the meta snapshot chain predates those
-- manual migrations.

WITH org_owner AS (
  SELECT DISTINCT ON (organization_id) organization_id, user_id
  FROM org_members WHERE role = 'owner'
  ORDER BY organization_id, joined_at ASC
)
UPDATE contacts c SET owner_user_id = o.user_id
  FROM org_owner o WHERE c.organization_id = o.organization_id AND c.owner_user_id IS NULL;
--> statement-breakpoint
WITH org_owner AS (
  SELECT DISTINCT ON (organization_id) organization_id, user_id
  FROM org_members WHERE role = 'owner'
  ORDER BY organization_id, joined_at ASC
)
UPDATE companies c SET owner_user_id = o.user_id
  FROM org_owner o WHERE c.organization_id = o.organization_id AND c.owner_user_id IS NULL;
--> statement-breakpoint
WITH org_owner AS (
  SELECT DISTINCT ON (organization_id) organization_id, user_id
  FROM org_members WHERE role = 'owner'
  ORDER BY organization_id, joined_at ASC
)
UPDATE deals d SET owner_user_id = o.user_id
  FROM org_owner o WHERE d.organization_id = o.organization_id AND d.owner_user_id IS NULL;
--> statement-breakpoint
WITH org_owner AS (
  SELECT DISTINCT ON (organization_id) organization_id, user_id
  FROM org_members WHERE role = 'owner'
  ORDER BY organization_id, joined_at ASC
)
UPDATE activities a SET owner_user_id = o.user_id
  FROM org_owner o WHERE a.organization_id = o.organization_id AND a.owner_user_id IS NULL;
