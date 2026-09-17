CREATE TYPE "public"."creative_asset_kind" AS ENUM('FRAME', 'VIDEO', 'COVER', 'CAPTION');--> statement-breakpoint
CREATE TYPE "public"."creative_asset_status" AS ENUM('PENDING', 'RENDERING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."creative_format" AS ENUM('CAROUSEL', 'STORY', 'SQUARE_POST', 'REEL', 'LINKEDIN_VIDEO');--> statement-breakpoint
CREATE TYPE "public"."creative_mode" AS ENUM('AUTHENTIC', 'STUDIO', 'CINEMATIC');--> statement-breakpoint
CREATE TYPE "public"."creative_pack_status" AS ENUM('DRAFT', 'DIRECTING', 'COMPOSING', 'RENDERING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "creative_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"kind" "creative_asset_kind" DEFAULT 'FRAME' NOT NULL,
	"index" integer DEFAULT 0 NOT NULL,
	"status" "creative_asset_status" DEFAULT 'PENDING' NOT NULL,
	"storage_key" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"duration_seconds" real,
	"sha256" text,
	"media_id" uuid,
	"generated" boolean DEFAULT false NOT NULL,
	"alt" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pack_id" uuid,
	"asset_id" uuid,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"model" text,
	"units" real DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'call' NOT NULL,
	"cost_cents" numeric(12, 4) DEFAULT '0' NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"publication_id" uuid,
	"edition_id" uuid,
	"story_id" uuid,
	"name" text NOT NULL,
	"format" "creative_format" NOT NULL,
	"mode" "creative_mode" DEFAULT 'STUDIO' NOT NULL,
	"status" "creative_pack_status" DEFAULT 'DRAFT' NOT NULL,
	"design_system" text DEFAULT 'default' NOT NULL,
	"brief" jsonb,
	"spec" jsonb,
	"brand_system_id" uuid,
	"fingerprint" text,
	"cost_cents" numeric(12, 4) DEFAULT '0' NOT NULL,
	"error" text,
	"published_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creative_assets" ADD CONSTRAINT "creative_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD CONSTRAINT "creative_assets_pack_id_creative_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."creative_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_assets" ADD CONSTRAINT "creative_assets_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_costs" ADD CONSTRAINT "creative_costs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_costs" ADD CONSTRAINT "creative_costs_pack_id_creative_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."creative_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_costs" ADD CONSTRAINT "creative_costs_asset_id_creative_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."creative_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_packs" ADD CONSTRAINT "creative_packs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_packs" ADD CONSTRAINT "creative_packs_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_packs" ADD CONSTRAINT "creative_packs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_packs" ADD CONSTRAINT "creative_packs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_packs" ADD CONSTRAINT "creative_packs_brand_system_id_brand_systems_id_fk" FOREIGN KEY ("brand_system_id") REFERENCES "public"."brand_systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_packs" ADD CONSTRAINT "creative_packs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_assets_slot_idx" ON "creative_assets" USING btree ("pack_id","kind","index");--> statement-breakpoint
CREATE INDEX "creative_assets_org_idx" ON "creative_assets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "creative_costs_org_idx" ON "creative_costs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "creative_costs_pack_idx" ON "creative_costs" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "creative_packs_org_idx" ON "creative_packs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "creative_packs_edition_idx" ON "creative_packs" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "creative_packs_status_idx" ON "creative_packs" USING btree ("status");