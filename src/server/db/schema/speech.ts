import { index, integer, jsonb, numeric, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { narrationKindEnum, narrationQualityEnum, narrationStatusEnum, voiceCloneStatusEnum } from "./enums";
import { organizations, publications, users } from "./identity";
import { editions } from "./editions";
import { articles } from "./newsroom";
import { creativePacks } from "./creative";
import type { NarrationOptions, SpeechScript, VoiceDirection } from "@/lib/speech/types";

/**
 * Spoken Briefly.
 *
 * A narration is one piece of audio somebody can press play on: an edition read aloud, one article,
 * a digest, an executive briefing, the voice-over of a launch film. It is made in stages that fail
 * and cost differently — the words are adapted for the ear by a model, the voice is directed, each
 * passage is performed by a speech provider, the passages are mastered into one file — and the row
 * records every stage's output, so a passage that came out wrong is regenerated on its own rather
 * than by paying for the whole edition again.
 *
 * Nothing here names a provider's vocabulary to the customer. They chose "Female · French · Warm";
 * which voice id that resolved to, and on which model, is written down for the audit and the bill.
 */

export type NarrationChapter = { title: string; startSeconds: number; endSeconds: number; articleId?: string | null; passageIndex: number };

export type NarrationFinding = { code: string; severity: "defect" | "note"; message: string; passage: number | null };
export type NarrationQa = { ok: boolean; summary: string; findings: NarrationFinding[]; checkedAt: string };

export type NarrationTake = { take: number; storageKey: string; durationSeconds: number; sizeBytes: number; sha256: string };

export const narrations = pgTable(
  "narrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicationId: uuid("publication_id").references(() => publications.id, { onDelete: "set null" }),
    /** What it was made from. An edition, one of its articles, a Studio pack, or text somebody pasted. */
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    packId: uuid("pack_id").references(() => creativePacks.id, { onDelete: "cascade" }),

    kind: narrationKindEnum("kind").notNull(),
    quality: narrationQualityEnum("quality").notNull().default("PREVIEW"),
    status: narrationStatusEnum("status").notNull().default("QUEUED"),
    title: text("title").notNull(),

    /** The language it is spoken in (ISO 639-1) and how that was decided — never assumed. */
    language: text("language").notNull(),
    languageSource: text("language_source").notNull().default("publication"),
    accent: text("accent"),
    /** What the person chose, in the interface's own words: voice, style, pace, takes. */
    options: jsonb("options").$type<NarrationOptions>().notNull(),

    /** The curated slot ("fr-warm-female") or clone ("clone:<id>") this resolved to, and the provider's id behind it. */
    voiceKey: text("voice_key"),
    voiceName: text("voice_name"),
    providerVoiceId: text("provider_voice_id"),
    provider: text("provider"),
    model: text("model"),

    /** The performance notes handed to the voice: written once, kept so a re-take sounds like the rest. */
    direction: jsonb("direction").$type<VoiceDirection | null>(),
    /** The words as spoken: adapted for the ear, cut into passages, each with its speaker and its source. */
    script: jsonb("script").$type<SpeechScript | null>(),
    qa: jsonb("qa").$type<NarrationQa | null>(),
    chapters: jsonb("chapters").$type<NarrationChapter[]>().notNull().default([]),

    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    durationSeconds: real("duration_seconds"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    /** Alternative full performances, when the plan allows more than one take. */
    takes: jsonb("takes").$type<NarrationTake[]>().notNull().default([]),

    /** What the provider was asked to speak, summed, and what it cost — in cents, ours. */
    characters: integer("characters").notNull().default(0),
    costCents: numeric("cost_cents", { precision: 12, scale: 4 }).notNull().default("0"),
    /** Of the script, direction and voice, so an unchanged narration is never performed twice. */
    fingerprint: text("fingerprint"),
    error: text("error"),
    /** Set when readers may hear it: the web edition and the email carry a player from then on. */
    publishedAt: timestamp("published_at", { withTimezone: true }),

    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("narrations_org_idx").on(t.organizationId, t.createdAt),
    index("narrations_edition_idx").on(t.editionId),
    index("narrations_pack_idx").on(t.packId),
    index("narrations_status_idx").on(t.status),
  ],
);

/**
 * One passage, performed.
 *
 * Kept per passage so the file can be rebuilt from parts: Voice QA points at a passage, the person
 * presses "Regenerate this passage", one provider call replaces one row, and the master is stitched
 * again from the rows. A second take of a passage is a new row with a higher `take`, never an
 * overwrite — the previous performance stays until somebody prefers the new one.
 */
export const narrationSegments = pgTable(
  "narration_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    narrationId: uuid("narration_id")
      .notNull()
      .references(() => narrations.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    take: integer("take").notNull().default(1),
    speaker: text("speaker").notNull().default("narrator"),
    /** Exactly what was sent to the provider, tags included. */
    text: text("text").notNull(),
    characters: integer("characters").notNull().default(0),
    status: text("status").notNull().default("PENDING"),
    provider: text("provider"),
    model: text("model"),
    providerVoiceId: text("provider_voice_id"),
    providerRequestId: text("provider_request_id"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    durationSeconds: real("duration_seconds"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    /** Measured after synthesis: a silent or clipped passage is caught here, not by a listener. */
    meanVolumeDb: real("mean_volume_db"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("narration_segments_slot_idx").on(t.narrationId, t.index, t.take), index("narration_segments_org_idx").on(t.organizationId)],
);

/**
 * What speech cost, line by line.
 *
 * Every provider call, in the provider's unit (characters) and in ours (cents), with the seconds of
 * audio it produced — which is what a plan's allowance is measured in, because "minutes of
 * narration a month" is a number a customer understands and "characters" is not. The allowance is
 * arithmetic over these rows rather than a counter somebody has to remember to increment.
 */
export const speechUsage = pgTable(
  "speech_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    narrationId: uuid("narration_id").references(() => narrations.id, { onDelete: "set null" }),
    segmentId: uuid("segment_id").references(() => narrationSegments.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model"),
    /** "tts", "dialogue", "clone", "master" — the last is our own work and costs nothing. */
    operation: text("operation").notNull(),
    quality: text("quality"),
    characters: integer("characters").notNull().default(0),
    seconds: real("seconds").notNull().default(0),
    costCents: numeric("cost_cents", { precision: 12, scale: 4 }).notNull().default("0"),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("speech_usage_org_idx").on(t.organizationId, t.createdAt), index("speech_usage_narration_idx").on(t.narrationId)],
);

/** A word and how to say it: "BDD" → "B, D, D"; "Albert" → "Albert" the French way. */
export type Pronunciation = { term: string; say: string; language?: string | null };

/**
 * How a workspace sounds by default.
 *
 * One row per organisation: the voice, style and pace every narration starts from, the words the
 * newsroom wants said a particular way, and — only with consent on record — the cloned voice of
 * somebody who agreed to lend theirs. A narration may override any of it; this is the house voice.
 */
export const brandVoices = pgTable(
  "brand_voices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** A curated slot key, or null for "let Briefly pick for the language". */
    voiceKey: text("voice_key"),
    gender: text("gender").notNull().default("auto"),
    accent: text("accent").notNull().default("auto"),
    style: text("style").notNull().default("editorial"),
    pace: text("pace").notNull().default("natural"),
    /** Null follows each publication's language, which is the rule; set only to force one. */
    language: text("language"),
    pronunciations: jsonb("pronunciations").$type<Pronunciation[]>().notNull().default([]),
    /** The consented clone used as the brand voice, when there is one and the plan allows it. */
    cloneId: uuid("clone_id").references((): AnyPgColumn => voiceClones.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("brand_voices_org_idx").on(t.organizationId)],
);

/**
 * A real person's voice, borrowed with their permission.
 *
 * Never made on Briefly's initiative: a clone exists only because somebody in the workspace recorded
 * that the person consented, in words, on a date, and uploaded the samples themselves. The consent
 * stays with the row, the making and the revoking are audited, and revoking deletes the voice at the
 * provider as well as here.
 */
export const voiceClones = pgTable(
  "voice_clones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** What the workspace calls it: "Marie Dupont — CEO". */
    name: text("name").notNull(),
    personName: text("person_name").notNull(),
    /** founder, executive, employee, contributor, other — the people the rules say may never be cloned by default. */
    relation: text("relation").notNull().default("other"),
    language: text("language"),
    consentText: text("consent_text").notNull(),
    consentGrantedById: uuid("consent_granted_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    consentGrantedAt: timestamp("consent_granted_at", { withTimezone: true }).notNull(),
    consentDocumentKey: text("consent_document_key"),
    sampleKeys: jsonb("sample_keys").$type<string[]>().notNull().default([]),
    provider: text("provider"),
    providerVoiceId: text("provider_voice_id"),
    status: voiceCloneStatusEnum("status").notNull().default("PENDING"),
    error: text("error"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedById: uuid("revoked_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("voice_clones_org_idx").on(t.organizationId, t.createdAt)],
);
