import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { slugify } from "@/lib/utils";

export const contributorInputSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  campusId: z.string().uuid().nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  type: z.enum(s.contributorTypeEnum.enumValues).default("STUDENT"),
  organisationName: z.string().trim().max(120).nullable().optional(),
  preferredLanguage: z.enum(["en", "fr"]).default("en"),
  isActive: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(40)).default([]),
  notes: z.string().max(2000).nullable().optional(),
  groupIds: z.array(z.string().uuid()).default([]),
});
export type ContributorInput = z.infer<typeof contributorInputSchema>;

export type ContributorFilters = { q?: string; campusId?: string; type?: string; groupId?: string; active?: "true" | "false" };

export async function listContributors(filters: ContributorFilters = {}) {
  const where = and(
    filters.q ? or(ilike(s.contributors.firstName, `%${filters.q}%`), ilike(s.contributors.lastName, `%${filters.q}%`), ilike(s.contributors.email, `%${filters.q}%`), ilike(s.contributors.organisationName, `%${filters.q}%`)) : undefined,
    filters.campusId ? (filters.campusId === "school" ? sql`${s.contributors.campusId} is null` : eq(s.contributors.campusId, filters.campusId)) : undefined,
    filters.type ? eq(s.contributors.type, filters.type as (typeof s.contributorTypeEnum.enumValues)[number]) : undefined,
    filters.active ? eq(s.contributors.isActive, filters.active === "true") : undefined,
    filters.groupId ? inArray(s.contributors.id, db.select({ id: s.contributorGroupMembers.contributorId }).from(s.contributorGroupMembers).where(eq(s.contributorGroupMembers.groupId, filters.groupId))) : undefined,
  );
  const rows = await db.query.contributors.findMany({ where, orderBy: [asc(s.contributors.lastName), asc(s.contributors.firstName)], with: { campus: true, program: true, groupMemberships: { with: { group: true } } }, limit: 500 });
  return rows;
}

export async function getContributor(id: string) {
  const row = await db.query.contributors.findFirst({ where: eq(s.contributors.id, id), with: { campus: true, program: true, groupMemberships: { with: { group: true } }, submissions: { orderBy: [desc(s.submissions.createdAt)], limit: 30, with: { edition: true } }, requests: { orderBy: [desc(s.submissionRequests.createdAt)], limit: 24, with: { campaign: { with: { edition: true } } } } } });
  if (!row) throw new NotFoundError("Contributor");
  return row;
}

export async function createContributor(raw: z.input<typeof contributorInputSchema>, userId?: string | null) {
  const input = contributorInputSchema.parse(raw);
  const existing = await db.query.contributors.findFirst({ where: eq(s.contributors.email, input.email) });
  if (existing) throw new ValidationError("A contributor with this email already exists", { email: ["Already used"] });
  const { groupIds, ...values } = input;
  const row = await db.transaction(async (tx) => {
    const [c] = await tx.insert(s.contributors).values(values).returning();
    if (groupIds.length) await tx.insert(s.contributorGroupMembers).values(groupIds.map((groupId) => ({ groupId, contributorId: c.id })));
    return c;
  });
  await audit({ action: "contributor.create", userId, entityType: "CONTRIBUTOR", entityId: row.id });
  return row;
}

export async function updateContributor(id: string, raw: Partial<z.input<typeof contributorInputSchema>>, userId?: string | null) {
  const input = contributorInputSchema.partial().parse(raw);
  const { groupIds, ...values } = input;
  const row = await db.transaction(async (tx) => {
    const [c] = await tx.update(s.contributors).set(values).where(eq(s.contributors.id, id)).returning();
    if (!c) throw new NotFoundError("Contributor");
    if (groupIds) {
      await tx.delete(s.contributorGroupMembers).where(eq(s.contributorGroupMembers.contributorId, id));
      if (groupIds.length) await tx.insert(s.contributorGroupMembers).values(groupIds.map((groupId) => ({ groupId, contributorId: id })));
    }
    return c;
  });
  await audit({ action: "contributor.update", userId, entityType: "CONTRIBUTOR", entityId: id, metadata: { fields: Object.keys(input) } });
  return row;
}

export async function setContributorActive(id: string, isActive: boolean, userId?: string | null) {
  const [row] = await db.update(s.contributors).set({ isActive }).where(eq(s.contributors.id, id)).returning();
  if (!row) throw new NotFoundError("Contributor");
  await audit({ action: isActive ? "contributor.activate" : "contributor.deactivate", userId, entityType: "CONTRIBUTOR", entityId: id });
  return row;
}

/** GDPR: anonymise a contributor (keeps editorial provenance, removes personal data). */
export async function anonymiseContributor(id: string, userId?: string | null) {
  const [row] = await db.update(s.contributors).set({ firstName: "Deleted", lastName: "Contributor", email: `deleted-${id}@anonymised.invalid`, notes: null, tags: [], isActive: false, organisationName: null }).where(eq(s.contributors.id, id)).returning();
  if (!row) throw new NotFoundError("Contributor");
  await db.delete(s.contributorGroupMembers).where(eq(s.contributorGroupMembers.contributorId, id));
  await audit({ action: "contributor.anonymise", userId, entityType: "CONTRIBUTOR", entityId: id });
  return row;
}

export async function listGroups() {
  const rows = await db.select({ group: s.contributorGroups, members: count(s.contributorGroupMembers.contributorId) }).from(s.contributorGroups).leftJoin(s.contributorGroupMembers, eq(s.contributorGroupMembers.groupId, s.contributorGroups.id)).groupBy(s.contributorGroups.id).orderBy(asc(s.contributorGroups.name));
  return rows.map((r) => ({ ...r.group, members: Number(r.members) }));
}

export const groupInputSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().max(400).nullable().optional(), campusId: z.string().uuid().nullable().optional() });

export async function createGroup(raw: z.input<typeof groupInputSchema>, userId?: string | null) {
  const input = groupInputSchema.parse(raw);
  const [row] = await db.insert(s.contributorGroups).values({ name: input.name, slug: slugify(input.name), description: input.description ?? null, campusId: input.campusId ?? null }).returning();
  await audit({ action: "contributor_group.create", userId, metadata: { name: input.name } });
  return row;
}

export async function deleteGroup(id: string, userId?: string | null) {
  const group = await db.query.contributorGroups.findFirst({ where: eq(s.contributorGroups.id, id) });
  if (!group) throw new NotFoundError("Group");
  if (group.isSystem) throw new ValidationError("System groups cannot be deleted");
  await db.delete(s.contributorGroups).where(eq(s.contributorGroups.id, id));
  await audit({ action: "contributor_group.delete", userId, metadata: { name: group.name } });
}

export async function contributorStats() {
  const [row] = await db.select({ total: count(), active: sql<number>`count(*) filter (where ${s.contributors.isActive})`, responders: sql<number>`count(*) filter (where ${s.contributors.submissionsCount} > 0)`, avgResponse: sql<number>`coalesce(avg(${s.contributors.responseRate}), 0)` }).from(s.contributors);
  return { total: Number(row.total), active: Number(row.active), responders: Number(row.responders), avgResponse: Number(row.avgResponse) };
}

// ── Campuses ──────────────────────────────────────────────────────────────────
export const campusInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2BAFE0"),
  timezone: z.string().default("Europe/Paris"),
  isActive: z.boolean().default(true),
  defaultInviteTarget: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function listCampusesWithStats() {
  const [rows, contributorCounts, submissionCounts, storyCounts] = await Promise.all([
    db.query.campuses.findMany({ orderBy: [asc(s.campuses.sortOrder), asc(s.campuses.name)] }),
    db.select({ campusId: s.contributors.campusId, n: count() }).from(s.contributors).where(eq(s.contributors.isActive, true)).groupBy(s.contributors.campusId),
    db.select({ campusId: s.submissionCampuses.campusId, n: count() }).from(s.submissionCampuses).groupBy(s.submissionCampuses.campusId),
    db.select({ campusId: s.storyCampuses.campusId, n: count() }).from(s.storyCampuses).groupBy(s.storyCampuses.campusId),
  ]);
  const toMap = (list: { campusId: string | null; n: number }[]) => new Map(list.filter((r) => r.campusId).map((r) => [r.campusId as string, Number(r.n)]));
  const c = toMap(contributorCounts);
  const sub = toMap(submissionCounts);
  const st = toMap(storyCounts);
  return rows.map((r) => ({ ...r, contributors: c.get(r.id) ?? 0, submissions: sub.get(r.id) ?? 0, stories: st.get(r.id) ?? 0 }));
}

export async function createCampus(raw: z.input<typeof campusInputSchema>, userId?: string | null) {
  const input = campusInputSchema.parse(raw);
  const slug = slugify(input.name);
  const existing = await db.query.campuses.findFirst({ where: eq(s.campuses.slug, slug) });
  if (existing) throw new ValidationError("A campus with this name already exists", { name: ["Already exists"] });
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${s.campuses.sortOrder}), 0)` }).from(s.campuses);
  const [row] = await db.insert(s.campuses).values({ ...input, slug, sortOrder: Number(max) + 1 }).returning();
  await audit({ action: "campus.create", userId, entityType: "CAMPUS", entityId: row.id, metadata: { name: input.name } });
  return row;
}

export async function updateCampus(id: string, raw: Partial<z.input<typeof campusInputSchema>> & { sortOrder?: number }, userId?: string | null) {
  const input = campusInputSchema.partial().extend({ sortOrder: z.number().int().optional() }).parse(raw);
  const [row] = await db.update(s.campuses).set(input).where(eq(s.campuses.id, id)).returning();
  if (!row) throw new NotFoundError("Campus");
  await audit({ action: "campus.update", userId, entityType: "CAMPUS", entityId: id, metadata: { fields: Object.keys(input) } });
  return row;
}

export async function listPrograms() {
  return db.query.academicPrograms.findMany({ orderBy: [asc(s.academicPrograms.sortOrder)] });
}
