CREATE TYPE "public"."actor_type" AS ENUM('USER', 'SYSTEM', 'AI', 'CONTRIBUTOR');--> statement-breakpoint
CREATE TYPE "public"."ai_job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM('EMPTY', 'AI_DRAFT', 'IN_EDITING', 'READY_FOR_REVIEW', 'APPROVED', 'LOCKED');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."automation_step" AS ENUM('EDITION_CREATION', 'CAMPAIGN_OPEN', 'REMINDER_1', 'REMINDER_2', 'GRACE_PERIOD', 'CAMPAIGN_CLOSE', 'AI_PROCESSING', 'EDITORIAL_ALERT', 'COVERAGE_CHECK', 'DEADLINE_ALERT');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'SCHEDULED', 'OPEN', 'REMINDER_1', 'REMINDER_2', 'GRACE_PERIOD', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."campus_scope" AS ENUM('SINGLE', 'MULTI', 'SCHOOL_WIDE');--> statement-breakpoint
CREATE TYPE "public"."cluster_status" AS ENUM('PROPOSED', 'CONFIRMED', 'MERGED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('PUBLICATION', 'IMAGE_RIGHTS', 'DATA_PROCESSING');--> statement-breakpoint
CREATE TYPE "public"."contributor_type" AS ENUM('STUDENT', 'CAMPUS_AMBASSADOR', 'ASSOCIATION', 'CLASS_REPRESENTATIVE', 'ADMINISTRATION', 'FACULTY', 'CORPORATE_RELATIONS', 'BDD_REPRESENTATIVE', 'ALUMNI', 'STUDENT_ENTREPRENEUR', 'STAFF', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."edition_status" AS ENUM('UPCOMING', 'OPEN', 'REMINDER_1', 'REMINDER_2', 'GRACE_PERIOD', 'CLOSED', 'PROCESSING', 'EDITORIAL_REVIEW', 'LAYOUT', 'FINAL_REVIEW', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('QUEUED', 'SENT', 'FAILED', 'LOGGED');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('EDITION', 'CAMPAIGN', 'SUBMISSION', 'CLUSTER', 'STORY', 'ARTICLE', 'MEDIA', 'PAGE', 'PAGE_PLAN', 'PUBLICATION_VERSION', 'CONTRIBUTOR', 'USER', 'CAMPUS', 'SECTION', 'PROMPT_TEMPLATE', 'SETTING', 'BDD', 'FACT', 'INFORMATION_REQUEST');--> statement-breakpoint
CREATE TYPE "public"."fact_confidence" AS ENUM('VERIFIED_BY_SUBMISSION', 'STATED_BY_CONTRIBUTOR', 'INFERRED', 'CONFLICTING', 'EDITOR_VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('ACTIVE', 'DISPUTED', 'RESOLVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."info_request_status" AS ENUM('PENDING', 'SENT', 'ANSWERED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."media_variant_kind" AS ENUM('THUMBNAIL', 'WEB', 'PRINT', 'CROP');--> statement-breakpoint
CREATE TYPE "public"."model_tier" AS ENUM('FAST', 'STRONG');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('CONTRIBUTION_REQUEST', 'REMINDER', 'MISSING_INFORMATION', 'MENTION', 'ARTICLE_READY', 'FACTUAL_CONFLICT', 'LOW_CAMPUS_COVERAGE', 'DEADLINE_APPROACHING', 'EDITION_READY_FOR_APPROVAL', 'EXPORT_COMPLETED', 'EXPORT_FAILED', 'PROCESSING_COMPLETED', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."organisation_role" AS ENUM('PARTNER', 'SPONSOR', 'SUBJECT', 'MENTIONED', 'EMPLOYER');--> statement-breakpoint
CREATE TYPE "public"."organisation_type" AS ENUM('COMPANY', 'ASSOCIATION', 'SCHOOL', 'INSTITUTION', 'MEDIA', 'STARTUP', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."page_plan_status" AS ENUM('DRAFT', 'VALIDATED', 'LOCKED');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('WINNER', 'FINALIST', 'JURY', 'INTERVIEWEE', 'AUTHOR', 'ORGANISER', 'FOUNDER', 'MENTIONED');--> statement-breakpoint
CREATE TYPE "public"."publication_asset_kind" AS ENUM('PDF', 'DOCX', 'PREVIEW', 'HTML');--> statement-breakpoint
CREATE TYPE "public"."publication_kind" AS ENUM('DRAFT', 'EDITORIAL_REVIEW', 'FINAL_REVIEW', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."render_status" AS ENUM('PENDING', 'RENDERING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('PENDING', 'SENT', 'OPENED', 'SUBMITTED', 'DECLINED', 'EXPIRED', 'BOUNCED');--> statement-breakpoint
CREATE TYPE "public"."rights_status" AS ENUM('GREEN', 'YELLOW', 'RED');--> statement-breakpoint
CREATE TYPE "public"."story_status" AS ENUM('CANDIDATE', 'SELECTED', 'DRAFTING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'DROPPED');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('DRAFT', 'NEW', 'NEEDS_REVIEW', 'MISSING_INFO', 'DUPLICATE', 'POTENTIAL_STORY', 'ACCEPTED', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."submission_type" AS ENUM('BUSINESS_DEEP_DIVE', 'STUDENT_ACHIEVEMENT', 'STUDENT_PROJECT', 'INTERVIEW_PROFILE', 'SCHOOL_NEWS', 'ASSOCIATION', 'CAMPUS_LIFE', 'EVENT_RECAP', 'UPCOMING_EVENT', 'ALUMNI', 'ACADEMIC_NEWS', 'CAREER_INTERNSHIP', 'DATA_AI_BUSINESS_INSIGHT', 'PHOTO_STORY', 'ANECDOTE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SUPER_ADMIN', 'EDITOR_IN_CHIEF', 'EDITOR', 'CAMPUS_EDITOR', 'CONTRIBUTOR', 'VIEWER');--> statement-breakpoint
CREATE TABLE "academic_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"city" text,
	"country" text DEFAULT 'France',
	"colour" text DEFAULT '#2BAFE0',
	"timezone" text DEFAULT 'Europe/Paris',
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributor_group_members" (
	"group_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributor_group_members_group_id_contributor_id_pk" PRIMARY KEY("group_id","contributor_id")
);
--> statement-breakpoint
CREATE TABLE "contributor_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"campus_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"campus_id" uuid,
	"program_id" uuid,
	"type" "contributor_type" DEFAULT 'STUDENT' NOT NULL,
	"organisation_name" text,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"invitations_count" integer DEFAULT 0 NOT NULL,
	"submissions_count" integer DEFAULT 0 NOT NULL,
	"response_rate" real,
	"last_invited_at" timestamp with time zone,
	"last_contribution_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'VIEWER' NOT NULL,
	"campus_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"avatar_url" text,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kicker" text,
	"description" text,
	"colour" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"target_pages" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"status" "edition_status" DEFAULT 'UPCOMING' NOT NULL,
	"is_special_issue" boolean DEFAULT false NOT NULL,
	"publication_target_at" timestamp with time zone,
	"final_review_at" timestamp with time zone,
	"page_size" text DEFAULT 'A4' NOT NULL,
	"target_page_count" integer DEFAULT 24 NOT NULL,
	"cover_story_id" uuid,
	"cover_headline" text,
	"cover_standfirst" text,
	"cover_media_asset_id" uuid,
	"editorial" text,
	"theme" jsonb DEFAULT '{}'::jsonb,
	"editor_in_chief_id" uuid,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"published_version_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"reminder_1_at" timestamp with time zone NOT NULL,
	"reminder_2_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"grace_ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"targets" jsonb DEFAULT '{}'::jsonb,
	"contributor_group_ids" uuid[] DEFAULT '{}' NOT NULL,
	"intro_message" text,
	"auto_process" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"campus_id" uuid,
	"token_hash" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reminded_count" integer DEFAULT 0 NOT NULL,
	"last_reminded_at" timestamp with time zone,
	"submissions_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid,
	"contributor_id" uuid,
	"media_asset_id" uuid,
	"type" "consent_type" NOT NULL,
	"text_version" text NOT NULL,
	"accepted" boolean DEFAULT true NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid,
	"submission_id" uuid,
	"uploaded_by_contributor_id" uuid,
	"uploaded_by_user_id" uuid,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"format" text,
	"aspect_ratio" real,
	"orientation" text,
	"dominant_colour" text,
	"sha256" text,
	"phash" text,
	"quality_score" integer,
	"quality_flags" text[] DEFAULT '{}' NOT NULL,
	"caption" text,
	"alt_text" text,
	"photographer" text,
	"credit" text,
	"rights_status" "rights_status" DEFAULT 'YELLOW' NOT NULL,
	"rights_note" text,
	"ai_description" text,
	"ai_tags" text[] DEFAULT '{}' NOT NULL,
	"kind" text DEFAULT 'photo' NOT NULL,
	"suggested_crops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duplicate_of_id" uuid,
	"similarity_group" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" "media_variant_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"format" text NOT NULL,
	"crop_spec" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"kind" "attachment_kind" DEFAULT 'OTHER' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"caption" text,
	"photographer" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_campuses" (
	"submission_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	CONSTRAINT "submission_campuses_submission_id_campus_id_pk" PRIMARY KEY("submission_id","campus_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"campaign_id" uuid,
	"request_id" uuid,
	"contributor_id" uuid,
	"submitted_by_user_id" uuid,
	"story_type" "submission_type" DEFAULT 'OTHER' NOT NULL,
	"title" text NOT NULL,
	"campus_scope" "campus_scope" DEFAULT 'SINGLE' NOT NULL,
	"event_date" timestamp with time zone,
	"event_date_text" text,
	"description" text NOT NULL,
	"people_involved" text,
	"organisations_involved" text,
	"why_it_matters" text,
	"quotes" text,
	"urls" text[] DEFAULT '{}' NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"status" "submission_status" DEFAULT 'NEW' NOT NULL,
	"source" text DEFAULT 'form' NOT NULL,
	"publication_consent" boolean DEFAULT false NOT NULL,
	"image_rights_confirmed" boolean DEFAULT false NOT NULL,
	"consent_text_version" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"normalized_text" text,
	"ai_summary" text,
	"ai_classification" jsonb,
	"ai_entities" jsonb,
	"ai_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_importance" real,
	"suggested_cluster_id" uuid,
	"suggested_section_slug" text,
	"duplicate_of_id" uuid,
	"processed_at" timestamp with time zone,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kicker" text,
	"headline" text DEFAULT '' NOT NULL,
	"standfirst" text,
	"byline" text,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_by_ai" boolean DEFAULT false NOT NULL,
	"ai_job_id" uuid,
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_sources" (
	"article_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"role" text DEFAULT 'PRIMARY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_sources_article_id_submission_id_pk" PRIMARY KEY("article_id","submission_id")
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"kicker" text,
	"headline" text DEFAULT '' NOT NULL,
	"standfirst" text,
	"byline" text,
	"author_user_id" uuid,
	"author_contributor_id" uuid,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"status" "article_status" DEFAULT 'EMPTY' NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headline_alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_drafted_at" timestamp with time zone,
	"last_edited_by_id" uuid,
	"last_edited_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"manual_edit_ratio" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_deep_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"organisation_id" uuid,
	"company_name" text NOT NULL,
	"program_code" text,
	"campus_id" uuid,
	"cohort_label" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"date_text" text,
	"the_case" text,
	"the_data" text,
	"the_challenge" text,
	"the_approach" text,
	"the_methods" text,
	"the_solution" text,
	"the_results" text,
	"key_takeaways" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"winning_team" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finalists" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"jury" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technologies" text[] DEFAULT '{}' NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo_asset_id" uuid,
	"team_photo_asset_id" uuid,
	"dashboard_asset_id" uuid,
	"diagram_asset_id" uuid,
	"quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"previous_value" jsonb,
	"new_value" jsonb,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid,
	"story_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"date_text" text,
	"location" text,
	"campus_id" uuid,
	"is_upcoming" boolean DEFAULT false NOT NULL,
	"signup_url" text,
	"organiser" text,
	"source_submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"story_id" uuid,
	"cluster_id" uuid,
	"statement" text NOT NULL,
	"category" text,
	"source_submission_id" uuid,
	"source_excerpt" text,
	"confidence" "fact_confidence" DEFAULT 'STATED_BY_CONTRIBUTOR' NOT NULL,
	"status" "fact_status" DEFAULT 'ACTIVE' NOT NULL,
	"conflict_group" text,
	"conflicts_with_fact_id" uuid,
	"verified_by_id" uuid,
	"verified_at" timestamp with time zone,
	"notes" text,
	"created_by_ai" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "information_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"story_id" uuid,
	"submission_id" uuid,
	"contributor_id" uuid,
	"requested_by_id" uuid,
	"message" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"status" "info_request_status" DEFAULT 'PENDING' NOT NULL,
	"answer_text" text,
	"answer_submission_id" uuid,
	"sent_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"type" "organisation_type" DEFAULT 'COMPANY' NOT NULL,
	"website" text,
	"logo_asset_id" uuid,
	"notes" text,
	"mentions_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"role" text,
	"campus_id" uuid,
	"program_id" uuid,
	"contributor_id" uuid,
	"notes" text,
	"mentions_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"story_id" uuid,
	"cluster_id" uuid,
	"text" text NOT NULL,
	"speaker_name" text,
	"speaker_role" text,
	"source_submission_id" uuid,
	"is_pull_quote_candidate" boolean DEFAULT false NOT NULL,
	"ai_score" real,
	"is_approved" boolean DEFAULT false NOT NULL,
	"created_by_ai" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"cluster_id" uuid,
	"section_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" "story_status" DEFAULT 'CANDIDATE' NOT NULL,
	"story_type" "submission_type" DEFAULT 'OTHER' NOT NULL,
	"summary" text,
	"event_date" timestamp with time zone,
	"priority" integer DEFAULT 50 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"is_spotlight" boolean DEFAULT false NOT NULL,
	"ai_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"editorial_score" integer,
	"ai_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editorial_notes" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_to_user_id" uuid,
	"suggested_template" text,
	"target_length" text DEFAULT 'MEDIUM' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_campuses" (
	"story_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	CONSTRAINT "story_campuses_story_id_campus_id_pk" PRIMARY KEY("story_id","campus_id")
);
--> statement-breakpoint
CREATE TABLE "story_cluster_members" (
	"cluster_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"similarity" real,
	"is_primary" boolean DEFAULT false NOT NULL,
	"added_by_ai" boolean DEFAULT true NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_cluster_members_cluster_id_submission_id_pk" PRIMARY KEY("cluster_id","submission_id")
);
--> statement-breakpoint
CREATE TABLE "story_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" "cluster_status" DEFAULT 'PROPOSED' NOT NULL,
	"primary_story_type" "submission_type" DEFAULT 'OTHER' NOT NULL,
	"suggested_section_slug" text,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"media_count" integer DEFAULT 0 NOT NULL,
	"quote_count" integer DEFAULT 0 NOT NULL,
	"fact_sheet" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_score_total" real,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"merged_into_id" uuid,
	"created_by_ai" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_media" (
	"story_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"role" text DEFAULT 'gallery' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"added_by_ai" boolean DEFAULT false NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_media_story_id_media_asset_id_pk" PRIMARY KEY("story_id","media_asset_id")
);
--> statement-breakpoint
CREATE TABLE "story_organisations" (
	"story_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"role" "organisation_role" DEFAULT 'MENTIONED' NOT NULL,
	CONSTRAINT "story_organisations_story_id_organisation_id_role_pk" PRIMARY KEY("story_id","organisation_id","role")
);
--> statement-breakpoint
CREATE TABLE "story_people" (
	"story_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "person_role" DEFAULT 'MENTIONED' NOT NULL,
	"source_submission_id" uuid,
	CONSTRAINT "story_people_story_id_person_id_role_pk" PRIMARY KEY("story_id","person_id","role")
);
--> statement-breakpoint
CREATE TABLE "page_plan_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"section_id" uuid,
	"template" text DEFAULT 'ARTICLE_TWO_COLUMN' NOT NULL,
	"story_id" uuid,
	"article_id" uuid,
	"media_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"continuation_of_page_id" uuid,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_article_locked" boolean DEFAULT false NOT NULL,
	"is_image_locked" boolean DEFAULT false NOT NULL,
	"fit_estimate" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"name" text DEFAULT 'Flatplan' NOT NULL,
	"status" "page_plan_status" DEFAULT 'DRAFT' NOT NULL,
	"page_size" text DEFAULT 'A4' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"generated_by_ai" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"validation_report" jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"kind" "publication_asset_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sequence" integer NOT NULL,
	"kind" "publication_kind" DEFAULT 'DRAFT' NOT NULL,
	"status" "render_status" DEFAULT 'PENDING' NOT NULL,
	"document" jsonb,
	"document_hash" text,
	"validation_report" jsonb,
	"layout_report" jsonb,
	"pdf_asset_id" uuid,
	"docx_asset_id" uuid,
	"is_immutable" boolean DEFAULT false NOT NULL,
	"notes" text,
	"render_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quality_gate_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"gate_key" text NOT NULL,
	"reason" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_template_id" uuid,
	"prompt_key" text,
	"prompt_version" integer,
	"edition_id" uuid,
	"entity_type" "entity_type",
	"entity_id" uuid,
	"status" "ai_job_status" DEFAULT 'QUEUED' NOT NULL,
	"input_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_hash" text,
	"output" jsonb,
	"confidence" real,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_cents" numeric(12, 4),
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"cached" boolean DEFAULT false NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" DEFAULT 'USER' NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" "entity_type",
	"entity_id" uuid,
	"edition_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid,
	"step" "automation_step" NOT NULL,
	"run_key" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"triggered_by" text DEFAULT 'SCHEDULER' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" text NOT NULL,
	"cc" text,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text_body" text,
	"template" text,
	"status" "email_status" DEFAULT 'QUEUED' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"error" text,
	"entity_type" "entity_type",
	"entity_id" uuid,
	"edition_id" uuid,
	"contributor_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"progress" jsonb,
	"edition_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" "entity_type",
	"entity_id" uuid,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt" text NOT NULL,
	"output_schema_name" text,
	"model_tier" "model_tier" DEFAULT 'FAST' NOT NULL,
	"temperature" real DEFAULT 0.2 NOT NULL,
	"max_output_tokens" integer DEFAULT 2000 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contributor_group_members" ADD CONSTRAINT "contributor_group_members_group_id_contributor_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contributor_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_group_members" ADD CONSTRAINT "contributor_group_members_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_groups" ADD CONSTRAINT "contributor_groups_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_program_id_academic_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."academic_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_sections" ADD CONSTRAINT "edition_sections_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_editor_in_chief_id_users_id_fk" FOREIGN KEY ("editor_in_chief_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_campaigns" ADD CONSTRAINT "submission_campaigns_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_campaigns" ADD CONSTRAINT "submission_campaigns_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_requests" ADD CONSTRAINT "submission_requests_campaign_id_submission_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."submission_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_requests" ADD CONSTRAINT "submission_requests_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_requests" ADD CONSTRAINT "submission_requests_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_requests" ADD CONSTRAINT "submission_requests_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_contributor_id_contributors_id_fk" FOREIGN KEY ("uploaded_by_contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_duplicate_of_id_media_assets_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_attachments" ADD CONSTRAINT "submission_attachments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_attachments" ADD CONSTRAINT "submission_attachments_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_campuses" ADD CONSTRAINT "submission_campuses_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_campuses" ADD CONSTRAINT "submission_campuses_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_campaign_id_submission_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."submission_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_request_id_submission_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."submission_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_duplicate_of_id_submissions_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_contributor_id_contributors_id_fk" FOREIGN KEY ("author_contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_last_edited_by_id_users_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_logo_asset_id_media_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_team_photo_asset_id_media_assets_id_fk" FOREIGN KEY ("team_photo_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_dashboard_asset_id_media_assets_id_fk" FOREIGN KEY ("dashboard_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_diagram_asset_id_media_assets_id_fk" FOREIGN KEY ("diagram_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_deep_dives" ADD CONSTRAINT "business_deep_dives_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_comments" ADD CONSTRAINT "editorial_comments_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_comments" ADD CONSTRAINT "editorial_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_comments" ADD CONSTRAINT "editorial_comments_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_decisions" ADD CONSTRAINT "editorial_decisions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_decisions" ADD CONSTRAINT "editorial_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_source_submission_id_submissions_id_fk" FOREIGN KEY ("source_submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_cluster_id_story_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_submission_id_submissions_id_fk" FOREIGN KEY ("source_submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_conflicts_with_fact_id_facts_id_fk" FOREIGN KEY ("conflicts_with_fact_id") REFERENCES "public"."facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_answer_submission_id_submissions_id_fk" FOREIGN KEY ("answer_submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_logo_asset_id_media_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_program_id_academic_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."academic_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_cluster_id_story_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_source_submission_id_submissions_id_fk" FOREIGN KEY ("source_submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_cluster_id_story_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_section_id_edition_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."edition_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_campuses" ADD CONSTRAINT "story_campuses_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_campuses" ADD CONSTRAINT "story_campuses_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_cluster_members" ADD CONSTRAINT "story_cluster_members_cluster_id_story_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_cluster_members" ADD CONSTRAINT "story_cluster_members_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_clusters" ADD CONSTRAINT "story_clusters_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_clusters" ADD CONSTRAINT "story_clusters_merged_into_id_story_clusters_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."story_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_media" ADD CONSTRAINT "story_media_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_media" ADD CONSTRAINT "story_media_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_organisations" ADD CONSTRAINT "story_organisations_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_organisations" ADD CONSTRAINT "story_organisations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_people" ADD CONSTRAINT "story_people_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_people" ADD CONSTRAINT "story_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_people" ADD CONSTRAINT "story_people_source_submission_id_submissions_id_fk" FOREIGN KEY ("source_submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_pages" ADD CONSTRAINT "page_plan_pages_plan_id_page_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."page_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_pages" ADD CONSTRAINT "page_plan_pages_section_id_edition_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."edition_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_pages" ADD CONSTRAINT "page_plan_pages_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_pages" ADD CONSTRAINT "page_plan_pages_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plans" ADD CONSTRAINT "page_plans_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plans" ADD CONSTRAINT "page_plans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_assets" ADD CONSTRAINT "publication_assets_version_id_publication_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."publication_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_assets" ADD CONSTRAINT "publication_assets_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_versions" ADD CONSTRAINT "publication_versions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_versions" ADD CONSTRAINT "publication_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_overrides" ADD CONSTRAINT "quality_gate_overrides_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_overrides" ADD CONSTRAINT "quality_gate_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_prompt_template_id_prompt_templates_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_programs_code_idx" ON "academic_programs" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "campuses_slug_idx" ON "campuses" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "contributor_groups_slug_idx" ON "contributor_groups" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_email_idx" ON "contributors" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contributors_campus_idx" ON "contributors" USING btree ("campus_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "edition_sections_edition_slug_idx" ON "edition_sections" USING btree ("edition_id","slug");--> statement-breakpoint
CREATE INDEX "edition_sections_edition_idx" ON "edition_sections" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_slug_idx" ON "editions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_issue_number_idx" ON "editions" USING btree ("issue_number");--> statement-breakpoint
CREATE INDEX "submission_campaigns_edition_idx" ON "submission_campaigns" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_requests_token_hash_idx" ON "submission_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_requests_campaign_contributor_idx" ON "submission_requests" USING btree ("campaign_id","contributor_id");--> statement-breakpoint
CREATE INDEX "submission_requests_edition_idx" ON "submission_requests" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "consent_records_submission_idx" ON "consent_records" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "media_assets_edition_idx" ON "media_assets" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "media_assets_submission_idx" ON "media_assets" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "media_assets_sha_idx" ON "media_assets" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "media_assets_phash_idx" ON "media_assets" USING btree ("phash");--> statement-breakpoint
CREATE UNIQUE INDEX "media_variants_asset_kind_idx" ON "media_variants" USING btree ("asset_id","kind");--> statement-breakpoint
CREATE INDEX "submission_attachments_submission_idx" ON "submission_attachments" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submission_campuses_campus_idx" ON "submission_campuses" USING btree ("campus_id");--> statement-breakpoint
CREATE INDEX "submissions_edition_idx" ON "submissions" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("edition_id","status");--> statement-breakpoint
CREATE INDEX "submissions_contributor_idx" ON "submissions" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "submissions_type_idx" ON "submissions" USING btree ("story_type");--> statement-breakpoint
CREATE UNIQUE INDEX "article_revisions_article_version_idx" ON "article_revisions" USING btree ("article_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_story_idx" ON "articles" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "articles_edition_idx" ON "articles" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_deep_dives_story_idx" ON "business_deep_dives" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "business_deep_dives_edition_idx" ON "business_deep_dives" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "editorial_comments_entity_idx" ON "editorial_comments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "editorial_decisions_entity_idx" ON "editorial_decisions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "editorial_decisions_edition_idx" ON "editorial_decisions" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "events_edition_idx" ON "events" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "facts_story_idx" ON "facts" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "facts_edition_idx" ON "facts" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "information_requests_token_idx" ON "information_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "information_requests_story_idx" ON "information_requests" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_normalized_name_idx" ON "organisations" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "people_normalized_name_idx" ON "people" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "quotes_story_idx" ON "quotes" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "stories_edition_idx" ON "stories" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stories_edition_slug_idx" ON "stories" USING btree ("edition_id","slug");--> statement-breakpoint
CREATE INDEX "stories_section_idx" ON "stories" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "story_cluster_members_submission_idx" ON "story_cluster_members" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "story_clusters_edition_idx" ON "story_clusters" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_plan_pages_plan_number_idx" ON "page_plan_pages" USING btree ("plan_id","page_number");--> statement-breakpoint
CREATE INDEX "page_plan_pages_story_idx" ON "page_plan_pages" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "page_plans_edition_idx" ON "page_plans" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "publication_assets_version_idx" ON "publication_assets" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_versions_edition_sequence_idx" ON "publication_versions" USING btree ("edition_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_gate_overrides_edition_gate_idx" ON "quality_gate_overrides" USING btree ("edition_id","gate_key");--> statement-breakpoint
CREATE INDEX "ai_jobs_edition_idx" ON "ai_jobs" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_entity_idx" ON "ai_jobs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_input_hash_idx" ON "ai_jobs" USING btree ("service","input_hash");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_edition_idx" ON "audit_log" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_run_key_idx" ON "automation_runs" USING btree ("run_key");--> statement-breakpoint
CREATE INDEX "automation_runs_edition_idx" ON "automation_runs" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "email_log_edition_idx" ON "email_log" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "email_log_contributor_idx" ON "email_log" USING btree ("contributor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key_idx" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_edition_idx" ON "jobs" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_templates_key_version_idx" ON "prompt_templates" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "prompt_templates_key_idx" ON "prompt_templates" USING btree ("key");