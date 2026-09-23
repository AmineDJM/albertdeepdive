import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contributorTypeEnum, organizationRoleEnum, organizationStatusEnum, organizationTypeEnum, publicationStatusEnum, showcaseConsentEnum, transferStatusEnum, userRoleEnum } from "./enums";

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

/**
 * A customer's own Stripe account, connected from their settings.
 *
 * Sealed with the same cipher as every other secret typed into the interface. The hint is the last
 * four characters, enough to recognise a key and not enough to use one.
 */
export type ReaderPayments = {
  provider: "stripe";
  secretKey: { v: 1; iv: string; tag: string; data: string };
  keyHint: string;
  livemode: boolean;
  accountId: string | null;
  accountName: string | null;
  connectedAt: string;
  connectedById: string | null;
};

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: organizationTypeEnum("type").notNull().default("COMPANY"),
    /**
     * One person's own workspace, made with their account rather than joined.
     *
     * A newsletter has to live somewhere, and "somewhere" was always an organisation — which asks
     * somebody writing alone to invent a company before they can start. A personal workspace is a
     * real workspace in every other respect: it has publications, an audience, a brand. It differs
     * in that nobody else is added to it, and in that it is the natural side of a transfer when
     * something started alone becomes something a team runs.
     */
    isPersonal: boolean("is_personal").notNull().default(false),
    status: organizationStatusEnum("status").notNull().default("ACTIVE"),
    /**
     * A workspace Briefly runs itself, to have something beautiful in the gallery on day one.
     * It is not a customer: it pays nothing, counts for nothing in the platform's numbers, and its
     * editions may be shown without asking anybody, because there is nobody to ask.
     */
    isDemo: boolean("is_demo").notNull().default(false),
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
    /**
     * Who the workspace's mail is from, as its readers and contributors see it.
     *
     * The name on the envelope and where replies go belong to the customer, not to the domain they
     * send from: a workspace with no domain of its own still sends under its own name. A null name
     * follows the workspace's name, so renaming the workspace renames the sender with it; a null
     * reply address leaves replies to whatever the envelope says.
     */
    senderName: text("sender_name"),
    senderReplyTo: text("sender_reply_to"),
    /** Free-form workspace settings (tone, editorial defaults, white-label overrides). */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    /** The organisation's own payment account for paid titles. The key is sealed, never stored plain. */
    readerPayments: jsonb("reader_payments").$type<ReaderPayments | null>(),
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
    /**
     * Where this newsletter's look is read from: its own website, or a public social media page.
     *
     * A newsletter is often not dressed like the organisation that sends it — a school's alumni
     * review, a fund's portfolio letter — so its colours, type and mark are read from its own
     * address when it has one, and fall back to the organisation's when it does not.
     */
    website: text("website"),
    /** The newsletter's own mark, copied into the library so an email never points at somebody else's CDN. */
    logoMediaId: uuid("logo_media_id"),
    /** Look and feel: typography, colours, cover style, section list, header/footer. */
    theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
    /** Public subscription page slug, e.g. /s/acme-weekly. */
    subscribeSlug: text("subscribe_slug"),
    /**
     * Public contributor sign-up slug, e.g. /c/acme-weekly.
     *
     * The other half of a newsletter's public face. Readers had a link to put themselves on the
     * list and the people who write it had none — they arrived because somebody typed them in, or
     * imported them, which is how a title ends up asking the same twenty people for four years.
     */
    joinSlug: text("join_slug"),
    isPublic: boolean("is_public").notNull().default(true),
    /**
     * Whether this title may be shown in Briefly's public gallery, and on whose word.
     *
     * `NONE` until somebody decides otherwise, and nothing about publishing an edition changes it:
     * a customer's work going out to their own readers is not consent to appear in our marketing.
     * The customer sets `CUSTOMER` from their own settings and can withdraw it at any moment;
     * `PLATFORM_DEMO` is for workspaces Briefly made for the gallery; `PERMISSION` records a
     * customer who agreed elsewhere, and requires a note saying where.
     */
    showcaseConsent: showcaseConsentEnum("showcase_consent").notNull().default("NONE"),
    showcaseNote: text("showcase_note"),
    showcaseConsentAt: timestamp("showcase_consent_at", { withTimezone: true }),
    showcaseConsentById: uuid("showcase_consent_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    /**
     * Whether readers pay. A paid title checks out through the organisation's own Stripe account —
     * their key, their money, their receipts. Briefly never holds the funds.
     */
    access: text("access").notNull().default("free"), // free | paid
    priceCents: integer("price_cents"),
    priceCurrency: text("price_currency").notNull().default("eur"),
    priceInterval: text("price_interval").notNull().default("month"), // month | year
    /** The product and price Briefly created in the customer's Stripe for this title, so a checkout reuses them. */
    paymentRefs: jsonb("payment_refs").$type<{ productId: string; priceId: string; fingerprint: string } | null>(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("publications_org_slug_idx").on(t.organizationId, t.slug),
    uniqueIndex("publications_subscribe_slug_idx").on(t.subscribeSlug),
    uniqueIndex("publications_join_slug_idx").on(t.joinSlug),
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
    /**
     * How one account names another, for the things an email address is the wrong handle for.
     *
     * Transferring a newsletter is the first of them: you hand it to a person or an organisation,
     * and asking somebody to type a colleague's email to do it invites the transfer going to a
     * typo. Nullable because every account that already exists predates it; claimed once, and
     * unique after that.
     */
    username: text("username"),
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
  (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_username_idx").on(t.username)],
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

/**
 * Which newsletters a contributor writes for.
 *
 * A workspace may run several titles and the same person rarely writes for all of them. This is
 * what the public sign-up link fills in — the one thing a contributor knows about themselves that
 * the newsroom otherwise has to guess.
 */
export const publicationContributors = pgTable(
  "publication_contributors",
  {
    publicationId: uuid("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
    contributorId: uuid("contributor_id").notNull().references(() => contributors.id, { onDelete: "cascade" }),
    /** How they got here: `form` when they signed themselves up, `by-hand` when an editor said so. */
    source: text("source").notNull().default("form"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.publicationId, t.contributorId] }), index("publication_contributors_contributor_idx").on(t.contributorId)],
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

/**
 * Handing a newsletter to somebody else.
 *
 * A newsletter is not a row to be moved by an administrator: it has an audience who agreed to hear
 * from *it*, contributors who wrote for *it*, a name and a look somebody built. Moving it between
 * workspaces changes who is responsible for all of that, so neither side can do it alone.
 *
 * Two codes, and they are two different assertions. The one emailed to the owner says "the person
 * asking is really the person who holds this newsletter" — it defends against somebody who has a
 * session but not the mailbox. The one emailed to the receiving workspace's admin address says
 * "the other side agreed to take it", which is the half an owner cannot fake: a newsletter arriving
 * unannounced in a workspace, with its subscribers and its sending reputation, is not a gift.
 *
 * Only the hashes are kept. A code in the database is a code an operator can read out of it.
 */
export const publicationTransfers = pgTable(
  "publication_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicationId: uuid("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
    fromOrganizationId: uuid("from_organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    toOrganizationId: uuid("to_organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    requestedById: uuid("requested_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    /** Where each code went, recorded so the screen can say where to look without guessing. */
    ownerEmail: text("owner_email").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    ownerCodeHash: text("owner_code_hash").notNull(),
    recipientCodeHash: text("recipient_code_hash").notNull(),
    ownerConfirmedAt: timestamp("owner_confirmed_at", { withTimezone: true }),
    recipientConfirmedAt: timestamp("recipient_confirmed_at", { withTimezone: true }),
    /** Wrong codes are counted, so a six-digit code cannot be found by trying every six-digit code. */
    attempts: integer("attempts").notNull().default(0),
    status: transferStatusEnum("status").notNull().default("PENDING"),
    /** What moved, written at the moment it moved: the count of editions, readers and contributors. */
    moved: jsonb("moved").$type<Record<string, number>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("publication_transfers_publication_idx").on(t.publicationId),
    index("publication_transfers_status_idx").on(t.status),
  ],
);
