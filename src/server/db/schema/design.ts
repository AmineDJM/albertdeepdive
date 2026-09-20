import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { organizations, publications, users } from "./identity";
import { editions } from "./editions";
import type { BrandGenome } from "@/lib/design/genome";
import type { EditionArtDirection, PublicationIdentity } from "@/lib/design/identity";
import type { EditionDesign } from "@/lib/design/model";

/**
 * How an organisation, a title and an issue look — stored the way they are decided.
 *
 * Three tables because there are three lifetimes. A genome belongs to the organisation and changes
 * rarely. An identity belongs to a title and is versioned, because "the Review has always looked
 * like this" is a claim you must be able to check. A design belongs to one edition and one
 * revision, because §39 of the design brief wants undo and before/after to compare two real things
 * rather than two descriptions of the same thing.
 *
 * Each stores one JSON document, for the same reason the brand does: it is read whole, written
 * whole, validated by the schema that lives beside the code consuming it, and never queried by
 * field.
 */

/**
 * The organisation's editorial genome.
 *
 * Separate from `brand_systems` rather than a column on it: the genome is inferred and corrected on
 * its own schedule, and a brand refresh should not silently discard what an editor has taught
 * Briefly about how their publications breathe.
 */
export const brandGenomes = pgTable(
  "brand_genomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    genome: jsonb("genome").$type<BrandGenome>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brand_genomes_active_idx").on(t.organizationId).where(sql`${t.isActive}`),
    index("brand_genomes_org_idx").on(t.organizationId, t.createdAt),
  ],
);

/**
 * A title's editorial identity, versioned.
 *
 * Versioned because §59 allows a publication's design to evolve and §94 requires a published issue
 * to stay reproducible: an edition records the identity version it was composed under, so changing
 * the title's look next month does not rewrite what went out last month.
 */
export const publicationIdentities = pgTable(
  "publication_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    identity: jsonb("identity").$type<PublicationIdentity>().notNull(),
    /** Why this version exists: "imported from the January issue", "editor asked for more space". */
    reason: text("reason"),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("publication_identities_active_idx").on(t.publicationId).where(sql`${t.isActive}`),
    uniqueIndex("publication_identities_version_idx").on(t.publicationId, t.version),
    index("publication_identities_org_idx").on(t.organizationId, t.createdAt),
  ],
);

/**
 * What one issue is, before it is composed.
 *
 * One row per edition, replaced when the direction changes — the design versions that follow from
 * it are what history is kept of. `source` is load-bearing: a direction Briefly inferred may be
 * overruled by a later inference, and one a person stated may not.
 */
export const editionArtDirections = pgTable(
  "edition_art_directions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    identityVersion: integer("identity_version"),
    direction: jsonb("direction").$type<EditionArtDirection>().notNull(),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("edition_art_directions_edition_idx").on(t.editionId), index("edition_art_directions_org_idx").on(t.organizationId, t.createdAt)],
);

/**
 * A composed edition, one row per revision.
 *
 * The design is kept rather than regenerated because regenerating is not reproducing: a model, a
 * font metric or a photograph may have changed since. Undo, "restore this version" and the blind
 * before/after all read from here.
 */
export const editionDesigns = pgTable(
  "edition_designs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(0),
    design: jsonb("design").$type<EditionDesign>().notNull(),
    /** What changed, in the words the person used: "gave the photographs more room". */
    summary: text("summary"),
    /** Which engine composed it, so a regression can be traced to a version rather than a guess. */
    engine: text("engine").notNull().default("design-engine/1"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("edition_designs_current_idx").on(t.editionId).where(sql`${t.isCurrent}`),
    uniqueIndex("edition_designs_revision_idx").on(t.editionId, t.revision),
    index("edition_designs_org_idx").on(t.organizationId, t.createdAt),
  ],
);

/**
 * Talking to a design, kept.
 *
 * The thread is the record of *why* an issue looks the way it does. "Give the photographs more
 * room" and the three operations that carried it out belong together: six months later the design
 * history shows what happened and this shows who asked for it and in what words. It is also what
 * makes the next turn intelligent — an assistant that cannot remember being told "leave the cover
 * alone" is not an assistant.
 */
export const designMessages = pgTable(
  "design_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    /** "user" is the person, "assistant" is Briefly. There is no third kind and no system turn stored. */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** The blocks the person had selected when they spoke, so "this" is resolvable afterwards. */
    selection: jsonb("selection").$type<string[]>().notNull().default([]),
    /** The operations this turn proposed, as the vocabulary validated them. */
    operations: jsonb("operations").$type<unknown[]>().notNull().default([]),
    /** What each one actually did, or why it was refused. */
    outcomes: jsonb("outcomes").$type<unknown[]>().notNull().default([]),
    /** The design revisions either side of this turn, so a line traces to a version. */
    revisionBefore: integer("revision_before"),
    revisionAfter: integer("revision_after"),
    aiJobId: uuid("ai_job_id"),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("design_messages_edition_idx").on(t.editionId, t.createdAt)],
);
