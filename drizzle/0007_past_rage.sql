CREATE TYPE "public"."subscription_status" AS ENUM('FREE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'UNPAID', 'PAUSED');--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"organization_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid,
	"status" "subscription_status" DEFAULT 'ACTIVE' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"description" text,
	"price_monthly_cents" integer DEFAULT 0 NOT NULL,
	"price_yearly_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"stripe_product_id" text,
	"stripe_monthly_price_id" text,
	"stripe_yearly_price_id" text,
	"entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"highlights" text[] DEFAULT '{}' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_custom_priced" boolean DEFAULT false NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_event_idx" ON "billing_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "billing_events_org_idx" ON "billing_events" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_subscriptions_org_idx" ON "organization_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_subscriptions_stripe_idx" ON "organization_subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "organization_subscriptions_status_idx" ON "organization_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_idx" ON "plans" USING btree ("key");--> statement-breakpoint
CREATE INDEX "plans_sort_idx" ON "plans" USING btree ("sort_order");