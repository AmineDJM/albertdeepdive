CREATE TYPE "public"."organization_role" AS ENUM('OWNER', 'ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('ACTIVE', 'SUSPENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('COMPANY', 'SCHOOL', 'UNIVERSITY', 'ASSOCIATION', 'COMMUNITY', 'INVESTOR', 'MEDIA', 'INSTITUTION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."output_format" AS ENUM('EMAIL', 'WEB', 'MAGAZINE', 'PRINT');--> statement-breakpoint
CREATE TYPE "public"."output_status" AS ENUM('NOT_CONFIGURED', 'PENDING', 'GENERATING', 'READY', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "organization_role" DEFAULT 'VIEWER' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"invited_by_id" uuid,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "organization_type" DEFAULT 'COMPANY' NOT NULL,
	"status" "organization_status" DEFAULT 'ACTIVE' NOT NULL,
	"website" text,
	"description" text,
	"logo_media_id" uuid,
	"logo_url" text,
	"favicon_url" text,
	"brand_colours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"country" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "publication_status" DEFAULT 'ACTIVE' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"default_formats" text[] DEFAULT '{"EMAIL"}' NOT NULL,
	"cadence" text DEFAULT 'monthly' NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subscribe_slug" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_programs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "campuses" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "contributor_groups" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "contributors" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "audience_recipients" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "publication_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_unique_idx" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_org_slug_idx" ON "publications" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_subscribe_slug_idx" ON "publications" USING btree ("subscribe_slug");--> statement-breakpoint
CREATE INDEX "publications_org_idx" ON "publications" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "academic_programs" ADD CONSTRAINT "academic_programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_groups" ADD CONSTRAINT "contributor_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_recipients" ADD CONSTRAINT "audience_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: everything that existed before multi-tenancy belongs to one workspace.
-- Briefly is multi-tenant from here on; the original newsroom becomes customer #1 and keeps
-- every edition, contributor and asset it already had. Skipped on a fresh install, where there
-- is nothing to adopt and the first workspace is created by onboarding instead.
DO $$
DECLARE
  legacy_org uuid;
  legacy_pub uuid;
  owner_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users" LIMIT 1) AND NOT EXISTS (SELECT 1 FROM "editions" LIMIT 1) THEN
    RETURN;
  END IF;

  SELECT "id" INTO legacy_org FROM "organizations" WHERE "slug" = 'albert-school';
  IF legacy_org IS NULL THEN
    SELECT "id" INTO owner_id FROM "users" WHERE "role" = 'SUPER_ADMIN' ORDER BY "created_at" LIMIT 1;
    INSERT INTO "organizations" ("name", "slug", "type", "website", "locale", "timezone", "country", "created_by_id", "onboarded_at")
    VALUES ('Albert School', 'albert-school', 'SCHOOL', 'https://albertschool.com', 'en', 'Europe/Paris', 'France', owner_id, now())
    RETURNING "id" INTO legacy_org;
  END IF;

  UPDATE "academic_programs"  SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "campuses"           SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "contributor_groups" SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "contributors"       SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "audience_recipients" SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "editions"           SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "media_assets"       SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "ai_jobs"            SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "audit_log"          SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "automation_runs"    SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "email_log"          SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "jobs"               SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "notifications"      SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;
  UPDATE "prompt_templates"   SET "organization_id" = legacy_org WHERE "organization_id" IS NULL;

  -- The existing editions were all issues of one recurring title.
  SELECT "id" INTO legacy_pub FROM "publications" WHERE "organization_id" = legacy_org AND "slug" = 'deep-dive';
  IF legacy_pub IS NULL THEN
    INSERT INTO "publications" ("organization_id", "name", "slug", "description", "language", "default_formats", "cadence", "subscribe_slug", "created_by_id")
    VALUES (legacy_org, 'Albert Deep Dive', 'deep-dive', 'The monthly magazine of Albert School.', 'en', '{"MAGAZINE","EMAIL"}', 'monthly', 'albert-deep-dive', owner_id)
    RETURNING "id" INTO legacy_pub;
  END IF;
  UPDATE "editions" SET "publication_id" = legacy_pub WHERE "publication_id" IS NULL;

  -- Everyone who could sign in keeps the same reach inside the workspace.
  INSERT INTO "organization_members" ("organization_id", "user_id", "role", "is_default", "accepted_at")
  SELECT legacy_org, u."id",
         CASE u."role"
           WHEN 'SUPER_ADMIN' THEN 'OWNER'::"organization_role"
           WHEN 'EDITOR_IN_CHIEF' THEN 'ADMIN'::"organization_role"
           WHEN 'EDITOR' THEN 'EDITOR'::"organization_role"
           WHEN 'CAMPUS_EDITOR' THEN 'EDITOR'::"organization_role"
           WHEN 'CONTRIBUTOR' THEN 'CONTRIBUTOR'::"organization_role"
           ELSE 'VIEWER'::"organization_role"
         END,
         true, u."created_at"
  FROM "users" u
  ON CONFLICT DO NOTHING;
END $$;
