-- Sub-Plan 5: Activities (notes + tasks).
--
-- One unified table for both kinds. Discriminated by `kind` ('note' | 'task').
-- Task-only columns (status, due_at, completed_at) are nullable so notes can
-- leave them NULL. Parent link is polymorphic: exactly one of contact_id,
-- company_id, deal_id must be set (CHECK constraint enforces).
--
-- Cascading deletes: removing a parent entity removes its activities.
CREATE TABLE IF NOT EXISTS "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "owner_user_id" uuid,
  "kind" text NOT NULL,
  "body" text NOT NULL,
  "status" text,
  "due_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "contact_id" uuid,
  "company_id" uuid,
  "deal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "activities_one_parent_check" CHECK ((
    (CASE WHEN "contact_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "company_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "deal_id"    IS NOT NULL THEN 1 ELSE 0 END)
  ) = 1)
);
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_deal_id_deals_id_fk"
  FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_org_kind_idx" ON "activities" ("organization_id","kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_org_due_at_idx" ON "activities" ("organization_id","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_contact_idx" ON "activities" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_company_idx" ON "activities" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_deal_idx" ON "activities" ("deal_id");
