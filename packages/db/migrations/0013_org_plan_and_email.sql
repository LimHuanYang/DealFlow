ALTER TABLE "public"."organizations" ADD COLUMN IF NOT EXISTS "plan" text NOT NULL DEFAULT 'free';
ALTER TABLE "public"."organizations" DROP CONSTRAINT IF EXISTS "organizations_plan_check";
ALTER TABLE "public"."organizations" ADD CONSTRAINT "organizations_plan_check" CHECK ("plan" IN ('free','pro'));
ALTER TABLE "public"."activities" ADD COLUMN IF NOT EXISTS "external_id" text;
