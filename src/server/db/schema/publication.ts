import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { pagePlanStatusEnum, publicationAssetKindEnum, publicationKindEnum, renderStatusEnum } from "./enums";
import { users } from "./identity";
import { editionSections, editions } from "./editions";
import { mediaAssets } from "./submissions";
import { articles, stories } from "./newsroom";
import type { WarningItem } from "./newsroom";

export type PageFitEstimate = { capacityWords: number; contentWords: number; ratio: number; overflow: boolean; imagesSlots: number; imagesUsed: number };

export const pagePlans = pgTable(
  "page_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Flatplan"),
    status: pagePlanStatusEnum("status").notNull().default("DRAFT"),
    pageSize: text("page_size").notNull().default("A4"),
    pageCount: integer("page_count").notNull().default(0),
    generatedByAi: boolean("generated_by_ai").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    validationReport: jsonb("validation_report").$type<{ ok: boolean; issues: WarningItem[]; checkedAt: string } | null>(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("page_plans_edition_idx").on(t.editionId)],
);

export const pagePlanPages = pgTable(
  "page_plan_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull().references(() => pagePlans.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    sectionId: uuid("section_id").references(() => editionSections.id, { onDelete: "set null" }),
    template: text("template").notNull().default("ARTICLE_TWO_COLUMN"),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "set null" }),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    /** All stories placed on the page (multi-item templates such as NEWS_GRID); storyId is the primary one. */
    storyIds: uuid("story_ids").array().notNull().default([]),
    mediaAssetIds: uuid("media_asset_ids").array().notNull().default([]),
    continuationOfPageId: uuid("continuation_of_page_id"),
    isLocked: boolean("is_locked").notNull().default(false),
    isArticleLocked: boolean("is_article_locked").notNull().default(false),
    isImageLocked: boolean("is_image_locked").notNull().default(false),
    fitEstimate: jsonb("fit_estimate").$type<PageFitEstimate | null>(),
    warnings: jsonb("warnings").$type<WarningItem[]>().notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("page_plan_pages_plan_number_idx").on(t.planId, t.pageNumber), index("page_plan_pages_story_idx").on(t.storyId)],
);

export type ValidationIssue = { code: string; severity: "error" | "warning" | "info"; message: string; page?: number; entityId?: string };
export type ValidationReport = { ok: boolean; issues: ValidationIssue[]; pageCount?: number; checkedAt: string; stats?: Record<string, number> };

export const publicationVersions = pgTable(
  "publication_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    label: text("label").notNull(), // v0.1, v0.2, v1.0
    sequence: integer("sequence").notNull(),
    kind: publicationKindEnum("kind").notNull().default("DRAFT"),
    status: renderStatusEnum("status").notNull().default("PENDING"),
    document: jsonb("document").$type<Record<string, unknown>>(),
    documentHash: text("document_hash"),
    validationReport: jsonb("validation_report").$type<ValidationReport | null>(),
    layoutReport: jsonb("layout_report").$type<ValidationReport | null>(),
    pdfAssetId: uuid("pdf_asset_id"),
    docxAssetId: uuid("docx_asset_id"),
    isImmutable: boolean("is_immutable").notNull().default(false),
    notes: text("notes"),
    renderLog: jsonb("render_log").$type<{ at: string; level: string; message: string }[]>().notNull().default([]),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("publication_versions_edition_sequence_idx").on(t.editionId, t.sequence)],
);

export const publicationAssets = pgTable(
  "publication_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => publicationVersions.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    kind: publicationAssetKindEnum("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count"),
    checksum: text("checksum"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("publication_assets_version_idx").on(t.versionId)],
);

export const qualityGateOverrides = pgTable(
  "quality_gate_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    gateKey: text("gate_key").notNull(),
    reason: text("reason").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quality_gate_overrides_edition_gate_idx").on(t.editionId, t.gateKey)],
);

// keep import used for typing cross-reference (media in cover)
export const _mediaRef = mediaAssets;
