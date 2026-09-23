DROP INDEX "brand_systems_active_idx";--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "logo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_systems" ADD COLUMN "publication_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_systems" ADD CONSTRAINT "brand_systems_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_systems_publication_active_idx" ON "brand_systems" USING btree ("publication_id") WHERE "brand_systems"."is_active" and "brand_systems"."publication_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_systems_active_idx" ON "brand_systems" USING btree ("organization_id") WHERE "brand_systems"."is_active" and "brand_systems"."publication_id" is null;