ALTER TYPE "public"."render_status" ADD VALUE 'PREFLIGHT' BEFORE 'READY';--> statement-breakpoint
ALTER TYPE "public"."render_status" ADD VALUE 'REPAIRING' BEFORE 'READY';--> statement-breakpoint
ALTER TABLE "qc_runs" ADD COLUMN "version_id" uuid;--> statement-breakpoint
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_version_id_publication_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."publication_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qc_runs_version_idx" ON "qc_runs" USING btree ("version_id");