import { type AnyPgColumn, boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { attachmentKindEnum, campusScopeEnum, consentTypeEnum, mediaVariantKindEnum, rightsStatusEnum, submissionStatusEnum, submissionTypeEnum } from "./enums";
import { campuses, contributors, organizations, users } from "./identity";
import { editions, submissionCampaigns, submissionRequests } from "./editions";

export type SubmissionExtra = Record<string, unknown>;

export type AiClassification = {
  storyType: string;
  sectionSlug?: string;
  confidence: number;
  tags?: string[];
  language?: string;
  summary?: string;
  reasons?: string;
};

export type AiEntities = {
  people?: { name: string; role?: string }[];
  organisations?: { name: string; type?: string }[];
  dates?: { text: string; iso?: string }[];
  places?: string[];
  metrics?: { label: string; value: string }[];
};

export type AiWarning = { code: string; message: string; severity: "info" | "warning" | "error" };

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => submissionCampaigns.id, { onDelete: "set null" }),
    requestId: uuid("request_id").references(() => submissionRequests.id, { onDelete: "set null" }),
    contributorId: uuid("contributor_id").references(() => contributors.id, { onDelete: "set null" }),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    storyType: submissionTypeEnum("story_type").notNull().default("OTHER"),
    title: text("title").notNull(),
    campusScope: campusScopeEnum("campus_scope").notNull().default("SINGLE"),
    eventDate: timestamp("event_date", { withTimezone: true }),
    eventDateText: text("event_date_text"),
    description: text("description").notNull(),
    peopleInvolved: text("people_involved"),
    organisationsInvolved: text("organisations_involved"),
    whyItMatters: text("why_it_matters"),
    quotes: text("quotes"),
    urls: text("urls").array().notNull().default([]),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    extra: jsonb("extra").$type<SubmissionExtra>().notNull().default({}),
    language: text("language").notNull().default("en"),
    status: submissionStatusEnum("status").notNull().default("NEW"),
    source: text("source").notNull().default("form"),
    publicationConsent: boolean("publication_consent").notNull().default(false),
    imageRightsConfirmed: boolean("image_rights_confirmed").notNull().default(false),
    consentTextVersion: text("consent_text_version"),
    wordCount: integer("word_count").notNull().default(0),
    normalizedText: text("normalized_text"),
    aiSummary: text("ai_summary"),
    aiClassification: jsonb("ai_classification").$type<AiClassification>(),
    aiEntities: jsonb("ai_entities").$type<AiEntities>(),
    aiWarnings: jsonb("ai_warnings").$type<AiWarning[]>().notNull().default([]),
    aiImportance: real("ai_importance"),
    suggestedClusterId: uuid("suggested_cluster_id"),
    suggestedSectionSlug: text("suggested_section_slug"),
    duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => submissions.id, { onDelete: "set null" }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("submissions_edition_idx").on(t.editionId),
    index("submissions_status_idx").on(t.editionId, t.status),
    index("submissions_contributor_idx").on(t.contributorId),
    index("submissions_type_idx").on(t.storyType),
  ],
);

export const submissionCampuses = pgTable(
  "submission_campuses",
  {
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    campusId: uuid("campus_id").notNull().references(() => campuses.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.campusId] }), index("submission_campuses_campus_idx").on(t.campusId)],
);

export type CropSuggestion = { name: string; aspect: string; x: number; y: number; width: number; height: number };

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "set null" }),
    uploadedByContributorId: uuid("uploaded_by_contributor_id").references(() => contributors.id, { onDelete: "set null" }),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    format: text("format"),
    aspectRatio: real("aspect_ratio"),
    orientation: text("orientation"),
    dominantColour: text("dominant_colour"),
    sha256: text("sha256"),
    phash: text("phash"),
    qualityScore: integer("quality_score"),
    qualityFlags: text("quality_flags").array().notNull().default([]),
    caption: text("caption"),
    altText: text("alt_text"),
    photographer: text("photographer"),
    credit: text("credit"),
    rightsStatus: rightsStatusEnum("rights_status").notNull().default("YELLOW"),
    rightsNote: text("rights_note"),
    aiDescription: text("ai_description"),
    aiTags: text("ai_tags").array().notNull().default([]),
    kind: text("kind").notNull().default("photo"), // photo | logo | screenshot | diagram | chart | document
    suggestedCrops: jsonb("suggested_crops").$type<CropSuggestion[]>().notNull().default([]),
    duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => mediaAssets.id, { onDelete: "set null" }),
    similarityGroup: text("similarity_group"),
    isArchived: boolean("is_archived").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("media_assets_edition_idx").on(t.editionId), index("media_assets_submission_idx").on(t.submissionId), index("media_assets_sha_idx").on(t.sha256), index("media_assets_phash_idx").on(t.phash)],
);

export const mediaVariants = pgTable(
  "media_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
    kind: mediaVariantKindEnum("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    format: text("format").notNull(),
    cropSpec: jsonb("crop_spec").$type<CropSuggestion | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("media_variants_asset_kind_idx").on(t.assetId, t.kind)],
);

export const submissionAttachments = pgTable(
  "submission_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    kind: attachmentKindEnum("kind").notNull().default("OTHER"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    caption: text("caption"),
    photographer: text("photographer"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("submission_attachments_submission_idx").on(t.submissionId)],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "cascade" }),
    contributorId: uuid("contributor_id").references(() => contributors.id, { onDelete: "set null" }),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, { onDelete: "cascade" }),
    type: consentTypeEnum("type").notNull(),
    textVersion: text("text_version").notNull(),
    accepted: boolean("accepted").notNull().default(true),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("consent_records_submission_idx").on(t.submissionId)],
);
