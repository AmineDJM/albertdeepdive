ALTER TABLE "media_assets" ADD COLUMN "publication_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_publication_idx" ON "media_assets" USING btree ("publication_id");--> statement-breakpoint
-- Every picture that came in with an edition is in that edition's newsletter's library, and each
-- newsletter's own mark is in its own library.
UPDATE "media_assets" AS m SET "publication_id" = e."publication_id"
FROM "editions" AS e
WHERE m."edition_id" = e."id" AND e."publication_id" IS NOT NULL AND m."publication_id" IS NULL;--> statement-breakpoint
UPDATE "media_assets" AS m SET "publication_id" = p."id"
FROM "publications" AS p
WHERE p."logo_media_id" = m."id" AND m."publication_id" IS NULL;
