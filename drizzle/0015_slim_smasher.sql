CREATE TYPE "public"."image_sensitivity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."image_version_status" AS ENUM('QUEUED', 'RUNNING', 'READY', 'FAILED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "image_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"edition_id" uuid,
	"root_id" uuid,
	"parent_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"label" text DEFAULT 'Original' NOT NULL,
	"media_id" uuid,
	"operation" text NOT NULL,
	"instruction" text NOT NULL,
	"plan" jsonb,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sensitivity" "image_sensitivity" DEFAULT 'LOW' NOT NULL,
	"status" "image_version_status" DEFAULT 'QUEUED' NOT NULL,
	"provider" text,
	"model" text,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"cost_cents" numeric(12, 4) DEFAULT '0' NOT NULL,
	"qa" jsonb,
	"accepted" boolean,
	"is_current" boolean DEFAULT false NOT NULL,
	"debug" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_root_id_image_versions_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."image_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_parent_id_image_versions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."image_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_versions_org_idx" ON "image_versions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "image_versions_root_idx" ON "image_versions" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "image_versions_media_idx" ON "image_versions" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "image_versions_status_idx" ON "image_versions" USING btree ("status");