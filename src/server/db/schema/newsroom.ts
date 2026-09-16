import { type AnyPgColumn, boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { articleStatusEnum, clusterStatusEnum, entityTypeEnum, factConfidenceEnum, factStatusEnum, infoRequestStatusEnum, organisationRoleEnum, organisationTypeEnum, personRoleEnum, storyStatusEnum, submissionTypeEnum } from "./enums";
import { academicPrograms, campuses, contributors, users } from "./identity";
import { editionSections, editions } from "./editions";
import { mediaAssets, submissions } from "./submissions";

export type MissingInformationItem = { key: string; label: string; severity: "low" | "medium" | "high"; resolved?: boolean };
export type AiScores = Record<string, number> & { total?: number };
export type WarningItem = { code: string; message: string; severity: "info" | "warning" | "error"; entityId?: string };

export type FactSheetEntry = {
  statement: string;
  sourceSubmissionIds: string[];
  confidence: "VERIFIED_BY_SUBMISSION" | "STATED_BY_CONTRIBUTOR" | "INFERRED" | "CONFLICTING";
  excerpt?: string;
};

export const storyClusters = pgTable(
  "story_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary"),
    status: clusterStatusEnum("status").notNull().default("PROPOSED"),
    primaryStoryType: submissionTypeEnum("primary_story_type").notNull().default("OTHER"),
    suggestedSectionSlug: text("suggested_section_slug"),
    submissionCount: integer("submission_count").notNull().default(0),
    mediaCount: integer("media_count").notNull().default(0),
    quoteCount: integer("quote_count").notNull().default(0),
    factSheet: jsonb("fact_sheet").$type<FactSheetEntry[]>().notNull().default([]),
    aiScores: jsonb("ai_scores").$type<AiScores>().notNull().default({}),
    aiScoreTotal: real("ai_score_total"),
    missingInformation: jsonb("missing_information").$type<MissingInformationItem[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<WarningItem[]>().notNull().default([]),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => storyClusters.id, { onDelete: "set null" }),
    createdByAi: boolean("created_by_ai").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("story_clusters_edition_idx").on(t.editionId)],
);

export const storyClusterMembers = pgTable(
  "story_cluster_members",
  {
    clusterId: uuid("cluster_id").notNull().references(() => storyClusters.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    similarity: real("similarity"),
    isPrimary: boolean("is_primary").notNull().default(false),
    addedByAi: boolean("added_by_ai").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clusterId, t.submissionId] }), index("story_cluster_members_submission_idx").on(t.submissionId)],
);

export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id").references(() => storyClusters.id, { onDelete: "set null" }),
    sectionId: uuid("section_id").references(() => editionSections.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    status: storyStatusEnum("status").notNull().default("CANDIDATE"),
    storyType: submissionTypeEnum("story_type").notNull().default("OTHER"),
    summary: text("summary"),
    eventDate: timestamp("event_date", { withTimezone: true }),
    priority: integer("priority").notNull().default(50),
    isCover: boolean("is_cover").notNull().default(false),
    isSpotlight: boolean("is_spotlight").notNull().default(false),
    aiScores: jsonb("ai_scores").$type<AiScores>().notNull().default({}),
    editorialScore: integer("editorial_score"),
    aiNotes: jsonb("ai_notes").$type<string[]>().notNull().default([]),
    editorialNotes: text("editorial_notes"),
    warnings: jsonb("warnings").$type<WarningItem[]>().notNull().default([]),
    missingInformation: jsonb("missing_information").$type<MissingInformationItem[]>().notNull().default([]),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
    suggestedTemplate: text("suggested_template"),
    targetLength: text("target_length").notNull().default("MEDIUM"), // SHORT | MEDIUM | LONG | FEATURE
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("stories_edition_idx").on(t.editionId), uniqueIndex("stories_edition_slug_idx").on(t.editionId, t.slug), index("stories_section_idx").on(t.sectionId)],
);

export const storyCampuses = pgTable(
  "story_campuses",
  {
    storyId: uuid("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    campusId: uuid("campus_id").notNull().references(() => campuses.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.campusId] })],
);

export const storyMedia = pgTable(
  "story_media",
  {
    storyId: uuid("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("gallery"), // hero | gallery | logo | diagram | screenshot | portrait
    sortOrder: integer("sort_order").notNull().default(0),
    isLocked: boolean("is_locked").notNull().default(false),
    addedByAi: boolean("added_by_ai").notNull().default(false),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.mediaAssetId] })],
);

export type ArticleBlock =
  | { id: string; type: "paragraph"; text: string; sources?: string[] }
  | { id: string; type: "crosshead"; text: string }
  | { id: string; type: "pullquote"; text: string; attribution?: string; sources?: string[] }
  | { id: string; type: "list"; items: string[]; ordered?: boolean; sources?: string[] }
  | { id: string; type: "image"; assetId: string; caption?: string; credit?: string; size?: "inline" | "wide" | "full" }
  | { id: string; type: "box"; title?: string; items?: string[]; text?: string; sources?: string[] }
  | { id: string; type: "qa"; question: string; answer: string; sources?: string[] }
  | { id: string; type: "testimony"; text: string; speaker?: string; sources?: string[] }
  | { id: string; type: "divider" };

export type ArticleProvenance = Record<string, { submissionIds: string[]; factIds?: string[]; note?: string }>;

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    kicker: text("kicker"),
    headline: text("headline").notNull().default(""),
    standfirst: text("standfirst"),
    byline: text("byline"),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorContributorId: uuid("author_contributor_id").references(() => contributors.id, { onDelete: "set null" }),
    body: jsonb("body").$type<ArticleBlock[]>().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    language: text("language").notNull().default("en"),
    wordCount: integer("word_count").notNull().default(0),
    status: articleStatusEnum("status").notNull().default("EMPTY"),
    currentRevision: integer("current_revision").notNull().default(0),
    provenance: jsonb("provenance").$type<ArticleProvenance>().notNull().default({}),
    warnings: jsonb("warnings").$type<WarningItem[]>().notNull().default([]),
    headlineAlternatives: jsonb("headline_alternatives").$type<string[]>().notNull().default([]),
    aiDraftedAt: timestamp("ai_drafted_at", { withTimezone: true }),
    lastEditedById: uuid("last_edited_by_id").references(() => users.id, { onDelete: "set null" }),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    manualEditRatio: real("manual_edit_ratio"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("articles_story_idx").on(t.storyId), index("articles_edition_idx").on(t.editionId)],
);

export const articleRevisions = pgTable(
  "article_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    kicker: text("kicker"),
    headline: text("headline").notNull().default(""),
    standfirst: text("standfirst"),
    byline: text("byline"),
    body: jsonb("body").$type<ArticleBlock[]>().notNull().default([]),
    wordCount: integer("word_count").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByAi: boolean("created_by_ai").notNull().default(false),
    aiJobId: uuid("ai_job_id"),
    changeSummary: text("change_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("article_revisions_article_version_idx").on(t.articleId, t.version)],
);

export const articleSources = pgTable(
  "article_sources",
  {
    articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("PRIMARY"), // PRIMARY | SUPPORTING | PHOTO | EXTERNAL
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.submissionId] })],
);

export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id").references(() => storyClusters.id, { onDelete: "set null" }),
    statement: text("statement").notNull(),
    category: text("category"), // date | person | result | organisation | metric | award | other
    sourceSubmissionId: uuid("source_submission_id").references(() => submissions.id, { onDelete: "set null" }),
    sourceExcerpt: text("source_excerpt"),
    confidence: factConfidenceEnum("confidence").notNull().default("STATED_BY_CONTRIBUTOR"),
    status: factStatusEnum("status").notNull().default("ACTIVE"),
    conflictGroup: text("conflict_group"),
    conflictsWithFactId: uuid("conflicts_with_fact_id").references((): AnyPgColumn => facts.id, { onDelete: "set null" }),
    verifiedById: uuid("verified_by_id").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    notes: text("notes"),
    createdByAi: boolean("created_by_ai").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("facts_story_idx").on(t.storyId), index("facts_edition_idx").on(t.editionId)],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id").references(() => storyClusters.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    speakerName: text("speaker_name"),
    speakerRole: text("speaker_role"),
    sourceSubmissionId: uuid("source_submission_id").references(() => submissions.id, { onDelete: "set null" }),
    isPullQuoteCandidate: boolean("is_pull_quote_candidate").notNull().default(false),
    aiScore: real("ai_score"),
    isApproved: boolean("is_approved").notNull().default(false),
    createdByAi: boolean("created_by_ai").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quotes_story_idx").on(t.storyId)],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    role: text("role"),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    programId: uuid("program_id").references(() => academicPrograms.id, { onDelete: "set null" }),
    contributorId: uuid("contributor_id").references(() => contributors.id, { onDelete: "set null" }),
    notes: text("notes"),
    mentionsCount: integer("mentions_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("people_normalized_name_idx").on(t.normalizedName)],
);

export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    type: organisationTypeEnum("type").notNull().default("COMPANY"),
    website: text("website"),
    logoAssetId: uuid("logo_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    notes: text("notes"),
    mentionsCount: integer("mentions_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organisations_normalized_name_idx").on(t.normalizedName)],
);

export const storyPeople = pgTable(
  "story_people",
  {
    storyId: uuid("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    role: personRoleEnum("role").notNull().default("MENTIONED"),
    sourceSubmissionId: uuid("source_submission_id").references(() => submissions.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.personId, t.role] })],
);

export const storyOrganisations = pgTable(
  "story_organisations",
  {
    storyId: uuid("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    role: organisationRoleEnum("role").notNull().default("MENTIONED"),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.organisationId, t.role] })],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    dateText: text("date_text"),
    location: text("location"),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    isUpcoming: boolean("is_upcoming").notNull().default(false),
    signupUrl: text("signup_url"),
    organiser: text("organiser"),
    sourceSubmissionId: uuid("source_submission_id").references(() => submissions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_edition_idx").on(t.editionId)],
);

export type TeamMember = { name: string; program?: string; campus?: string };
export type JuryMember = { name: string; role?: string; organisation?: string };

export const businessDeepDives = pgTable(
  "business_deep_dives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    programCode: text("program_code"),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    cohortLabel: text("cohort_label"), // e.g. "B2 Paris"
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    dateText: text("date_text"),
    theCase: text("the_case"),
    theData: text("the_data"),
    theChallenge: text("the_challenge"),
    theApproach: text("the_approach"),
    theMethods: text("the_methods"),
    theSolution: text("the_solution"),
    theResults: text("the_results"),
    keyTakeaways: jsonb("key_takeaways").$type<string[]>().notNull().default([]),
    winningTeam: jsonb("winning_team").$type<TeamMember[]>().notNull().default([]),
    finalists: jsonb("finalists").$type<TeamMember[][]>().notNull().default([]),
    jury: jsonb("jury").$type<JuryMember[]>().notNull().default([]),
    technologies: text("technologies").array().notNull().default([]),
    metrics: jsonb("metrics").$type<{ label: string; value: string }[]>().notNull().default([]),
    logoAssetId: uuid("logo_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    teamPhotoAssetId: uuid("team_photo_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    dashboardAssetId: uuid("dashboard_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    diagramAssetId: uuid("diagram_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("business_deep_dives_story_idx").on(t.storyId), index("business_deep_dives_edition_idx").on(t.editionId)],
);

export const editorialDecisions = pgTable(
  "editorial_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason"),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("editorial_decisions_entity_idx").on(t.entityType, t.entityId), index("editorial_decisions_edition_idx").on(t.editionId)],
);

export const editorialComments = pgTable(
  "editorial_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    mentions: uuid("mentions").array().notNull().default([]),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("editorial_comments_entity_idx").on(t.entityType, t.entityId)],
);

export type InfoRequestItem = { key: string; label: string; answer?: string; answered?: boolean };

export const informationRequests = pgTable(
  "information_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "set null" }),
    contributorId: uuid("contributor_id").references(() => contributors.id, { onDelete: "set null" }),
    requestedById: uuid("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    items: jsonb("items").$type<InfoRequestItem[]>().notNull().default([]),
    tokenHash: text("token_hash").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
    status: infoRequestStatusEnum("status").notNull().default("PENDING"),
    answerText: text("answer_text"),
    answerSubmissionId: uuid("answer_submission_id").references(() => submissions.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("information_requests_token_idx").on(t.tokenHash), index("information_requests_story_idx").on(t.storyId)],
);
