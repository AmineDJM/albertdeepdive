CREATE TYPE "public"."audience_segment" AS ENUM('STUDENT', 'PARENT', 'PARTNER', 'ADMINISTRATION', 'ALUMNI', 'STAFF', 'OTHER');--> statement-breakpoint
CREATE TABLE "audience_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"segment" "audience_segment" DEFAULT 'OTHER' NOT NULL,
	"organisation" text,
	"campus_id" uuid,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience_recipients" ADD CONSTRAINT "audience_recipients_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audience_recipients_email_idx" ON "audience_recipients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audience_recipients_campus_idx" ON "audience_recipients" USING btree ("campus_id");--> statement-breakpoint
CREATE INDEX "audience_recipients_segment_idx" ON "audience_recipients" USING btree ("segment");