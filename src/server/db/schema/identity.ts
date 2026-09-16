import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contributorTypeEnum, userRoleEnum } from "./enums";

export const campuses = pgTable(
  "campuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    city: text("city"),
    country: text("country").default("France"),
    colour: text("colour").default("#2BAFE0"),
    timezone: text("timezone").default("Europe/Paris"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("campuses_slug_idx").on(t.slug)],
);

export const academicPrograms = pgTable(
  "academic_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    level: text("level"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("academic_programs_code_idx").on(t.code)],
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
  (t) => [uniqueIndex("contributors_email_idx").on(t.email), index("contributors_campus_idx").on(t.campusId)],
);

export const contributorGroups = pgTable(
  "contributor_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contributor_groups_slug_idx").on(t.slug)],
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
