ALTER TABLE "organizations" ADD COLUMN "reader_payments" jsonb;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "access" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "price_currency" text DEFAULT 'eur' NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "price_interval" text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "payment_refs" jsonb;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publication_subscriptions" ADD COLUMN "payment_status" text;--> statement-breakpoint
ALTER TABLE "publication_subscriptions" ADD COLUMN "payment_customer_id" text;--> statement-breakpoint
ALTER TABLE "publication_subscriptions" ADD COLUMN "payment_subscription_id" text;--> statement-breakpoint
ALTER TABLE "publication_subscriptions" ADD COLUMN "checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "publication_subscriptions" ADD COLUMN "paid_through" timestamp with time zone;