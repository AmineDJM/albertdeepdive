import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { imageSensitivityEnum, imageVersionStatusEnum } from "./enums";
import { organizations, users } from "./identity";
import { editions } from "./editions";
import { mediaAssets } from "./submissions";
import type { ImageEditPlan, ImageQa, ReferenceRole } from "@/lib/images/types";

/**
 * Pictures, made and remade, without ever losing one.
 *
 * A version is one picture: the result of a generation, or of an edit applied to an earlier
 * version. Every version is a row and a file of its own — v1 Original, v2 Background changed, v3
 * Product added — so an edit is never an overwrite, undo is a pointer moved back, and a branch is
 * a second child of the same parent. The lineage carries what was asked, how it was understood
 * (the plan), what was protected, which provider did it, how long it took, what it cost, what the
 * check thought, and whether a person kept it: the ledger routing will one day be tuned from.
 */

export type ImageAttempt = { provider: string; model: string; modelKey?: string; latencyMs: number; error: string | null; qaScore: number | null };

export type ImageReference = { role: ReferenceRole; mediaId: string };

export const imageVersions = pgTable(
  "image_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    /** The first picture of this line; null on the root itself. */
    rootId: uuid("root_id").references((): AnyPgColumn => imageVersions.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => imageVersions.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    /** A short name for what this version changed: "Background changed". */
    label: text("label").notNull().default("Original"),
    /** The picture itself, in the library, once there is one. */
    mediaId: uuid("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),

    /** generate, edit, regenerate (from the master with the accumulated edits). */
    operation: text("operation").notNull(),
    instruction: text("instruction").notNull(),
    plan: jsonb("plan").$type<ImageEditPlan | null>(),
    references: jsonb("references").$type<ImageReference[]>().notNull().default([]),
    sensitivity: imageSensitivityEnum("sensitivity").notNull().default("LOW"),
    status: imageVersionStatusEnum("status").notNull().default("QUEUED"),

    /** Who actually made it, after any fallback. */
    provider: text("provider"),
    model: text("model"),
    attempts: jsonb("attempts").$type<ImageAttempt[]>().notNull().default([]),
    retries: integer("retries").notNull().default(0),
    latencyMs: integer("latency_ms"),
    costCents: numeric("cost_cents", { precision: 12, scale: 4 }).notNull().default("0"),
    qa: jsonb("qa").$type<ImageQa | null>(),
    /** Null until a person decides; true when kept, false when thrown out. */
    accepted: boolean("accepted"),
    /** The version the person is looking at as the current one in this line. */
    isCurrent: boolean("is_current").notNull().default(false),
    /** Routing and prompt, for the debug view a platform admin can open. Never shown to customers. */
    debug: jsonb("debug").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),

    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("image_versions_org_idx").on(t.organizationId, t.createdAt),
    index("image_versions_root_idx").on(t.rootId),
    index("image_versions_media_idx").on(t.mediaId),
    index("image_versions_status_idx").on(t.status),
  ],
);
