DROP INDEX "academic_programs_code_idx";--> statement-breakpoint
DROP INDEX "campuses_slug_idx";--> statement-breakpoint
DROP INDEX "contributor_groups_slug_idx";--> statement-breakpoint
DROP INDEX "contributors_email_idx";--> statement-breakpoint
DROP INDEX "audience_recipients_email_idx";--> statement-breakpoint
DROP INDEX "editions_slug_idx";--> statement-breakpoint
DROP INDEX "editions_issue_number_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "academic_programs_code_idx" ON "academic_programs" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "campuses_slug_idx" ON "campuses" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "contributor_groups_slug_idx" ON "contributor_groups" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_email_idx" ON "contributors" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_recipients_email_idx" ON "audience_recipients" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_slug_idx" ON "editions" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_issue_number_idx" ON "editions" USING btree ("organization_id","issue_number");