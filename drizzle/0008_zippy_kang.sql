CREATE TABLE "brand_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text DEFAULT 'Brand' NOT NULL,
	"system" jsonb NOT NULL,
	"origin" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_systems" ADD CONSTRAINT "brand_systems_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_systems" ADD CONSTRAINT "brand_systems_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_systems_active_idx" ON "brand_systems" USING btree ("organization_id") WHERE "brand_systems"."is_active";--> statement-breakpoint
CREATE INDEX "brand_systems_org_idx" ON "brand_systems" USING btree ("organization_id","created_at");