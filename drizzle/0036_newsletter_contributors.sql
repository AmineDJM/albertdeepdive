-- A newsletter's contributors are its own. Everybody an edition of a newsletter already asked is
-- one of that newsletter's contributors; and where an organisation has a single newsletter, every
-- one of its contributors writes for it.
INSERT INTO "publication_contributors" ("publication_id", "contributor_id", "source")
SELECT DISTINCT e."publication_id", r."contributor_id", 'campaign'
FROM "submission_requests" AS r
JOIN "submission_campaigns" AS c ON c."id" = r."campaign_id"
JOIN "editions" AS e ON e."id" = c."edition_id"
WHERE e."publication_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "publication_contributors" ("publication_id", "contributor_id", "source")
SELECT p."id", c."id", 'by-hand'
FROM "contributors" AS c
JOIN "publications" AS p ON p."organization_id" = c."organization_id"
WHERE (SELECT count(*) FROM "publications" AS q WHERE q."organization_id" = c."organization_id") = 1
ON CONFLICT DO NOTHING;
