import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audienceSegmentEnum } from "./enums";
import { campuses } from "./identity";

/**
 * People the finished magazine is distributed to (annuaire d'envoi) — students, parents, partners,
 * administration, alumni, staff. Kept entirely separate from the contributor pool: contributors submit,
 * recipients receive. Emails are stored lower-cased so the unique index enforces case-insensitive uniqueness.
 */
export const audienceRecipients = pgTable(
  "audience_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    segment: audienceSegmentEnum("segment").notNull().default("OTHER"),
    organisation: text("organisation"),
    campusId: uuid("campus_id").references(() => campuses.id, { onDelete: "set null" }),
    tags: text("tags").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("audience_recipients_email_idx").on(t.email), index("audience_recipients_campus_idx").on(t.campusId), index("audience_recipients_segment_idx").on(t.segment)],
);
