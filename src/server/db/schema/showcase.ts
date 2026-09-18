import { boolean, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { showcaseEventEnum } from "./enums";
import { organizations, users } from "./identity";
import { editions } from "./editions";
import { mediaAssets } from "./submissions";

/**
 * The public gallery: collections of real editions, shown to people who are not customers yet.
 *
 * A collection is curation, not storage. It names a set of editions and an order for them; the
 * editions belong to the customers who made them and are not copied anywhere. The same edition sits
 * in as many collections as it deserves, because the row that joins them carries the order and the
 * blurb, not the work.
 *
 * Nothing here can make anything public. Whether an edition may be shown at all is decided by its
 * title's consent and by the edition already having a published web address; a collection can only
 * point at what is already open. Putting a row in `collection_items` for an edition that is not
 * showable makes that row invisible, not that edition visible.
 */
export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** One line under the title, on the card and at the top of the collection's own page. */
    tagline: text("tagline"),
    description: text("description"),
    /** The shelf it sits on in the gallery: universities, startups, communities, events… */
    category: text("category"),
    tags: text("tags").array().notNull().default([]),
    language: text("language"),
    coverMediaAssetId: uuid("cover_media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    /** An address for a cover Briefly does not host, for a collection made before any edition is in it. */
    coverUrl: text("cover_url"),
    /** Drafts are invisible to the public however complete they look. Nothing is published by accident. */
    isPublished: boolean("is_published").notNull().default(false),
    /** On the gallery's front page. */
    isFeatured: boolean("is_featured").notNull().default(false),
    /** Held at the top of the featured row, in this order. */
    pinnedOrder: integer("pinned_order"),
    sortOrder: integer("sort_order").notNull().default(0),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("collections_slug_idx").on(t.slug), index("collections_published_idx").on(t.isPublished, t.sortOrder)],
);

export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Larger on the grid, and the one used as the collection's cover when it has none of its own. */
    isFeatured: boolean("is_featured").notNull().default(false),
    /** What the curator says about this one here, which may differ from one collection to the next. */
    blurb: text("blurb"),
    addedById: uuid("added_by_id").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.editionId] }), index("collection_items_order_idx").on(t.collectionId, t.sortOrder), index("collection_items_edition_idx").on(t.editionId)],
);

/**
 * What visitors did, counted without knowing who they are.
 *
 * No address, no cookie, no fingerprint: a kind, what it was about, and the day. That is enough to
 * answer which examples people open and which collections send them to sign up, and not enough to
 * follow anybody. The day is stored beside the timestamp so a year of rollups stays one index scan.
 */
export const showcaseEvents = pgTable(
  "showcase_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: showcaseEventEnum("kind").notNull(),
    collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    /** The organisation whose work was looked at, kept so a customer can be shown their own reach. */
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("showcase_events_kind_day_idx").on(t.kind, t.day), index("showcase_events_collection_idx").on(t.collectionId, t.kind), index("showcase_events_edition_idx").on(t.editionId, t.kind)],
);
