import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { assertTransition, type EditionStatus, phaseForStatus } from "@/lib/editorial/edition-state";
import { DEFAULT_SECTIONS } from "@/lib/constants";
import { slugify } from "@/lib/utils";
import { guardTenant, scoped, stampTenant } from "@/server/tenancy/scope";
import { applyPublicationDefaults } from "@/server/outputs/service";
import { requireLimit } from "@/server/billing/entitlements";
import { optionalOrganizationId } from "@/server/tenancy/context";
import { forgetFiles } from "@/server/storage/forget";
import { logger } from "@/server/logger";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(month: number, year: number) {
  return `${MONTHS[month - 1]} ${year}`;
}

export const createEditionSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  issueNumber: z.number().int().positive().optional(),
  publicationId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(160).optional(),
  isSpecialIssue: z.boolean().default(false),
  publicationTargetAt: z.coerce.date().optional(),
  finalReviewAt: z.coerce.date().optional(),
  targetPageCount: z.number().int().min(4).max(96).default(24),
  pageSize: z.enum(["A4", "TABLOID", "LETTER"]).default("A4"),
  editorInChiefId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateEditionInput = z.infer<typeof createEditionSchema>;

/**
 * The month the next edition is for.
 *
 * The month after the latest edition on the books, or the coming month when there is none or the
 * latest is already behind us. It answers the one question the old dialog asked that a person
 * could not answer faster than Briefly.
 */
export async function nextEditionMonth(now = new Date()): Promise<{ month: number; year: number }> {
  const [latest] = await db
    .select({ month: s.editions.month, year: s.editions.year })
    .from(s.editions)
    .where(await scoped(s.editions.organizationId, isNull(s.editions.hiddenAt)))
    .orderBy(desc(s.editions.year), desc(s.editions.month))
    .limit(1);
  const coming = { month: now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2, year: now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear() };
  if (!latest) return coming;
  const after = { month: latest.month === 12 ? 1 : latest.month + 1, year: latest.month === 12 ? latest.year + 1 : latest.year };
  return after.year * 12 + after.month >= coming.year * 12 + coming.month ? after : coming;
}

/**
 * One click: the next edition, ready to work in.
 *
 * Month, issue number, title, sections, dates, the title's usual formats and the contribution
 * campaign are all decided from what the workspace already knows. Every one of them can be
 * changed afterwards from the edition itself; none of them needs to be asked first.
 */
export async function prepareEdition(userId: string) {
  const when = await nextEditionMonth();
  const edition = await createEdition({ month: when.month, year: when.year, isSpecialIssue: false }, userId);
  try {
    const { scheduleFromDefaults } = await import("@/server/campaigns/service");
    await scheduleFromDefaults(edition.id, { id: userId });
  } catch (err) {
    // The edition stands without its campaign; the overview says so and offers to open one.
    logger.warn("prepared edition without a campaign", { editionId: edition.id, err });
  }
  return edition;
}

export async function nextIssueNumber() {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${s.editions.issueNumber}), 0)` }).from(s.editions).where(await scoped(s.editions.organizationId));
  return Number(row?.max ?? 0) + 1;
}

export async function createEdition(rawInput: z.input<typeof createEditionSchema>, userId?: string | null) {
  const input = createEditionSchema.parse(rawInput);
  const organizationId = await optionalOrganizationId();
  if (organizationId) await requireLimit(organizationId, "editionsPerMonth");
  const issueNumber = input.issueNumber ?? (await nextIssueNumber());
  const label = monthLabel(input.month, input.year);
  // An edition belongs to a recurring title; without one it has no default formats, no subscribers
  // and no name to inherit. When the caller does not say which, use the workspace's first.
  const publication = input.publicationId
    ? await db.query.publications.findFirst({ where: await scoped(s.publications.organizationId, eq(s.publications.id, input.publicationId)) })
    : await db.query.publications.findFirst({ where: await scoped(s.publications.organizationId), orderBy: [asc(s.publications.sortOrder), asc(s.publications.createdAt)] });
  const title = input.title ?? `${publication?.name ?? "Edition"} — ${input.isSpecialIssue ? "Special issue" : "Issue"} N°${issueNumber}`;
  const slug = slugify(`${input.isSpecialIssue ? "special-issue" : "issue"}-${issueNumber}-${label}`);
  const existing = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.slug, slug)) });
  if (existing) throw new ValidationError(`An edition already exists for ${label}`, { month: ["Edition already exists"] });
  const publicationTargetAt = input.publicationTargetAt ?? new Date(Date.UTC(input.year, input.month - 1, 15, 10, 0, 0));
  const finalReviewAt = input.finalReviewAt ?? new Date(Date.UTC(input.year, input.month - 1, 11, 16, 0, 0));
  const edition = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.editions)
      .values(await stampTenant({
        publicationId: publication?.id ?? null,
        issueNumber,
        title,
        slug,
        label,
        month: input.month,
        year: input.year,
        status: "UPCOMING",
        isSpecialIssue: input.isSpecialIssue,
        publicationTargetAt,
        finalReviewAt,
        targetPageCount: input.targetPageCount,
        pageSize: input.pageSize,
        editorInChiefId: input.editorInChiefId ?? null,
        createdById: userId ?? null,
        notes: input.notes ?? null,
      }))
      .returning();
    const setting = await tx.query.systemSettings.findFirst({ where: eq(s.systemSettings.key, "default_sections") });
    const sections = (Array.isArray(setting?.value) ? setting!.value : DEFAULT_SECTIONS) as unknown as { slug: string; name: string; kicker: string | null; colour: string; targetPages: number }[];
    await tx.insert(s.editionSections).values(sections.map((sec, i) => ({ editionId: row.id, slug: sec.slug, name: sec.name, kicker: sec.kicker ?? null, colour: sec.colour ?? null, sortOrder: i, targetPages: sec.targetPages ?? null })));
    return row;
  });
  // The title's usual formats are a starting point; the edition can change them before it goes out.
  await applyPublicationDefaults(edition.id, userId);
  await audit({ action: "edition.create", userId, entityType: "EDITION", entityId: edition.id, editionId: edition.id, metadata: { issueNumber, label, publicationId: publication?.id ?? null } });
  return edition;
}

export const updateEditionSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  label: z.string().trim().min(1).max(60).optional(),
  publicationTargetAt: z.coerce.date().nullable().optional(),
  finalReviewAt: z.coerce.date().nullable().optional(),
  targetPageCount: z.number().int().min(4).max(96).optional(),
  pageSize: z.enum(["A4", "TABLOID", "LETTER"]).optional(),
  editorInChiefId: z.string().uuid().nullable().optional(),
  coverHeadline: z.string().max(200).nullable().optional(),
  coverStandfirst: z.string().max(400).nullable().optional(),
  coverStoryId: z.string().uuid().nullable().optional(),
  coverMediaAssetId: z.string().uuid().nullable().optional(),
  editorial: z.string().max(4000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isSpecialIssue: z.boolean().optional(),
  theme: z.object({ coverTemplate: z.string().optional(), accentColour: z.string().optional(), tagline: z.string().optional() }).optional(),
});

export async function updateEdition(editionId: string, rawPatch: z.input<typeof updateEditionSchema>, userId?: string | null) {
  const patch = updateEditionSchema.parse(rawPatch);
  const [row] = await db.update(s.editions).set(patch).where(eq(s.editions.id, editionId)).returning();
  if (!row) throw new NotFoundError("Edition");
  await audit({ action: "edition.update", userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { fields: Object.keys(patch) } });
  return row;
}

export async function transitionEdition(editionId: string, to: EditionStatus, userId?: string | null, reason?: string) {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  assertTransition(edition.status, to);
  const extra: Partial<typeof s.editions.$inferInsert> = {};
  if (to === "PUBLISHED") extra.publishedAt = new Date();
  if (to === "ARCHIVED") extra.archivedAt = new Date();
  const [row] = await db.update(s.editions).set({ status: to, ...extra }).where(eq(s.editions.id, editionId)).returning();
  await audit({ action: "edition.transition", userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { from: edition.status, to, reason } });
  return row;
}

export async function getEdition(editionId: string) {
  const edition = await guardTenant(
    await db.query.editions.findFirst({
      where: eq(s.editions.id, editionId),
      with: { sections: { orderBy: [asc(s.editionSections.sortOrder)] }, campaigns: { orderBy: [desc(s.submissionCampaigns.createdAt)], limit: 1 }, editorInChief: true },
    }),
    "Edition",
  );
  if (!edition) throw new NotFoundError("Edition");
  return edition;
}

export async function listEditions(options: { includeHidden?: boolean } = {}) {
  return db.query.editions.findMany({
    where: await scoped(s.editions.organizationId, options.includeHidden ? undefined : isNull(s.editions.hiddenAt)),
    orderBy: [desc(s.editions.year), desc(s.editions.month), desc(s.editions.issueNumber)],
    with: { campaigns: { orderBy: [desc(s.submissionCampaigns.createdAt)], limit: 1 } },
  });
}

/**
 * Hide editions, or bring them back. Out of the lists and the overview, not out of the record:
 * archiving is a state in an edition's life, this is housekeeping, and it is reversible in one click.
 */
export async function setEditionsHidden(ids: string[], hidden: boolean, userId?: string | null) {
  if (!ids.length) return 0;
  const rows = await db
    .update(s.editions)
    .set({ hiddenAt: hidden ? new Date() : null })
    .where(await scoped(s.editions.organizationId, inArray(s.editions.id, ids)))
    .returning({ id: s.editions.id, organizationId: s.editions.organizationId, label: s.editions.label });
  await Promise.all(rows.map((row) => audit({ action: hidden ? "edition.hide" : "edition.show", organizationId: row.organizationId, userId, entityType: "EDITION", entityId: row.id, editionId: row.id, metadata: { label: row.label } })));
  return rows.length;
}

/**
 * Delete editions, and everything that was theirs.
 *
 * The rows cascade: stories, submissions, campaigns, versions, outputs, the automation history.
 * Two things do not, on purpose. The media library is the organisation's, not the edition's — a
 * photograph used in March is still a photograph — so assets keep their files and lose only the
 * edition they were filed under; a Studio pack survives its source for the same reason. What does
 * go is collected before the cascade forgets where it was: the rendered PDFs and Word files of
 * every version, and the attachments contributors sent in.
 */
export async function deleteEditions(ids: string[], userId?: string | null) {
  if (!ids.length) return 0;
  const rows = await db.query.editions.findMany({ where: await scoped(s.editions.organizationId, inArray(s.editions.id, ids)), columns: { id: true, organizationId: true, label: true } });
  if (!rows.length) return 0;
  const editionIds = rows.map((row) => row.id);
  const [versionFiles, attachments] = await Promise.all([
    db.select({ key: s.publicationAssets.storageKey }).from(s.publicationAssets).where(inArray(s.publicationAssets.editionId, editionIds)),
    db
      .select({ key: s.submissionAttachments.storageKey })
      .from(s.submissionAttachments)
      .innerJoin(s.submissions, eq(s.submissions.id, s.submissionAttachments.submissionId))
      .where(inArray(s.submissions.editionId, editionIds)),
  ]);
  await db.delete(s.editions).where(inArray(s.editions.id, editionIds));
  await forgetFiles([...versionFiles, ...attachments].map((row) => row.key));
  await Promise.all(rows.map((row) => audit({ action: "edition.delete", organizationId: row.organizationId, userId, entityType: "EDITION", entityId: row.id, metadata: { label: row.label } })));
  return rows.length;
}

const STATUS_PRIORITY: EditionStatus[] = ["FINAL_REVIEW", "LAYOUT", "EDITORIAL_REVIEW", "PROCESSING", "CLOSED", "GRACE_PERIOD", "REMINDER_2", "REMINDER_1", "OPEN", "UPCOMING", "PUBLISHED", "ARCHIVED"];

/** The edition the newsroom is working on right now: the most advanced non-archived edition. */
export async function getCurrentEdition() {
  const rows = await db.query.editions.findMany({ where: await scoped(s.editions.organizationId, ne(s.editions.status, "ARCHIVED"), isNull(s.editions.hiddenAt)), orderBy: [desc(s.editions.year), desc(s.editions.month)] });
  if (!rows.length) return null;
  const inProduction = rows.filter((r) => r.status !== "PUBLISHED" && r.status !== "UPCOMING");
  if (inProduction.length) return inProduction.sort((a, b) => STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status))[0];
  const upcoming = rows.filter((r) => r.status === "UPCOMING").sort((a, b) => a.year - b.year || a.month - b.month);
  return upcoming[0] ?? rows[0];
}

export type EditionDashboard = Awaited<ReturnType<typeof editionDashboard>>;

export async function editionDashboard(editionId: string) {
  const edition = await getEdition(editionId);
  const [subs] = await db.select({ total: count(), drafts: sql<number>`count(*) filter (where ${s.submissions.status} = 'DRAFT')`, needsReview: sql<number>`count(*) filter (where ${s.submissions.status} in ('NEW','NEEDS_REVIEW'))`, missingInfo: sql<number>`count(*) filter (where ${s.submissions.status} = 'MISSING_INFO')`, duplicates: sql<number>`count(*) filter (where ${s.submissions.status} = 'DUPLICATE')`, accepted: sql<number>`count(*) filter (where ${s.submissions.status} = 'ACCEPTED')`, rejected: sql<number>`count(*) filter (where ${s.submissions.status} = 'REJECTED')`, processed: sql<number>`count(*) filter (where ${s.submissions.processedAt} is not null)` }).from(s.submissions).where(and(eq(s.submissions.editionId, editionId), ne(s.submissions.status, "DRAFT")));
  const [clusters] = await db.select({ total: count(), confirmed: sql<number>`count(*) filter (where ${s.storyClusters.status} = 'CONFIRMED')` }).from(s.storyClusters).where(and(eq(s.storyClusters.editionId, editionId), inArray(s.storyClusters.status, ["PROPOSED", "CONFIRMED"])));
  const [stories] = await db.select({ total: count(), candidates: sql<number>`count(*) filter (where ${s.stories.status} = 'CANDIDATE')`, selected: sql<number>`count(*) filter (where ${s.stories.status} in ('SELECTED','DRAFTING','IN_REVIEW','APPROVED','PUBLISHED'))`, approved: sql<number>`count(*) filter (where ${s.stories.status} in ('APPROVED','PUBLISHED'))`, rejected: sql<number>`count(*) filter (where ${s.stories.status} in ('REJECTED','DROPPED'))` }).from(s.stories).where(eq(s.stories.editionId, editionId));
  const [articles] = await db.select({ total: count(), drafted: sql<number>`count(*) filter (where ${s.articles.status} <> 'EMPTY')`, inEditing: sql<number>`count(*) filter (where ${s.articles.status} in ('AI_DRAFT','IN_EDITING'))`, ready: sql<number>`count(*) filter (where ${s.articles.status} = 'READY_FOR_REVIEW')`, approved: sql<number>`count(*) filter (where ${s.articles.status} in ('APPROVED','LOCKED'))` }).from(s.articles).innerJoin(s.stories, eq(s.articles.storyId, s.stories.id)).where(and(eq(s.articles.editionId, editionId), inArray(s.stories.status, ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"])));
  const [media] = await db.select({ total: count(), green: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'GREEN')`, yellow: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'YELLOW')`, red: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'RED')`, lowQuality: sql<number>`count(*) filter (where ${s.mediaAssets.qualityScore} < 50)` }).from(s.mediaAssets).where(and(eq(s.mediaAssets.editionId, editionId), eq(s.mediaAssets.isArchived, false)));
  const [flags] = await db.select({ disputedFacts: sql<number>`count(*) filter (where ${s.facts.status} = 'DISPUTED')` }).from(s.facts).where(eq(s.facts.editionId, editionId));
  const storyFlags = await db.select({ warnings: s.stories.warnings, missing: s.stories.missingInformation, status: s.stories.status }).from(s.stories).where(and(eq(s.stories.editionId, editionId), inArray(s.stories.status, ["CANDIDATE", "SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED"])));
  const storiesNeedingAttention = storyFlags.filter((r) => (r.warnings?.length ?? 0) > 0 || (r.missing?.filter((m) => !m.resolved).length ?? 0) > 0).length;
  const [ai] = await db.select({ costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)`, calls: count(), tokens: sql<number>`coalesce(sum(${s.aiJobs.inputTokens} + ${s.aiJobs.outputTokens}), 0)`, failed: sql<number>`count(*) filter (where ${s.aiJobs.status} = 'FAILED')` }).from(s.aiJobs).where(eq(s.aiJobs.editionId, editionId));
  const campusRows = await db
    .select({ campusId: s.campuses.id, name: s.campuses.name, slug: s.campuses.slug, colour: s.campuses.colour, submissions: sql<number>`count(distinct ${s.submissionCampuses.submissionId})` })
    .from(s.campuses)
    .leftJoin(s.submissionCampuses, eq(s.submissionCampuses.campusId, s.campuses.id))
    .leftJoin(s.submissions, and(eq(s.submissions.id, s.submissionCampuses.submissionId), eq(s.submissions.editionId, editionId), ne(s.submissions.status, "DRAFT")))
    .where(eq(s.campuses.isActive, true))
    .groupBy(s.campuses.id)
    .orderBy(asc(s.campuses.sortOrder));
  const storyCampusRows = await db
    .select({ campusId: s.storyCampuses.campusId, stories: sql<number>`count(distinct ${s.stories.id})` })
    .from(s.storyCampuses)
    .innerJoin(s.stories, and(eq(s.stories.id, s.storyCampuses.storyId), eq(s.stories.editionId, editionId), inArray(s.stories.status, ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"])))
    .groupBy(s.storyCampuses.campusId);
  const storyCampusMap = new Map(storyCampusRows.map((r) => [r.campusId, Number(r.stories)]));
  const campuses = campusRows.map((c) => ({ ...c, submissions: Number(c.submissions), stories: storyCampusMap.get(c.campusId) ?? 0 }));
  const represented = campuses.filter((c) => c.submissions > 0).length;
  const avg = campuses.length ? campuses.reduce((n, c) => n + c.submissions, 0) / campuses.length : 0;
  const underrepresented = campuses.filter((c) => avg > 0 && c.submissions < avg * 0.5);
  const max = Math.max(1, ...campuses.map((c) => c.submissions));
  const min = Math.min(...campuses.map((c) => c.submissions));
  const balance = campuses.length ? min / max : 1;
  const [plan] = await db.select({ pages: count(), ready: sql<number>`count(*) filter (where (${s.pagePlanPages.storyId} is not null or ${s.pagePlanPages.template} in ('COVER_A','COVER_B','CONTENTS','BACK_PAGE','SECTION_OPENER')) and jsonb_array_length(${s.pagePlanPages.warnings}) = 0)`, warnings: sql<number>`count(*) filter (where jsonb_array_length(${s.pagePlanPages.warnings}) > 0)` }).from(s.pagePlanPages).innerJoin(s.pagePlans, and(eq(s.pagePlans.id, s.pagePlanPages.planId), eq(s.pagePlans.isActive, true))).where(eq(s.pagePlans.editionId, editionId));
  const latestVersion = await db.query.publicationVersions.findFirst({ where: eq(s.publicationVersions.editionId, editionId), orderBy: [desc(s.publicationVersions.sequence)], with: { assets: true } });
  const runs = await db.query.automationRuns.findMany({ where: eq(s.automationRuns.editionId, editionId), orderBy: [asc(s.automationRuns.scheduledFor)] });
  const campaign = edition.campaigns[0] ?? null;
  const [requests] = campaign
    ? await db.select({ invited: count(), submitted: sql<number>`count(*) filter (where ${s.submissionRequests.status} = 'SUBMITTED')`, opened: sql<number>`count(*) filter (where ${s.submissionRequests.status} in ('OPENED','SUBMITTED'))` }).from(s.submissionRequests).where(eq(s.submissionRequests.campaignId, campaign.id))
    : [{ invited: 0, submitted: 0, opened: 0 }];
  return {
    edition,
    campaign,
    phase: phaseForStatus(edition.status),
    submissions: { total: Number(subs.total), needsReview: Number(subs.needsReview), missingInfo: Number(subs.missingInfo), duplicates: Number(subs.duplicates), accepted: Number(subs.accepted), rejected: Number(subs.rejected), processed: Number(subs.processed) },
    requests: { invited: Number(requests.invited), submitted: Number(requests.submitted), opened: Number(requests.opened), responseRate: Number(requests.invited) ? Number(requests.submitted) / Number(requests.invited) : 0 },
    clusters: { total: Number(clusters.total), confirmed: Number(clusters.confirmed) },
    stories: { total: Number(stories.total), candidates: Number(stories.candidates), selected: Number(stories.selected), approved: Number(stories.approved), rejected: Number(stories.rejected) },
    articles: { total: Number(articles.total), drafted: Number(articles.drafted), inEditing: Number(articles.inEditing), ready: Number(articles.ready), approved: Number(articles.approved) },
    media: { total: Number(media.total), green: Number(media.green), yellow: Number(media.yellow), red: Number(media.red), lowQuality: Number(media.lowQuality) },
    flags: { disputedFacts: Number(flags.disputedFacts), storiesNeedingAttention, total: Number(flags.disputedFacts) + storiesNeedingAttention + Number(media.red) },
    ai: { costCents: Number(ai.costCents), calls: Number(ai.calls), tokens: Number(ai.tokens), failed: Number(ai.failed) },
    campuses,
    coverage: { represented, total: campuses.length, balance, underrepresented: underrepresented.map((c) => c.name), label: balance >= 0.6 ? "Balanced" : balance >= 0.3 ? "Uneven" : "Critical" },
    layout: { pages: Number(plan?.pages ?? 0), ready: Number(plan?.ready ?? 0), warnings: Number(plan?.warnings ?? 0), target: edition.targetPageCount },
    latestVersion,
    runs,
  };
}

export async function editionSectionsWithCounts(editionId: string) {
  const rows = await db
    .select({ section: s.editionSections, stories: sql<number>`count(${s.stories.id}) filter (where ${s.stories.status} in ('SELECTED','DRAFTING','IN_REVIEW','APPROVED','PUBLISHED'))`, candidates: sql<number>`count(${s.stories.id}) filter (where ${s.stories.status} = 'CANDIDATE')` })
    .from(s.editionSections)
    .leftJoin(s.stories, eq(s.stories.sectionId, s.editionSections.id))
    .where(eq(s.editionSections.editionId, editionId))
    .groupBy(s.editionSections.id)
    .orderBy(asc(s.editionSections.sortOrder));
  return rows.map((r) => ({ ...r.section, stories: Number(r.stories), candidates: Number(r.candidates) }));
}

export const sectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(80),
  kicker: z.string().trim().max(80).nullable().optional(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  isHidden: z.boolean().default(false),
  targetPages: z.number().int().min(0).max(40).nullable().optional(),
});

/** Replace the section list of an edition (add / remove / rename / reorder / hide). Sections holding stories cannot be removed. */
export async function saveEditionSections(editionId: string, rawSections: z.input<typeof sectionInputSchema>[], userId?: string | null) {
  const sections = z.array(sectionInputSchema).min(1).parse(rawSections);
  const slugs = new Set<string>();
  for (const sec of sections) {
    if (slugs.has(sec.slug)) throw new ValidationError(`Duplicate section slug "${sec.slug}"`);
    slugs.add(sec.slug);
  }
  await db.transaction(async (tx) => {
    const existing = await tx.query.editionSections.findMany({ where: eq(s.editionSections.editionId, editionId) });
    const keepIds = new Set(sections.map((sec) => sec.id).filter(Boolean));
    for (const old of existing) {
      if (!keepIds.has(old.id)) {
        const [{ n }] = await tx.select({ n: count() }).from(s.stories).where(eq(s.stories.sectionId, old.id));
        if (Number(n) > 0) throw new ValidationError(`Section "${old.name}" still contains ${n} stories; move them first.`);
        await tx.delete(s.editionSections).where(eq(s.editionSections.id, old.id));
      }
    }
    for (const [i, sec] of sections.entries()) {
      if (sec.id) {
        await tx.update(s.editionSections).set({ slug: sec.slug, name: sec.name, kicker: sec.kicker ?? null, colour: sec.colour ?? null, isHidden: sec.isHidden, targetPages: sec.targetPages ?? null, sortOrder: i }).where(and(eq(s.editionSections.id, sec.id), eq(s.editionSections.editionId, editionId)));
      } else {
        await tx.insert(s.editionSections).values({ editionId, slug: sec.slug, name: sec.name, kicker: sec.kicker ?? null, colour: sec.colour ?? null, isHidden: sec.isHidden, targetPages: sec.targetPages ?? null, sortOrder: i });
      }
    }
  });
  await audit({ action: "edition.sections.save", userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { count: sections.length } });
  return editionSectionsWithCounts(editionId);
}

export async function recentActivity(editionId: string | null, limit = 12) {
  const rows = await db
    .select({ id: s.auditLog.id, action: s.auditLog.action, actorType: s.auditLog.actorType, entityType: s.auditLog.entityType, entityId: s.auditLog.entityId, metadata: s.auditLog.metadata, createdAt: s.auditLog.createdAt, userName: s.users.name })
    .from(s.auditLog)
    .leftJoin(s.users, eq(s.users.id, s.auditLog.userId))
    .where(editionId ? eq(s.auditLog.editionId, editionId) : isNotNull(s.auditLog.id))
    .orderBy(desc(s.auditLog.createdAt))
    .limit(limit);
  return rows;
}
