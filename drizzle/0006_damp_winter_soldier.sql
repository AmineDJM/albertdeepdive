CREATE TYPE "public"."subscriber_status" AS ENUM('PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED');--> statement-breakpoint
CREATE TABLE "edition_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"edition_id" uuid NOT NULL,
	"format" "output_format" NOT NULL,
	"status" "output_status" DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version_id" uuid,
	"public_slug" text,
	"provider_campaign_id" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"opened_count" integer DEFAULT 0 NOT NULL,
	"clicked_count" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_subscriptions" (
	"publication_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "publication_subscriptions_publication_id_subscriber_id_pk" PRIMARY KEY("publication_id","subscriber_id")
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" "subscriber_status" DEFAULT 'PENDING' NOT NULL,
	"source" text DEFAULT 'form' NOT NULL,
	"confirm_token_hash" text,
	"confirm_token_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"unsubscribe_token" text NOT NULL,
	"bounced_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edition_outputs" ADD CONSTRAINT "edition_outputs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_outputs" ADD CONSTRAINT "edition_outputs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_outputs" ADD CONSTRAINT "edition_outputs_version_id_publication_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."publication_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_subscriptions" ADD CONSTRAINT "publication_subscriptions_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_subscriptions" ADD CONSTRAINT "publication_subscriptions_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edition_outputs_edition_format_idx" ON "edition_outputs" USING btree ("edition_id","format");--> statement-breakpoint
CREATE UNIQUE INDEX "edition_outputs_public_slug_idx" ON "edition_outputs" USING btree ("organization_id","public_slug");--> statement-breakpoint
CREATE INDEX "edition_outputs_edition_idx" ON "edition_outputs" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "edition_outputs_status_idx" ON "edition_outputs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publication_subscriptions_subscriber_idx" ON "publication_subscriptions" USING btree ("subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_org_email_idx" ON "subscribers" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_unsubscribe_token_idx" ON "subscribers" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "subscribers_status_idx" ON "subscribers" USING btree ("organization_id","status");--> statement-breakpoint
-- Editions that already exist were magazines: that is what the product produced before outputs
-- were a thing, and a published issue should not lose the fact that it went out.
INSERT INTO "edition_outputs" ("organization_id", "edition_id", "format", "status", "version_id", "published_at", "generated_at")
SELECT e."organization_id", e."id", 'MAGAZINE'::"output_format",
       CASE WHEN e."status" = 'PUBLISHED' THEN 'PUBLISHED'::"output_status"
            WHEN e."published_version_id" IS NOT NULL THEN 'READY'::"output_status"
            ELSE 'PENDING'::"output_status" END,
       e."published_version_id", e."published_at", e."published_at"
FROM "editions" e
ON CONFLICT DO NOTHING;
