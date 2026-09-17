import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "SUPER_ADMIN",
  "EDITOR_IN_CHIEF",
  "EDITOR",
  "CAMPUS_EDITOR",
  "CONTRIBUTOR",
  "VIEWER",
]);

/** What kind of organisation a workspace belongs to — steers tone, sections and templates. */
export const organizationTypeEnum = pgEnum("organization_type", [
  "COMPANY",
  "SCHOOL",
  "UNIVERSITY",
  "ASSOCIATION",
  "COMMUNITY",
  "INVESTOR",
  "MEDIA",
  "INSTITUTION",
  "OTHER",
]);

/** A member's role inside one workspace. Distinct from `userRoleEnum`, which is platform-level. */
export const organizationRoleEnum = pgEnum("organization_role", ["OWNER", "ADMIN", "EDITOR", "CONTRIBUTOR", "VIEWER"]);

export const organizationStatusEnum = pgEnum("organization_status", ["ACTIVE", "SUSPENDED", "ARCHIVED"]);

/** A publication is a recurring title; each of its editions chooses its own output formats. */
export const publicationStatusEnum = pgEnum("publication_status", ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);

/** Where one edition is published. An edition may carry several at once. */
export const outputFormatEnum = pgEnum("output_format", ["EMAIL", "WEB", "MAGAZINE", "PRINT"]);

export const outputStatusEnum = pgEnum("output_status", ["NOT_CONFIGURED", "PENDING", "GENERATING", "READY", "PUBLISHED", "FAILED"]);

export const contributorTypeEnum = pgEnum("contributor_type", [
  "STUDENT",
  "CAMPUS_AMBASSADOR",
  "ASSOCIATION",
  "CLASS_REPRESENTATIVE",
  "ADMINISTRATION",
  "FACULTY",
  "CORPORATE_RELATIONS",
  "BDD_REPRESENTATIVE",
  "ALUMNI",
  "STUDENT_ENTREPRENEUR",
  "STAFF",
  "OTHER",
]);

export const audienceSegmentEnum = pgEnum("audience_segment", [
  "STUDENT",
  "PARENT",
  "PARTNER",
  "ADMINISTRATION",
  "ALUMNI",
  "STAFF",
  "OTHER",
]);

export const editionStatusEnum = pgEnum("edition_status", [
  "UPCOMING",
  "OPEN",
  "REMINDER_1",
  "REMINDER_2",
  "GRACE_PERIOD",
  "CLOSED",
  "PROCESSING",
  "EDITORIAL_REVIEW",
  "LAYOUT",
  "FINAL_REVIEW",
  "PUBLISHED",
  "ARCHIVED",
]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "REMINDER_1",
  "REMINDER_2",
  "GRACE_PERIOD",
  "CLOSED",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "PENDING",
  "SENT",
  "OPENED",
  "SUBMITTED",
  "DECLINED",
  "EXPIRED",
  "BOUNCED",
]);

export const submissionTypeEnum = pgEnum("submission_type", [
  "BUSINESS_DEEP_DIVE",
  "STUDENT_ACHIEVEMENT",
  "STUDENT_PROJECT",
  "INTERVIEW_PROFILE",
  "SCHOOL_NEWS",
  "ASSOCIATION",
  "CAMPUS_LIFE",
  "EVENT_RECAP",
  "UPCOMING_EVENT",
  "ALUMNI",
  "ACADEMIC_NEWS",
  "CAREER_INTERNSHIP",
  "DATA_AI_BUSINESS_INSIGHT",
  "PHOTO_STORY",
  "ANECDOTE",
  "OTHER",
]);

export const campusScopeEnum = pgEnum("campus_scope", ["SINGLE", "MULTI", "SCHOOL_WIDE"]);

export const submissionStatusEnum = pgEnum("submission_status", [
  "DRAFT",
  "NEW",
  "NEEDS_REVIEW",
  "MISSING_INFO",
  "DUPLICATE",
  "POTENTIAL_STORY",
  "ACCEPTED",
  "REJECTED",
  "ARCHIVED",
]);

export const attachmentKindEnum = pgEnum("attachment_kind", ["IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "OTHER"]);

export const rightsStatusEnum = pgEnum("rights_status", ["GREEN", "YELLOW", "RED"]);

export const mediaVariantKindEnum = pgEnum("media_variant_kind", ["THUMBNAIL", "WEB", "PRINT", "CROP"]);

export const consentTypeEnum = pgEnum("consent_type", ["PUBLICATION", "IMAGE_RIGHTS", "DATA_PROCESSING"]);

export const clusterStatusEnum = pgEnum("cluster_status", ["PROPOSED", "CONFIRMED", "MERGED", "DISMISSED"]);

export const storyStatusEnum = pgEnum("story_status", [
  "CANDIDATE",
  "SELECTED",
  "DRAFTING",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "PUBLISHED",
  "DROPPED",
]);

export const articleStatusEnum = pgEnum("article_status", [
  "EMPTY",
  "AI_DRAFT",
  "IN_EDITING",
  "READY_FOR_REVIEW",
  "APPROVED",
  "LOCKED",
]);

export const factConfidenceEnum = pgEnum("fact_confidence", [
  "VERIFIED_BY_SUBMISSION",
  "STATED_BY_CONTRIBUTOR",
  "INFERRED",
  "CONFLICTING",
  "EDITOR_VERIFIED",
]);

export const factStatusEnum = pgEnum("fact_status", ["ACTIVE", "DISPUTED", "RESOLVED", "REJECTED"]);

export const personRoleEnum = pgEnum("person_role", [
  "WINNER",
  "FINALIST",
  "JURY",
  "INTERVIEWEE",
  "AUTHOR",
  "ORGANISER",
  "FOUNDER",
  "MENTIONED",
]);

export const organisationTypeEnum = pgEnum("organisation_type", [
  "COMPANY",
  "ASSOCIATION",
  "SCHOOL",
  "INSTITUTION",
  "MEDIA",
  "STARTUP",
  "OTHER",
]);

export const organisationRoleEnum = pgEnum("organisation_role", ["PARTNER", "SPONSOR", "SUBJECT", "MENTIONED", "EMPLOYER"]);

export const entityTypeEnum = pgEnum("entity_type", [
  "EDITION",
  "CAMPAIGN",
  "SUBMISSION",
  "CLUSTER",
  "STORY",
  "ARTICLE",
  "MEDIA",
  "PAGE",
  "PAGE_PLAN",
  "PUBLICATION_VERSION",
  "CONTRIBUTOR",
  "USER",
  "CAMPUS",
  "SECTION",
  "PROMPT_TEMPLATE",
  "SETTING",
  "BDD",
  "FACT",
  "INFORMATION_REQUEST",
]);

export const infoRequestStatusEnum = pgEnum("info_request_status", ["PENDING", "SENT", "ANSWERED", "EXPIRED", "CANCELLED"]);

export const pagePlanStatusEnum = pgEnum("page_plan_status", ["DRAFT", "VALIDATED", "LOCKED"]);

export const publicationKindEnum = pgEnum("publication_kind", ["DRAFT", "EDITORIAL_REVIEW", "FINAL_REVIEW", "PUBLISHED"]);

export const renderStatusEnum = pgEnum("render_status", ["PENDING", "RENDERING", "READY", "FAILED"]);

export const publicationAssetKindEnum = pgEnum("publication_asset_kind", ["PDF", "DOCX", "PREVIEW", "HTML"]);

export const jobStatusEnum = pgEnum("job_status", ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"]);

export const automationStepEnum = pgEnum("automation_step", [
  "EDITION_CREATION",
  "CAMPAIGN_OPEN",
  "REMINDER_1",
  "REMINDER_2",
  "GRACE_PERIOD",
  "CAMPAIGN_CLOSE",
  "AI_PROCESSING",
  "EDITORIAL_ALERT",
  "COVERAGE_CHECK",
  "DEADLINE_ALERT",
]);

export const aiJobStatusEnum = pgEnum("ai_job_status", ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"]);

export const modelTierEnum = pgEnum("model_tier", ["FAST", "STRONG"]);

export const emailStatusEnum = pgEnum("email_status", ["QUEUED", "SENT", "FAILED", "LOGGED"]);

export const actorTypeEnum = pgEnum("actor_type", ["USER", "SYSTEM", "AI", "CONTRIBUTOR"]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "CONTRIBUTION_REQUEST",
  "REMINDER",
  "MISSING_INFORMATION",
  "MENTION",
  "ARTICLE_READY",
  "FACTUAL_CONFLICT",
  "LOW_CAMPUS_COVERAGE",
  "DEADLINE_APPROACHING",
  "EDITION_READY_FOR_APPROVAL",
  "EXPORT_COMPLETED",
  "EXPORT_FAILED",
  "PROCESSING_COMPLETED",
  "SYSTEM",
]);
