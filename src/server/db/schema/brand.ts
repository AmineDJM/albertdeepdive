import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { organizations, publications, users } from "./identity";
import type { BrandSystem } from "@/lib/brand/system";
import type { BrandOrigin } from "@/lib/brand/discover";

/**
 * A workspace's brand, versioned.
 *
 * One row is active per organisation, and one per newsletter that has a look of its own (read from
 * its own website or social page); the rest are history. A newsletter with no row of its own wears
 * its organisation's. Versioning rather than updating in place
 * because a brand is the input to everything Briefly renders — a magazine exported in March was set
 * in March's colours, and being able to say exactly what those were is the difference between
 * reproducing an artefact and approximating it.
 *
 * The system itself is one JSON document rather than thirty columns. It is read whole, written
 * whole, validated by a schema that lives with the code that consumes it, and never queried by
 * field — so columns would buy nothing and cost a migration every time the design system grows.
 */
export const brandSystems = pgTable(
  "brand_systems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Set when this is one newsletter's own brand rather than the organisation's. */
    publicationId: uuid("publication_id").references(() => publications.id, { onDelete: "cascade" }),
    /** What a person calls this version. Usually just "Brand", sometimes "2026 refresh". */
    name: text("name").notNull().default("Brand"),
    system: jsonb("system").$type<BrandSystem>().notNull(),
    /** Which fields onboarding read from the website, so the editor can mark the rest as ours. */
    origin: jsonb("origin").$type<Partial<Record<string, BrandOrigin>>>().notNull().default({}),
    /** What discovery could not find, shown once in the editor rather than silently defaulted. */
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One active brand per workspace, and one per newsletter, enforced by the database rather than
    // by whoever writes next.
    uniqueIndex("brand_systems_active_idx").on(t.organizationId).where(sql`${t.isActive} and ${t.publicationId} is null`),
    uniqueIndex("brand_systems_publication_active_idx").on(t.publicationId).where(sql`${t.isActive} and ${t.publicationId} is not null`),
    index("brand_systems_org_idx").on(t.organizationId, t.createdAt),
  ],
);
