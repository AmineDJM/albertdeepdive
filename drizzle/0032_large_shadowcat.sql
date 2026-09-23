ALTER TABLE "organizations" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "sender_reply_to" text;--> statement-breakpoint
-- The name and the reply address move from the domain to the workspace, keeping what customers chose.
-- A name equal to the workspace's own stays null, so it keeps following the workspace's name.
UPDATE "organizations" o SET
  "sender_name" = CASE WHEN d."sender_name" IS DISTINCT FROM o."name" THEN d."sender_name" END,
  "sender_reply_to" = d."reply_to"
FROM "sending_domains" d
WHERE d."organization_id" = o."id";--> statement-breakpoint
ALTER TABLE "sending_domains" DROP COLUMN "sender_name";--> statement-breakpoint
ALTER TABLE "sending_domains" DROP COLUMN "reply_to";
