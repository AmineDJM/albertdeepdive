CREATE TYPE "public"."transfer_status" AS ENUM('PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "publication_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"from_organization_id" uuid NOT NULL,
	"to_organization_id" uuid NOT NULL,
	"requested_by_id" uuid,
	"owner_email" text NOT NULL,
	"recipient_email" text NOT NULL,
	"owner_code_hash" text NOT NULL,
	"recipient_code_hash" text NOT NULL,
	"owner_confirmed_at" timestamp with time zone,
	"recipient_confirmed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" "transfer_status" DEFAULT 'PENDING' NOT NULL,
	"moved" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "publication_transfers" ADD CONSTRAINT "publication_transfers_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_transfers" ADD CONSTRAINT "publication_transfers_from_organization_id_organizations_id_fk" FOREIGN KEY ("from_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_transfers" ADD CONSTRAINT "publication_transfers_to_organization_id_organizations_id_fk" FOREIGN KEY ("to_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_transfers" ADD CONSTRAINT "publication_transfers_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_transfers_publication_idx" ON "publication_transfers" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "publication_transfers_status_idx" ON "publication_transfers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");