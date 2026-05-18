-- Data migration: backfill the default "Sales" pipeline + 6 canonical stages
-- for every organization that does not yet have a pipeline.
--
-- Why this exists: Sub-Plan 4 wired createDefaultPipeline into AuthService.signup
-- so every NEW signup gets a usable kanban out of the box. Organizations that
-- existed BEFORE that change (early dev users, future migrations from other
-- self-hosted instances, etc.) ended up with zero pipelines and the kanban
-- page rendered "Could not load pipeline." This migration backfills them
-- idempotently — re-running it after the first apply is a no-op because the
-- WHERE clause filters for orgs with no existing pipeline.
--
-- Stage configuration matches src/modules/pipelines/seed.ts DEFAULT_STAGES.

WITH orgs_without_pipelines AS (
  SELECT o.id
  FROM organizations o
  LEFT JOIN pipelines p ON p.organization_id = o.id
  WHERE p.id IS NULL
),
new_pipelines AS (
  INSERT INTO pipelines (organization_id, name, is_default)
  SELECT id, 'Sales', true FROM orgs_without_pipelines
  RETURNING id, organization_id
)
INSERT INTO pipeline_stages (
  pipeline_id,
  organization_id,
  name,
  order_index,
  win_probability,
  is_won,
  is_lost
)
SELECT
  np.id,
  np.organization_id,
  s.name,
  s.order_index,
  s.win_probability,
  s.is_won,
  s.is_lost
FROM new_pipelines np
CROSS JOIN (VALUES
  ('Lead',        1,  10, false, false),
  ('Qualified',   2,  25, false, false),
  ('Proposal',    3,  50, false, false),
  ('Negotiation', 4,  75, false, false),
  ('Closed Won',  5, 100, true,  false),
  ('Closed Lost', 6,   0, false, true )
) AS s(name, order_index, win_probability, is_won, is_lost);
