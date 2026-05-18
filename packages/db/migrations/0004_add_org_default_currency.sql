-- Adds per-organization default_currency (ISO 4217 code).
-- New rows default to 'USD'. Existing rows get backfilled to 'USD' by the
-- column default. Users can change the value via the Settings UI; signup
-- picks a sensible initial value from the Accept-Language HTTP header.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "default_currency" text NOT NULL DEFAULT 'USD';
