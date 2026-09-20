CREATE TABLE "brand_genomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"genome" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_art_directions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"identity_version" integer,
	"direction" jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"design" jsonb NOT NULL,
	"summary" text,
	"engine" text DEFAULT 'design-engine/1' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"identity" jsonb NOT NULL,
	"reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_genomes" ADD CONSTRAINT "brand_genomes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_genomes" ADD CONSTRAINT "brand_genomes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_art_directions" ADD CONSTRAINT "edition_art_directions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_art_directions" ADD CONSTRAINT "edition_art_directions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_art_directions" ADD CONSTRAINT "edition_art_directions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_designs" ADD CONSTRAINT "edition_designs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_designs" ADD CONSTRAINT "edition_designs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_designs" ADD CONSTRAINT "edition_designs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_identities" ADD CONSTRAINT "publication_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_identities" ADD CONSTRAINT "publication_identities_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_identities" ADD CONSTRAINT "publication_identities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_genomes_active_idx" ON "brand_genomes" USING btree ("organization_id") WHERE "brand_genomes"."is_active";--> statement-breakpoint
CREATE INDEX "brand_genomes_org_idx" ON "brand_genomes" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "edition_art_directions_edition_idx" ON "edition_art_directions" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "edition_art_directions_org_idx" ON "edition_art_directions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "edition_designs_current_idx" ON "edition_designs" USING btree ("edition_id") WHERE "edition_designs"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "edition_designs_revision_idx" ON "edition_designs" USING btree ("edition_id","revision");--> statement-breakpoint
CREATE INDEX "edition_designs_org_idx" ON "edition_designs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_identities_active_idx" ON "publication_identities" USING btree ("publication_id") WHERE "publication_identities"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "publication_identities_version_idx" ON "publication_identities" USING btree ("publication_id","version");--> statement-breakpoint
CREATE INDEX "publication_identities_org_idx" ON "publication_identities" USING btree ("organization_id","created_at");