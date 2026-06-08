-- CHECK constraint on org_members.role. Caps the allowed values at the
-- exact set the application code understands: owner / admin / member.
--
-- Why this exists: routes now consult `org_members.role` to authorize
-- mutations (Team-Management Phase B5). `requireOrg` reads the column and
-- casts it `as OrgRole`. Without a DB-level constraint, any stray value
-- written outside the API (manual SQL, future migration, etc.) would silently
-- become "not-in-allowed-list" at runtime: the cast would still succeed but
-- `requireRole(['owner','admin'])` would reject the user with a confusing
-- 403. A CHECK turns those typos into a clear write-time failure and
-- documents the closed set in the schema itself.
--
-- Safe to apply: pre-flight on Supabase shows every existing row uses one of
-- the three values (a manual `SELECT DISTINCT role FROM org_members` was run
-- and returned only 'owner').
--
-- NOTE: hand-authored (no schema-diff source) and registered directly in
-- meta/_journal.json, matching the manual-migration pattern from 0004-0011.
-- drizzle-kit generate is not usable in this repo: the snapshot chain stops
-- at 0003 and aborts with a snapshot collision.

ALTER TABLE org_members
  ADD CONSTRAINT org_members_role_check CHECK (role IN ('owner', 'admin', 'member'));
