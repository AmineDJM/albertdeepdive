CREATE TYPE "public"."narration_kind" AS ENUM('EDITION', 'ARTICLE', 'SUMMARY', 'EXECUTIVE', 'VIDEO', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."narration_quality" AS ENUM('PREVIEW', 'FINAL');--> statement-breakpoint
CREATE TYPE "public"."narration_status" AS ENUM('QUEUED', 'ADAPTING', 'NARRATING', 'MASTERING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."voice_clone_status" AS ENUM('PENDING', 'READY', 'FAILED', 'REVOKED');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'NARRATION_READY' BEFORE 'SYSTEM';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'NARRATION_FAILED' BEFORE 'SYSTEM';--> statement-breakpoint
CREATE TABLE "brand_voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"voice_key" text,
	"gender" text DEFAULT 'auto' NOT NULL,
	"accent" text DEFAULT 'auto' NOT NULL,
	"style" text DEFAULT 'editorial' NOT NULL,
	"pace" text DEFAULT 'natural' NOT NULL,
	"language" text,
	"pronunciations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"clone_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narration_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"narration_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"take" integer DEFAULT 1 NOT NULL,
	"speaker" text DEFAULT 'narrator' NOT NULL,
	"text" text NOT NULL,
	"characters" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider" text,
	"model" text,
	"provider_voice_id" text,
	"provider_request_id" text,
	"storage_key" text,
	"mime_type" text,
	"duration_seconds" real,
	"size_bytes" integer,
	"sha256" text,
	"mean_volume_db" real,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"publication_id" uuid,
	"edition_id" uuid,
	"article_id" uuid,
	"pack_id" uuid,
	"kind" "narration_kind" NOT NULL,
	"quality" "narration_quality" DEFAULT 'PREVIEW' NOT NULL,
	"status" "narration_status" DEFAULT 'QUEUED' NOT NULL,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"language_source" text DEFAULT 'publication' NOT NULL,
	"accent" text,
	"options" jsonb NOT NULL,
	"voice_key" text,
	"voice_name" text,
	"provider_voice_id" text,
	"provider" text,
	"model" text,
	"direction" jsonb,
	"script" jsonb,
	"qa" jsonb,
	"chapters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_key" text,
	"mime_type" text,
	"duration_seconds" real,
	"size_bytes" integer,
	"sha256" text,
	"takes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"characters" integer DEFAULT 0 NOT NULL,
	"cost_cents" numeric(12, 4) DEFAULT '0' NOT NULL,
	"fingerprint" text,
	"error" text,
	"published_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speech_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"narration_id" uuid,
	"segment_id" uuid,
	"provider" text NOT NULL,
	"model" text,
	"operation" text NOT NULL,
	"quality" text,
	"characters" integer DEFAULT 0 NOT NULL,
	"seconds" real DEFAULT 0 NOT NULL,
	"cost_cents" numeric(12, 4) DEFAULT '0' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_clones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"person_name" text NOT NULL,
	"relation" text DEFAULT 'other' NOT NULL,
	"language" text,
	"consent_text" text NOT NULL,
	"consent_granted_by_id" uuid,
	"consent_granted_at" timestamp with time zone NOT NULL,
	"consent_document_key" text,
	"sample_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"provider_voice_id" text,
	"status" "voice_clone_status" DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_voices" ADD CONSTRAINT "brand_voices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_voices" ADD CONSTRAINT "brand_voices_clone_id_voice_clones_id_fk" FOREIGN KEY ("clone_id") REFERENCES "public"."voice_clones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_voices" ADD CONSTRAINT "brand_voices_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_segments" ADD CONSTRAINT "narration_segments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_segments" ADD CONSTRAINT "narration_segments_narration_id_narrations_id_fk" FOREIGN KEY ("narration_id") REFERENCES "public"."narrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_pack_id_creative_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."creative_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speech_usage" ADD CONSTRAINT "speech_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speech_usage" ADD CONSTRAINT "speech_usage_narration_id_narrations_id_fk" FOREIGN KEY ("narration_id") REFERENCES "public"."narrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speech_usage" ADD CONSTRAINT "speech_usage_segment_id_narration_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."narration_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speech_usage" ADD CONSTRAINT "speech_usage_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_consent_granted_by_id_users_id_fk" FOREIGN KEY ("consent_granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_voices_org_idx" ON "brand_voices" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "narration_segments_slot_idx" ON "narration_segments" USING btree ("narration_id","index","take");--> statement-breakpoint
CREATE INDEX "narration_segments_org_idx" ON "narration_segments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "narrations_org_idx" ON "narrations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "narrations_edition_idx" ON "narrations" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "narrations_pack_idx" ON "narrations" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "narrations_status_idx" ON "narrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "speech_usage_org_idx" ON "speech_usage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "speech_usage_narration_idx" ON "speech_usage" USING btree ("narration_id");--> statement-breakpoint
CREATE INDEX "voice_clones_org_idx" ON "voice_clones" USING btree ("organization_id","created_at");