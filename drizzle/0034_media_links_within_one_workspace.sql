-- Duplicate and similarity links were computed across every workspace on the platform, so one
-- customer's picture could be marked a duplicate of another customer's, or grouped with it. Those
-- links are undone here; the ones inside a workspace stay, and the re-check rebuilds the rest.
UPDATE "media_assets" AS a
SET "duplicate_of_id" = NULL,
    "quality_flags" = array_remove(array_remove(a."quality_flags", 'EXACT_DUPLICATE'), 'NEAR_DUPLICATE')
FROM "media_assets" AS b
WHERE a."duplicate_of_id" = b."id"
  AND a."organization_id" IS DISTINCT FROM b."organization_id";--> statement-breakpoint
UPDATE "media_assets" AS a
SET "similarity_group" = NULL,
    "quality_flags" = array_remove(a."quality_flags", 'SIMILAR_IMAGE')
FROM "media_assets" AS g
WHERE a."similarity_group" = g."id"::text
  AND a."organization_id" IS DISTINCT FROM g."organization_id";
