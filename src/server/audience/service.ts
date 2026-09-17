import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";

export const audienceInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).default(""),
  segment: z.enum(s.audienceSegmentEnum.enumValues).default("OTHER"),
  organisation: z.string().trim().max(160).nullable().optional(),
  campusId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).default([]),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type AudienceInput = z.infer<typeof audienceInputSchema>;

export type AudienceFilters = { q?: string; segment?: string; campusId?: string; active?: "true" | "false" };

export async function listRecipients(filters: AudienceFilters = {}) {
  const where = and(
    filters.q ? or(ilike(s.audienceRecipients.firstName, `%${filters.q}%`), ilike(s.audienceRecipients.lastName, `%${filters.q}%`), ilike(s.audienceRecipients.email, `%${filters.q}%`), ilike(s.audienceRecipients.organisation, `%${filters.q}%`)) : undefined,
    filters.segment ? eq(s.audienceRecipients.segment, filters.segment as (typeof s.audienceSegmentEnum.enumValues)[number]) : undefined,
    filters.campusId ? (filters.campusId === "school" ? sql`${s.audienceRecipients.campusId} is null` : eq(s.audienceRecipients.campusId, filters.campusId)) : undefined,
    filters.active ? eq(s.audienceRecipients.isActive, filters.active === "true") : undefined,
  );
  const rows = await db.query.audienceRecipients.findMany({ where, orderBy: [asc(s.audienceRecipients.lastName), asc(s.audienceRecipients.firstName)], with: { campus: true }, limit: 500 });
  return rows;
}

export async function getRecipient(id: string) {
  const row = await db.query.audienceRecipients.findFirst({ where: eq(s.audienceRecipients.id, id), with: { campus: true } });
  if (!row) throw new NotFoundError("Recipient");
  return row;
}

export async function createRecipient(raw: z.input<typeof audienceInputSchema>, userId?: string | null, source = "manual") {
  const input = audienceInputSchema.parse(raw);
  const existing = await db.query.audienceRecipients.findFirst({ where: eq(s.audienceRecipients.email, input.email) });
  if (existing) throw new ValidationError("A recipient with this email already exists", { email: ["Already used"] });
  const [row] = await db.insert(s.audienceRecipients).values({ ...input, source }).returning();
  await audit({ action: "audience.create", userId, entityId: row.id, metadata: { email: input.email } });
  return row;
}

export async function updateRecipient(id: string, raw: Partial<z.input<typeof audienceInputSchema>>, userId?: string | null) {
  const input = audienceInputSchema.partial().parse(raw);
  const [row] = await db.update(s.audienceRecipients).set(input).where(eq(s.audienceRecipients.id, id)).returning();
  if (!row) throw new NotFoundError("Recipient");
  await audit({ action: "audience.update", userId, entityId: id, metadata: { fields: Object.keys(input) } });
  return row;
}

export async function setRecipientActive(id: string, isActive: boolean, userId?: string | null) {
  const [row] = await db.update(s.audienceRecipients).set({ isActive }).where(eq(s.audienceRecipients.id, id)).returning();
  if (!row) throw new NotFoundError("Recipient");
  await audit({ action: isActive ? "audience.activate" : "audience.deactivate", userId, entityId: id });
  return row;
}

export async function deleteRecipient(id: string, userId?: string | null) {
  const [row] = await db.delete(s.audienceRecipients).where(eq(s.audienceRecipients.id, id)).returning();
  if (!row) throw new NotFoundError("Recipient");
  await audit({ action: "audience.delete", userId, entityId: id, metadata: { email: row.email } });
  return row;
}

/** Counts by segment plus total / active / inactive, for the directory stat tiles. */
export async function audienceFacets() {
  const [totals] = await db
    .select({ total: count(), active: sql<number>`count(*) filter (where ${s.audienceRecipients.isActive})`, inactive: sql<number>`count(*) filter (where not ${s.audienceRecipients.isActive})` })
    .from(s.audienceRecipients);
  const segmentRows = await db.select({ segment: s.audienceRecipients.segment, n: count() }).from(s.audienceRecipients).groupBy(s.audienceRecipients.segment);
  const bySegment = Object.fromEntries(s.audienceSegmentEnum.enumValues.map((v) => [v, 0])) as Record<(typeof s.audienceSegmentEnum.enumValues)[number], number>;
  for (const r of segmentRows) bySegment[r.segment] = Number(r.n);
  return { total: Number(totals.total), active: Number(totals.active), inactive: Number(totals.inactive), bySegment };
}
