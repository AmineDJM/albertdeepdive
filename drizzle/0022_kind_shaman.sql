CREATE TABLE "qc_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"organization_id" uuid,
	"metric_id" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"expected" text NOT NULL,
	"actual" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"threshold" text,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"repair_strategy" text,
	"before_value" text,
	"after_value" text,
	"repaired_at" timestamp with time zone,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"edition_id" uuid,
	"profile" text NOT NULL,
	"spec_version" text NOT NULL,
	"status" text NOT NULL,
	"worst_severity" text,
	"findings" integer DEFAULT 0 NOT NULL,
	"repaired" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"release" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triggered_by_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "qc_findings" ADD CONSTRAINT "qc_findings_run_id_qc_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."qc_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_findings" ADD CONSTRAINT "qc_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qc_findings_run_idx" ON "qc_findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "qc_findings_metric_idx" ON "qc_findings" USING btree ("metric_id","severity");--> statement-breakpoint
CREATE INDEX "qc_findings_org_idx" ON "qc_findings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "qc_runs_edition_idx" ON "qc_runs" USING btree ("edition_id","profile");--> statement-breakpoint
CREATE INDEX "qc_runs_org_idx" ON "qc_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "qc_runs_started_idx" ON "qc_runs" USING btree ("started_at");