ALTER TABLE "submission_campaigns" ADD COLUMN "selection_mode" text DEFAULT 'DRAW' NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_campaigns" ADD COLUMN "draw_count" integer;--> statement-breakpoint
ALTER TABLE "submission_campaigns" ADD COLUMN "selected_contributor_ids" uuid[] DEFAULT '{}' NOT NULL;