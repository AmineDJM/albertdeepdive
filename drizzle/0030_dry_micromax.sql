CREATE TABLE "publication_contributors" (
	"publication_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"source" text DEFAULT 'form' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_contributors_publication_id_contributor_id_pk" PRIMARY KEY("publication_id","contributor_id")
);
--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "join_slug" text;--> statement-breakpoint
ALTER TABLE "publication_contributors" ADD CONSTRAINT "publication_contributors_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_contributors" ADD CONSTRAINT "publication_contributors_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_contributors_contributor_idx" ON "publication_contributors" USING btree ("contributor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_join_slug_idx" ON "publications" USING btree ("join_slug");