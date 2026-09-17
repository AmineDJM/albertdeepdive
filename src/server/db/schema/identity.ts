import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contributorTypeEnum, organizationRoleEnum, organizationStatusEnum, organizationTypeEnum, publicationStatusEnum, userRoleEnum } from "./enums";

/**
 * Multi-tenancy.
 *
 * Every customer — a company, a school, a fund, an association — gets one isolated workspace. An
 * organisation owns everything: its people, its directories, its publications and their editions.
 * Nothing is ever read or written without an organisation in scope; the id is resolved on the
 * server from the session's membership and never taken from the client.
 *
 * Briefly's hierarchy is Organisation → Publication → Edition → Output. A publication is a recurring
 * title ("Acme Weekly"); it is deliberately *not* tied to a format, because each edition decides for
 * itself whether it goes out as an email, a web page, a magazine PDF, printed paper, or several.
 */

export type BrandColours = { primary?: string; accent?: string; ink?: string; paper?: string; palette?: string[] };
export type OrganizationLinks = { website?: string; linkedin?: string; instagram?: string; x?: string; youtube?: string; other?: string[] };

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: organizationTypeEnum("type").notNull().default("COMPANY"),
    status: organizationStatusEnum("status").notNull().default("ACTIVE"),
    website: text("website"),
    description: text("description"),
    /** Stored in the media library once confirmed; the discovery pass may propose one. */
    logoMediaId: uuid("logo_media_id"),
    logoUrl: text("logo_url"),
    faviconUrl: text("favicon_url"),
    brandColours: jsonb("brand_colours").$type<BrandColours>().notNull().default({}),
    links: jsonb("links").$type<OrganizationLinks>().notNull().default({}),
    /** Interface language for new members; a publication chooses its own language separately. */
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    country: text("country"),
    /** Free-form workspace settings (tone, editorial defaults, white-label overrides). */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug), index("organizations_status_idx").on(t.status)],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    role: organizationRoleEnum("role").notNull().default("VIEWER"),
    /** The workspace a member lands in when they sign in, when they belong to several. */
    isDefault: boolean("is_default").notNull().default(false),
    invitedById: uuid("invited_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("organization_members_unique_idx").on(t.organizationId, t.userId),
    index("organization_members_user_idx").on(t.userId),
  ],
);

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: publicationStatusEnum("status").notNull().default("ACTIVE"),
    /** The language this title publishes in; an organisation may run several language editions. */
    language: text("language").notNull().default("en"),
    /** Output formats offered by default for a new edition — each edition may still choose its own. */
    defaultFormats: text("default_formats").array().notNull().default(["EMAIL"]),
    /** Cadence hint used by automation and by the "next edition" card ("monthly", "weekly"…). */
    cadence: text("cadence").notNull().default("monthly"),
    /** Look and feel: typography, colours, cover style, section list, header/footer. */
    theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
    /** Public subscription page slug, e.g. /s/acme-weekly. */
    subscribeSlug: text("subscribe_slug"),
    isPublic: boolean("is_public").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("publications_org_slug_idx").on(t.organizationId, t.slug),
    uniqueIndex("publications_subscribe_slug_idx").on(t.subscribeSlug),
    index("publications_org_idx").on(t.organizationId),
  ],
);

export const campuses = pgTable(
  "campuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    city: text("city"),
    country: text("country").default("France"),
    colour: text("colour").default("#2BAFE0"),
    timezone: text("timezone").default("Europe/Paris"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    // How many of this campus's contributors a new monthly campaign invites by default. Editors
    // still adjust the exact number per campaign; this is the starting point they configure once.
    defaultInviteTarget: integer("default_invite_target").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("campuses_slug_idx").on(t.organizationId, t.slug)],
);

export const academicPrograms = pgTable(
  "academic_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    level: text("level"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("academic_programs_code_idx").on(t.organizationId, t.code)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    role: userRoleEnum("role").notNull().default("VIEWER"),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    avatarUrl: text("avatar_url"),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().default({}),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const contributors = pgTable(
  "contributors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    programId: uuid("program_id").references(() => academicPrograms.id, { onDelete: "set null" }),
    type: contributorTypeEnum("type").notNull().default("STUDENT"),
    organisationName: text("organisation_name"),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    isActive: boolean("is_active").notNull().default(true),
    tags: text("tags").array().notNull().default([]),
    notes: text("notes"),
    invitationsCount: integer("invitations_count").notNull().default(0),
    submissionsCount: integer("submissions_count").notNull().default(0),
    responseRate: real("response_rate"),
    lastInvitedAt: timestamp("last_invited_at", { withTimezone: true }),
    lastContributionAt: timestamp("last_contribution_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("contributors_email_idx").on(t.organizationId, t.email), index("contributors_campus_idx").on(t.campusId)],
);

export const contributorGroups = pgTable(
  "contributor_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contributor_groups_slug_idx").on(t.organizationId, t.slug)],
);

export const contributorGroupMembers = pgTable(
  "contributor_group_members",
  {
    groupId: uuid("group_id").notNull().references(() => contributorGroups.id, { onDelete: "cascade" }),
    contributorId: uuid("contributor_id").notNull().references(() => contributors.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.contributorId] })],
);
