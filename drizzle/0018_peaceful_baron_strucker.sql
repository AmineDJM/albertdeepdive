CREATE TABLE "edition_studio_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"edition_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restore_point_id" uuid,
	"ai_job_id" uuid,
	"pages_before" integer,
	"pages_after" integer,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_studio_restore_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"edition_id" uuid NOT NULL,
	"label" text NOT NULL,
	"payload" jsonb NOT NULL,
	"restored_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edition_studio_messages" ADD CONSTRAINT "edition_studio_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_studio_messages" ADD CONSTRAINT "edition_studio_messages_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_studio_messages" ADD CONSTRAINT "edition_studio_messages_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_studio_restore_points" ADD CONSTRAINT "edition_studio_restore_points_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_studio_restore_points" ADD CONSTRAINT "edition_studio_restore_points_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_studio_restore_points" ADD CONSTRAINT "edition_studio_restore_points_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edition_studio_messages_edition_idx" ON "edition_studio_messages" USING btree ("edition_id","created_at");--> statement-breakpoint
CREATE INDEX "edition_studio_restore_edition_idx" ON "edition_studio_restore_points" USING btree ("edition_id","created_at");