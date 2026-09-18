import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { campaignStatusEnum, editionStatusEnum, requestStatusEnum } from "./enums";
import { campuses, contributors, organizations, publications, users } from "./identity";

export type EditionTheme = {
  coverTemplate?: string;
  accentColour?: string;
  tagline?: string;
};

export const editions = pgTable(
  "editions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    /** The recurring title this edition belongs to (Organisation → Publication → Edition → Output). */
    publicationId: uuid("publication_id").references(() => publications.id, { onDelete: "set null" }),
    issueNumber: integer("issue_number").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    label: text("label").notNull(), // e.g. "October 2026"
    month: integer("month").notNull(),
    year: integer("year").notNull(),
    status: editionStatusEnum("status").notNull().default("UPCOMING"),
    isSpecialIssue: boolean("is_special_issue").notNull().default(false),
    publicationTargetAt: timestamp("publication_target_at", { withTimezone: true }),
    finalReviewAt: timestamp("final_review_at", { withTimezone: true }),
    pageSize: text("page_size").notNull().default("A4"),
    /**
     * `auto` sizes the issue to the copy; `fixed` keeps `targetPageCount` and spends the room on
     * pictures and air. A printer's booklet needs the second; everything else is better with the first.
     */
    pageCountMode: text("page_count_mode").notNull().default("auto"),
    targetPageCount: integer("target_page_count").notNull().default(24),
    coverStoryId: uuid("cover_story_id"),
    coverHeadline: text("cover_headline"),
    coverStandfirst: text("cover_standfirst"),
    coverMediaAssetId: uuid("cover_media_asset_id"),
    editorial: text("editorial"),
    theme: jsonb("theme").$type<EditionTheme>().default({}),
    editorInChiefId: uuid("editor_in_chief_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Out of sight, not out of the record. A hidden edition leaves every list and the overview and
     * comes back with one click. Archiving is a state in the edition's life; this is housekeeping.
     */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    publishedVersionId: uuid("published_version_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("editions_slug_idx").on(t.organizationId, t.slug), uniqueIndex("editions_issue_number_idx").on(t.organizationId, t.issueNumber)],
);

export const editionSections = pgTable(
  "edition_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kicker: text("kicker"),
    description: text("description"),
    colour: text("colour"),
    sortOrder: integer("sort_order").notNull().default(0),
    isHidden: boolean("is_hidden").notNull().default(false),
    targetPages: integer("target_pages"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("edition_sections_edition_slug_idx").on(t.editionId, t.slug), index("edition_sections_edition_idx").on(t.editionId)],
);

export type CampaignTargets = Record<string, number>; // campusId (or "school") -> number of contributors to invite

export const submissionCampaigns = pgTable(
  "submission_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: campaignStatusEnum("status").notNull().default("DRAFT"),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    reminder1At: timestamp("reminder_1_at", { withTimezone: true }).notNull(),
    reminder2At: timestamp("reminder_2_at", { withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    targets: jsonb("targets").$type<CampaignTargets>().default({}),
    contributorGroupIds: uuid("contributor_group_ids").array().notNull().default([]),
    introMessage: text("intro_message"),
    autoProcess: boolean("auto_process").notNull().default(true),
    // When false (the default) a campaign does not re-invite the people invited to the previous
    // edition, so the rota rotates through the pool. Turn it on to allow them back.
    reinvitePrevious: boolean("reinvite_previous").notNull().default(false),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("submission_campaigns_edition_idx").on(t.editionId)],
);

export const submissionRequests = pgTable(
  "submission_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id").notNull().references(() => submissionCampaigns.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    contributorId: uuid("contributor_id").notNull().references(() => contributors.id, { onDelete: "cascade" }),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
    status: requestStatusEnum("status").notNull().default("PENDING"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    remindedCount: integer("reminded_count").notNull().default(0),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    submissionsCount: integer("submissions_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("submission_requests_token_hash_idx").on(t.tokenHash),
    uniqueIndex("submission_requests_campaign_contributor_idx").on(t.campaignId, t.contributorId),
    index("submission_requests_edition_idx").on(t.editionId),
  ],
);
