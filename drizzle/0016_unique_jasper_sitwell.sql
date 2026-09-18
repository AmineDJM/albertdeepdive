CREATE TYPE "public"."showcase_consent" AS ENUM('NONE', 'CUSTOMER', 'PLATFORM_DEMO', 'PERMISSION');--> statement-breakpoint
CREATE TYPE "public"."showcase_event" AS ENUM('COLLECTION_VIEW', 'GALLERY_VIEW', 'ITEM_OPEN', 'SIGNUP_CLICK');--> statement-breakpoint
CREATE TABLE "collection_items" (
	"collection_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"blurb" text,
	"added_by_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_items_collection_id_edition_id_pk" PRIMARY KEY("collection_id","edition_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text,
	"description" text,
	"category" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"language" text,
	"cover_media_asset_id" uuid,
	"cover_url" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"pinned_order" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showcase_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "showcase_event" NOT NULL,
	"collection_id" uuid,
	"edition_id" uuid,
	"organization_id" uuid,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "showcase_consent" "showcase_consent" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "showcase_note" text;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "showcase_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "showcase_consent_by_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_cover_media_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_events" ADD CONSTRAINT "showcase_events_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_events" ADD CONSTRAINT "showcase_events_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_events" ADD CONSTRAINT "showcase_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_items_order_idx" ON "collection_items" USING btree ("collection_id","sort_order");--> statement-breakpoint
CREATE INDEX "collection_items_edition_idx" ON "collection_items" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_idx" ON "collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "collections_published_idx" ON "collections" USING btree ("is_published","sort_order");--> statement-breakpoint
CREATE INDEX "showcase_events_kind_day_idx" ON "showcase_events" USING btree ("kind","day");--> statement-breakpoint
CREATE INDEX "showcase_events_collection_idx" ON "showcase_events" USING btree ("collection_id","kind");--> statement-breakpoint
CREATE INDEX "showcase_events_edition_idx" ON "showcase_events" USING btree ("edition_id","kind");--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_showcase_consent_by_id_users_id_fk" FOREIGN KEY ("showcase_consent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;