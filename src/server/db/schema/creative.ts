import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { organizations, publications, users } from "./identity";
import { editions } from "./editions";
import { mediaAssets } from "./submissions";
import { stories } from "./newsroom";
import { brandSystems } from "./brand";
import type { CreativeBrief, RenderSpec } from "@/lib/creative/brief";

/**
 * Creative Studio.
 *
 * A pack is one thing somebody posts: a carousel, a Story, a Reel. An asset is one file inside it —
 * a slide, a video, the caption. They are separate tables because a pack is edited and re-rendered
 * as a whole while its assets are produced one at a time, some of them slowly and some of them by
 * somebody else's API.
 *
 * The three columns that matter, and why:
 *
 *   `brief` is what the Art Director wrote — the model's contribution, in a vocabulary of named
 *   surfaces and named emphasis. It is kept because it is the editable thing: changing a headline
 *   means changing the brief and re-composing, not patching a pixel.
 *
 *   `spec` is what the composer resolved: every colour, every box, every type step. Kept because it
 *   is what was actually drawn. A pack rendered in March can be re-rendered in December and produce
 *   the same file, which is the difference between reproducing work and approximating it.
 *
 *   `brandSystemId` pins which version of the organisation's identity was in force. Brands change;
 *   a finished post should not.
 */

export const creativeFormatEnum = pgEnum("creative_format", ["CAROUSEL", "STORY", "SQUARE_POST", "REEL", "LINKEDIN_VIDEO"]);
export const creativeModeEnum = pgEnum("creative_mode", ["AUTHENTIC", "STUDIO", "CINEMATIC"]);

/**
 * A pack's life.
 *
 * DIRECTING and COMPOSING are separate because they fail differently and cost differently: directing
 * is a model call that can return nonsense, composing is arithmetic that cannot. Keeping them apart
 * means a retry after a bad brief does not re-render anything, and a re-render after a brand change
 * does not re-ask the model.
 */
export const creativePackStatusEnum = pgEnum("creative_pack_status", ["DRAFT", "DIRECTING", "COMPOSING", "RENDERING", "READY", "FAILED"]);
export const creativeAssetStatusEnum = pgEnum("creative_asset_status", ["PENDING", "RENDERING", "READY", "FAILED"]);
export const creativeAssetKindEnum = pgEnum("creative_asset_kind", ["FRAME", "VIDEO", "COVER", "CAPTION"]);

export const creativePacks = pgTable(
  "creative_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicationId: uuid("publication_id").references(() => publications.id, { onDelete: "set null" }),
    /** What this was made from. An edition, a single story, or nothing at all. */
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "set null" }),

    name: text("name").notNull(),
    format: creativeFormatEnum("format").notNull(),
    mode: creativeModeEnum("mode").notNull().default("STUDIO"),
    status: creativePackStatusEnum("status").notNull().default("DRAFT"),
    /** Which of the format's design systems was used. */
    designSystem: text("design_system").notNull().default("default"),

    brief: jsonb("brief").$type<CreativeBrief | null>(),
    spec: jsonb("spec").$type<RenderSpec | null>(),
    brandSystemId: uuid("brand_system_id").references(() => brandSystems.id, { onDelete: "set null" }),
    /** The spec's hash, so an unchanged pack is never re-rendered. */
    fingerprint: text("fingerprint"),

    /** What it has cost so far, in tenths of a cent — model calls plus any generated media. */
    costCents: numeric("cost_cents", { precision: 12, scale: 4 }).notNull().default("0"),
    /** Why it failed, in the words the person who has to fix it needs. */
    error: text("error"),

    /** Set when somebody has actually posted it, so the studio can stop suggesting it. */
    publishedAt: timestamp("published_at", { withTimezone: true }),

    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("creative_packs_org_idx").on(t.organizationId, t.createdAt),
    index("creative_packs_edition_idx").on(t.editionId),
    index("creative_packs_status_idx").on(t.status),
  ],
);

export const creativeAssets = pgTable(
  "creative_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    packId: uuid("pack_id")
      .notNull()
      .references(() => creativePacks.id, { onDelete: "cascade" }),

    kind: creativeAssetKindEnum("kind").notNull().default("FRAME"),
    /** Position within the pack: slide 1, slide 2. Zero for anything that is not a frame. */
    index: integer("index").notNull().default(0),
    status: creativeAssetStatusEnum("status").notNull().default("PENDING"),

    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: integer("size_bytes"),
    durationSeconds: real("duration_seconds"),
    /** Of the rendered bytes. Two identical specs must produce this same value. */
    sha256: text("sha256"),

    /** The organisation's own photograph placed in this frame, when there is one. */
    mediaId: uuid("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    /** Set when the picture was produced by a provider rather than photographed. */
    generated: boolean("generated").notNull().default(false),
    alt: text("alt"),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One asset per slot. A re-render replaces a row rather than adding a second slide 3.
    uniqueIndex("creative_assets_slot_idx").on(t.packId, t.kind, t.index),
    index("creative_assets_org_idx").on(t.organizationId),
  ],
);

/**
 * What creative work cost, line by line.
 *
 * Separate from `ai_jobs` because the questions are different. That table answers "what did the
 * newsroom pipeline spend"; this answers "what did this carousel cost, and is the plan's credit
 * allowance used up". It is also the enforcement point: a workspace with a credit limit has it
 * checked against the sum of these rows, so an entitlement is arithmetic over a ledger rather than a
 * counter somebody has to remember to increment.
 *
 * Every row names its provider and its unit, because a bill that says "AI: €340" is not a bill
 * anybody can act on.
 */
export const creativeCosts = pgTable(
  "creative_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    packId: uuid("pack_id").references(() => creativePacks.id, { onDelete: "set null" }),
    assetId: uuid("asset_id").references(() => creativeAssets.id, { onDelete: "set null" }),

    /** "openai", "higgsfield", "briefly" — the last for work done in-house, which costs nothing. */
    provider: text("provider").notNull(),
    /** "direct", "image", "video", "render". */
    operation: text("operation").notNull(),
    model: text("model"),
    /** How many of whatever this provider charges for. */
    units: real("units").notNull().default(1),
    unit: text("unit").notNull().default("call"),
    costCents: numeric("cost_cents", { precision: 12, scale: 4 }).notNull().default("0"),
    /** Credits are the customer-facing currency; cents are ours. */
    credits: integer("credits").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("creative_costs_org_idx").on(t.organizationId, t.createdAt), index("creative_costs_pack_idx").on(t.packId)],
);
