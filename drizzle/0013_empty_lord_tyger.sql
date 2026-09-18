CREATE TYPE "public"."email_delivery" AS ENUM('PENDING', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."sending_domain_status" AS ENUM('SETTING_UP', 'WAITING_FOR_DNS', 'VERIFYING', 'READY', 'NEEDS_ATTENTION');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'EMAIL_DOMAIN_READY' BEFORE 'SYSTEM';--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider" text DEFAULT 'resend' NOT NULL,
	"type" text NOT NULL,
	"organization_id" uuid,
	"email_log_id" uuid,
	"recipient" text,
	"detail" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"root_domain" text NOT NULL,
	"domain_name" text NOT NULL,
	"provider" text DEFAULT 'resend' NOT NULL,
	"provider_domain_id" text,
	"provider_region" text,
	"status" "sending_domain_status" DEFAULT 'SETTING_UP' NOT NULL,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dns_host" text,
	"dns_host_url" text,
	"one_click_url" text,
	"sender_name" text NOT NULL,
	"sender_local_part" text DEFAULT 'newsletter' NOT NULL,
	"reply_to" text,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"notified_at" timestamp with time zone,
	"connected_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "from_address" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "delivery" "email_delivery" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "delivery_detail" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "opens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "clicks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_email_log_id_email_log_id_fk" FOREIGN KEY ("email_log_id") REFERENCES "public"."email_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_connected_by_id_users_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_provider_event_idx" ON "email_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "email_events_org_idx" ON "email_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "email_events_log_idx" ON "email_events" USING btree ("email_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domains_org_idx" ON "sending_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sending_domains_status_idx" ON "sending_domains" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sending_domains_provider_idx" ON "sending_domains" USING btree ("provider_domain_id");--> statement-breakpoint
CREATE INDEX "email_log_provider_message_idx" ON "email_log" USING btree ("provider_message_id");