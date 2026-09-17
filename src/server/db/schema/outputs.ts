import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { outputFormatEnum, outputStatusEnum, subscriberStatusEnum } from "./enums";
import { organizations, publications } from "./identity";
import { editions } from "./editions";
import { publicationVersions } from "./publication";

/**
 * Outputs and audience.
 *
 * The hierarchy is Organisation → Publication → Edition → Output. A publication is a recurring
 * title and deliberately has no format of its own; each edition decides where it goes. The same
 * edition may go out as an email on Tuesday, sit on the web from Tuesday, and be printed a fortnight
 * later — so "format" is a row here, not a column on the edition.
 *
 * Each output owns only what is specific to its channel. The editorial content stays on the edition
 * and is never copied per format, because then correcting a fact would mean correcting it four
 * times.
 */

export type OutputConfig = {
  /** EMAIL: subject line and preheader; falls back to the edition title. */
  subject?: string;
  preheader?: string;
  fromName?: string;
  replyTo?: string;
  /** WEB: whether the page is listed in the public archive. */
  listed?: boolean;
  /** PRINT: what to send to the printer. */
  copies?: number;
  paperStock?: string;
  binding?: string;
  deliverTo?: string;
  [key: string]: unknown;
};

export const editionOutputs = pgTable(
  "edition_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
    format: outputFormatEnum("format").notNull(),
    status: outputStatusEnum("status").notNull().default("NOT_CONFIGURED"),
    config: jsonb("config").$type<OutputConfig>().notNull().default({}),
    /** The rendered artefact this output publishes, for the formats that have one. */
    versionId: uuid("version_id").references(() => publicationVersions.id, { onDelete: "set null" }),
    /** WEB: the path the edition is readable at, unique per workspace. */
    publicSlug: text("public_slug"),
    /** EMAIL: what the provider called the send, so a bounce can be traced back here. */
    providerCampaignId: text("provider_campaign_id"),
    recipientCount: integer("recipient_count").notNull().default(0),
    deliveredCount: integer("delivered_count").notNull().default(0),
    openedCount: integer("opened_count").notNull().default(0),
    clickedCount: integer("clicked_count").notNull().default(0),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("edition_outputs_edition_format_idx").on(t.editionId, t.format),
    uniqueIndex("edition_outputs_public_slug_idx").on(t.organizationId, t.publicSlug),
    index("edition_outputs_edition_idx").on(t.editionId),
    index("edition_outputs_status_idx").on(t.status),
  ],
);

/**
 * A reader.
 *
 * Distinct from a contributor, who writes, and from an audience recipient, who is on an internal
 * distribution list. A subscriber asked for this, and can always leave: `status` is the record of
 * that consent and every send checks it.
 */
export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    locale: text("locale").notNull().default("en"),
    status: subscriberStatusEnum("status").notNull().default("PENDING"),
    source: text("source").notNull().default("form"),
    /** Double opt-in: the raw token only ever exists in the confirmation link. */
    confirmTokenHash: text("confirm_token_hash"),
    confirmTokenExpiresAt: timestamp("confirm_token_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    /** Stable, unguessable id used in the one-click unsubscribe link of every email. */
    unsubscribeToken: text("unsubscribe_token").notNull(),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    tags: text("tags").array().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("subscribers_org_email_idx").on(t.organizationId, t.email),
    uniqueIndex("subscribers_unsubscribe_token_idx").on(t.unsubscribeToken),
    index("subscribers_status_idx").on(t.organizationId, t.status),
  ],
);

/** Which titles a reader takes. A workspace may run several, and people pick. */
export const publicationSubscriptions = pgTable(
  "publication_subscriptions",
  {
    publicationId: uuid("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
    subscriberId: uuid("subscriber_id").notNull().references(() => subscribers.id, { onDelete: "cascade" }),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.publicationId, t.subscriberId] }), index("publication_subscriptions_subscriber_idx").on(t.subscriberId)],
);
