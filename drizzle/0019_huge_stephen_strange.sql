CREATE TABLE "edition_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"edition_id" uuid NOT NULL,
	"number" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rerenders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restore_point_id" uuid,
	"pages_before" integer,
	"pages_after" integer,
	"error" text,
	"applied_at" timestamp with time zone,
	"applied_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edition_revisions" ADD CONSTRAINT "edition_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_revisions" ADD CONSTRAINT "edition_revisions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_revisions" ADD CONSTRAINT "edition_revisions_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_revisions" ADD CONSTRAINT "edition_revisions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edition_revisions_edition_idx" ON "edition_revisions" USING btree ("edition_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "edition_revisions_number_idx" ON "edition_revisions" USING btree ("edition_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "edition_revisions_open_idx" ON "edition_revisions" USING btree ("edition_id") WHERE "edition_revisions"."status" = 'DRAFT';