import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./identity";
import { editions } from "./editions";

/**
 * The studio: talking to an issue that has already been made.
 *
 * The thread is kept because it is the record of why the issue looks the way it does. "Make it two
 * pages shorter" and the four operations that carried it out belong together: six months later the
 * flatplan shows what happened and this shows who asked for it and in what words. It is also what
 * makes the next turn intelligent — an assistant that cannot remember being told "keep the cover
 * alone" is not an assistant.
 */
export const editionStudioMessages = pgTable(
  "edition_studio_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    /** "user" is the person, "assistant" is Briefly; there is no third kind and no system turn stored. */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** The operations this turn proposed, as the vocabulary validated them. */
    operations: jsonb("operations").$type<unknown[]>().notNull().default([]),
    /** What each one actually did, or why it was refused. */
    outcomes: jsonb("outcomes").$type<unknown[]>().notNull().default([]),
    /** Photographs dropped into the composer with this message. */
    mediaAssetIds: jsonb("media_asset_ids").$type<string[]>().notNull().default([]),
    /** Operations held back for a yes, so the next turn knows what "go on then" means. */
    pendingOperations: jsonb("pending_operations").$type<unknown[]>().notNull().default([]),
    restorePointId: uuid("restore_point_id"),
    aiJobId: uuid("ai_job_id"),
    pagesBefore: integer("pages_before"),
    pagesAfter: integer("pages_after"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("edition_studio_messages_edition_idx").on(t.editionId, t.createdAt)],
);

/**
 * What the issue looked like before a batch ran, so "no, put it back" is exact rather than hopeful.
 *
 * Only what the batch could touch is kept: the page plan when a page operation is in it, and the
 * body of each article the batch names. Snapshotting a whole issue on every sentence would be
 * megabytes of jsonb for the privilege of restoring things nobody changed.
 */
export const editionStudioRestorePoints = pgTable(
  "edition_studio_restore_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    /** One line saying what was about to happen, for the undo button's own label. */
    label: text("label").notNull(),
    /** { plan?: page rows, articles?: {id, headline, standfirst, body}[], extent?: {mode, pages} } */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("edition_studio_restore_edition_idx").on(t.editionId, t.createdAt)],
);
