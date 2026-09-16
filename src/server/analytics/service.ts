/**
 * Analytics — every figure is a SQL aggregate scoped to one edition or to all editions.
 */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { STORY_TYPES } from "@/lib/constants";
import { bucketByDay, responseRate, type DayBucket } from "./compute";

export const SELECTED_STORY_STATUSES = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"] as const;

export type EditionOption = { id: string; label: string; issueNumber: number; status: (typeof s.editions)["$inferSelect"]["status"]; isSpecialIssue: boolean };

export async function listEditionOptions(): Promise<EditionOption[]> {
  return db
    .select({ id: s.editions.id, label: s.editions.label, issueNumber: s.editions.issueNumber, status: s.editions.status, isSpecialIssue: s.editions.isSpecialIssue })
    .from(s.editions)
    .orderBy(desc(s.editions.year), desc(s.editions.month));
}

export type CampusBreakdown = { campusId: string; name: string; colour: string | null; submissions: number; stories: number };
export type TypeBreakdown = { storyType: string; label: string; short: string; submissions: number; stories: number };
export type ServiceCost = { service: string; calls: number; tokens: number; costCents: number };
export type ModelCost = { model: string; provider: string; calls: number; tokens: number; costCents: number; avgLatencyMs: number | null; cached: number };
export type ActiveContributor = { contributorId: string; name: string; email: string; campusName: string | null; campusColour: string | null; submissions: number; accepted: number; lastAt: Date | null };

export type EditionAnalytics = {
  scope: { editionId: string | null; label: string };
  edition: { id: string; label: string; status: string; issueNumber: number; targetPageCount: number; publicationTargetAt: Date | null } | null;
  campaign: { opensAt: Date; graceEndsAt: Date; status: string } | null;
  submissions: { total: number; accepted: number; rejected: number; needsReview: number; duplicates: number; missingInfo: number; acceptedRatio: number };
  contributors: { invited: number; responded: number; opened: number; responseRate: number; distribution: { label: string; count: number }[]; mostActive: ActiveContributor[] };
  stories: { total: number; selected: number; approved: number; byStatus: { status: string; count: number }[] };
  articles: { total: number; drafted: number; approved: number; avgManualEditRatio: number | null; avgSubmissionToDraftHours: number | null };
  media: { total: number; green: number; yellow: number; red: number };
  ai: { calls: number; tokens: number; costCents: number; failed: number; cached: number; byService: ServiceCost[]; byModel: ModelCost[] };
  publication: { label: string; kind: string; status: string; pageCount: number | null; createdAt: Date } | null;
  byCampus: CampusBreakdown[];
  byStoryType: TypeBreakdown[];
  timeline: { granularity: "day" | "edition"; points: DayBucket[] };
};

function n(value: unknown): number {
  return Number(value ?? 0);
}

export async function editionAnalytics(editionId: string | null): Promise<EditionAnalytics> {
  const edition = editionId ? await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), with: { campaigns: { orderBy: [desc(s.submissionCampaigns.createdAt)], limit: 1 } } }) : null;
  if (editionId && !edition) throw new Error("Edition not found");
  const campaign = edition?.campaigns[0] ?? null;
  const subScope: SQL = editionId ? and(eq(s.submissions.editionId, editionId), ne(s.submissions.status, "DRAFT"))! : ne(s.submissions.status, "DRAFT");
  const storyScope = (col: typeof s.stories.editionId) => (editionId ? eq(col, editionId) : undefined);

  const [subs] = await db
    .select({
      total: sql<number>`count(*)`,
      accepted: sql<number>`count(*) filter (where ${s.submissions.status} = 'ACCEPTED')`,
      rejected: sql<number>`count(*) filter (where ${s.submissions.status} = 'REJECTED')`,
      needsReview: sql<number>`count(*) filter (where ${s.submissions.status} in ('NEW', 'NEEDS_REVIEW'))`,
      duplicates: sql<number>`count(*) filter (where ${s.submissions.status} = 'DUPLICATE')`,
      missingInfo: sql<number>`count(*) filter (where ${s.submissions.status} = 'MISSING_INFO')`,
    })
    .from(s.submissions)
    .where(subScope);

  const [requests] = await db
    .select({
      invited: sql<number>`count(*)`,
      responded: sql<number>`count(*) filter (where ${s.submissionRequests.status} = 'SUBMITTED')`,
      opened: sql<number>`count(*) filter (where ${s.submissionRequests.status} in ('OPENED', 'SUBMITTED'))`,
    })
    .from(s.submissionRequests)
    .where(editionId ? eq(s.submissionRequests.editionId, editionId) : undefined);

  const [distribution] = await db
    .select({
      b0: sql<number>`count(*) filter (where coalesce(${s.contributors.responseRate}, 0) < 0.25)`,
      b1: sql<number>`count(*) filter (where ${s.contributors.responseRate} >= 0.25 and ${s.contributors.responseRate} < 0.5)`,
      b2: sql<number>`count(*) filter (where ${s.contributors.responseRate} >= 0.5 and ${s.contributors.responseRate} < 0.75)`,
      b3: sql<number>`count(*) filter (where ${s.contributors.responseRate} >= 0.75)`,
    })
    .from(s.contributors)
    .where(
      editionId
        ? sql`exists (select 1 from ${s.submissionRequests} r where r.contributor_id = ${s.contributors.id} and r.edition_id = ${editionId})`
        : sql`${s.contributors.invitationsCount} > 0`,
    );

  const mostActiveRows = await db
    .select({
      contributorId: s.contributors.id,
      name: sql<string>`${s.contributors.firstName} || ' ' || ${s.contributors.lastName}`,
      email: s.contributors.email,
      campusName: s.campuses.name,
      campusColour: s.campuses.colour,
      submissions: sql<number>`count(${s.submissions.id})`,
      accepted: sql<number>`count(${s.submissions.id}) filter (where ${s.submissions.status} = 'ACCEPTED')`,
      lastAt: sql<Date | null>`max(${s.submissions.submittedAt})`,
    })
    .from(s.submissions)
    .innerJoin(s.contributors, eq(s.contributors.id, s.submissions.contributorId))
    .leftJoin(s.campuses, eq(s.campuses.id, s.contributors.campusId))
    .where(subScope)
    .groupBy(s.contributors.id, s.campuses.name, s.campuses.colour)
    .orderBy(desc(sql`count(${s.submissions.id})`), asc(s.contributors.lastName))
    .limit(10);

  const [stories] = await db
    .select({
      total: sql<number>`count(*)`,
      candidate: sql<number>`count(*) filter (where ${s.stories.status} = 'CANDIDATE')`,
      selected: sql<number>`count(*) filter (where ${s.stories.status} = 'SELECTED')`,
      drafting: sql<number>`count(*) filter (where ${s.stories.status} = 'DRAFTING')`,
      inReview: sql<number>`count(*) filter (where ${s.stories.status} = 'IN_REVIEW')`,
      approved: sql<number>`count(*) filter (where ${s.stories.status} = 'APPROVED')`,
      published: sql<number>`count(*) filter (where ${s.stories.status} = 'PUBLISHED')`,
      rejected: sql<number>`count(*) filter (where ${s.stories.status} = 'REJECTED')`,
      dropped: sql<number>`count(*) filter (where ${s.stories.status} = 'DROPPED')`,
    })
    .from(s.stories)
    .where(storyScope(s.stories.editionId));

  const [articles] = await db
    .select({
      total: sql<number>`count(*)`,
      drafted: sql<number>`count(*) filter (where ${s.articles.aiDraftedAt} is not null)`,
      approved: sql<number>`count(*) filter (where ${s.articles.status} in ('APPROVED', 'LOCKED'))`,
      avgManualEditRatio: sql<number | null>`avg(${s.articles.manualEditRatio})`,
    })
    .from(s.articles)
    .where(editionId ? eq(s.articles.editionId, editionId) : undefined);

  const [draftLatency] = await db.execute<{ hours: string | null }>(sql`
    select avg(t.hours) as hours from (
      select a.id, extract(epoch from (a.ai_drafted_at - min(sub.submitted_at))) / 3600 as hours
      from ${s.articles} a
      join ${s.articleSources} src on src.article_id = a.id
      join ${s.submissions} sub on sub.id = src.submission_id
      where a.ai_drafted_at is not null and sub.submitted_at is not null
      ${editionId ? sql`and a.edition_id = ${editionId}` : sql``}
      group by a.id
    ) t
  `);

  const [media] = await db
    .select({
      total: sql<number>`count(*)`,
      green: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'GREEN')`,
      yellow: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'YELLOW')`,
      red: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'RED')`,
    })
    .from(s.mediaAssets)
    .where(and(eq(s.mediaAssets.isArchived, false), editionId ? eq(s.mediaAssets.editionId, editionId) : undefined));

  const aiScope = editionId ? eq(s.aiJobs.editionId, editionId) : undefined;
  const [ai] = await db
    .select({
      calls: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens}, 0) + coalesce(${s.aiJobs.outputTokens}, 0)), 0)`,
      costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)`,
      failed: sql<number>`count(*) filter (where ${s.aiJobs.status} = 'FAILED')`,
      cached: sql<number>`count(*) filter (where ${s.aiJobs.cached})`,
    })
    .from(s.aiJobs)
    .where(aiScope);
  const byService = await db
    .select({ service: s.aiJobs.service, calls: sql<number>`count(*)`, tokens: sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens}, 0) + coalesce(${s.aiJobs.outputTokens}, 0)), 0)`, costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)` })
    .from(s.aiJobs)
    .where(aiScope)
    .groupBy(s.aiJobs.service)
    .orderBy(desc(sql`coalesce(sum(${s.aiJobs.costCents}), 0)`));
  const byModel = await db
    .select({
      model: s.aiJobs.model,
      provider: s.aiJobs.provider,
      calls: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens}, 0) + coalesce(${s.aiJobs.outputTokens}, 0)), 0)`,
      costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)`,
      avgLatencyMs: sql<number | null>`avg(${s.aiJobs.latencyMs}) filter (where ${s.aiJobs.cached} = false)`,
      cached: sql<number>`count(*) filter (where ${s.aiJobs.cached})`,
    })
    .from(s.aiJobs)
    .where(aiScope)
    .groupBy(s.aiJobs.model, s.aiJobs.provider)
    .orderBy(desc(sql`coalesce(sum(${s.aiJobs.costCents}), 0)`));

  const latestVersion = editionId
    ? await db.query.publicationVersions.findFirst({ where: eq(s.publicationVersions.editionId, editionId), orderBy: [desc(s.publicationVersions.sequence)], with: { assets: true } })
    : await db.query.publicationVersions.findFirst({ where: eq(s.publicationVersions.status, "READY"), orderBy: [desc(s.publicationVersions.createdAt)], with: { assets: true } });

  const campusRows = await db
    .select({ campusId: s.campuses.id, name: s.campuses.name, colour: s.campuses.colour, submissions: sql<number>`count(distinct ${s.submissions.id})` })
    .from(s.campuses)
    .leftJoin(s.submissionCampuses, eq(s.submissionCampuses.campusId, s.campuses.id))
    .leftJoin(s.submissions, and(eq(s.submissions.id, s.submissionCampuses.submissionId), subScope))
    .where(eq(s.campuses.isActive, true))
    .groupBy(s.campuses.id)
    .orderBy(asc(s.campuses.sortOrder));
  const storyCampusRows = await db
    .select({ campusId: s.storyCampuses.campusId, stories: sql<number>`count(distinct ${s.stories.id})` })
    .from(s.storyCampuses)
    .innerJoin(s.stories, and(eq(s.stories.id, s.storyCampuses.storyId), inArray(s.stories.status, [...SELECTED_STORY_STATUSES]), storyScope(s.stories.editionId)))
    .groupBy(s.storyCampuses.campusId);
  const storyCampusMap = new Map(storyCampusRows.map((r) => [r.campusId, n(r.stories)]));

  const subTypeRows = await db.select({ storyType: s.submissions.storyType, count: sql<number>`count(*)` }).from(s.submissions).where(subScope).groupBy(s.submissions.storyType);
  const storyTypeRows = await db
    .select({ storyType: s.stories.storyType, count: sql<number>`count(*)` })
    .from(s.stories)
    .where(and(inArray(s.stories.status, [...SELECTED_STORY_STATUSES]), storyScope(s.stories.editionId)))
    .groupBy(s.stories.storyType);
  const subTypeMap = new Map(subTypeRows.map((r) => [r.storyType, n(r.count)]));
  const storyTypeMap = new Map(storyTypeRows.map((r) => [r.storyType, n(r.count)]));
  const byStoryType: TypeBreakdown[] = STORY_TYPES.map((t) => ({ storyType: t.value, label: t.label, short: t.short, submissions: subTypeMap.get(t.value) ?? 0, stories: storyTypeMap.get(t.value) ?? 0 }))
    .filter((t) => t.submissions > 0 || t.stories > 0)
    .sort((a, b) => b.submissions - a.submissions || b.stories - a.stories);

  let timeline: EditionAnalytics["timeline"];
  if (editionId) {
    const dayRows = await db
      .select({ day: sql<string>`to_char(${s.submissions.submittedAt} at time zone 'Europe/Paris', 'YYYY-MM-DD')`, count: sql<number>`count(*)` })
      .from(s.submissions)
      .where(and(subScope, sql`${s.submissions.submittedAt} is not null`))
      .groupBy(sql`to_char(${s.submissions.submittedAt} at time zone 'Europe/Paris', 'YYYY-MM-DD')`);
    const points = dayRows.map((r) => ({ day: r.day, count: n(r.count) }));
    timeline = { granularity: "day", points: bucketByDay(points, campaign ? { start: campaign.opensAt, end: campaign.graceEndsAt } : null) };
  } else {
    const editionRows = await db
      .select({ id: s.editions.id, label: s.editions.label, year: s.editions.year, month: s.editions.month, count: sql<number>`count(${s.submissions.id})` })
      .from(s.editions)
      .leftJoin(s.submissions, and(eq(s.submissions.editionId, s.editions.id), ne(s.submissions.status, "DRAFT")))
      .groupBy(s.editions.id)
      .orderBy(asc(s.editions.year), asc(s.editions.month));
    let cumulative = 0;
    timeline = {
      granularity: "edition",
      points: editionRows.map((r) => {
        cumulative += n(r.count);
        return { day: `${r.year}-${String(r.month).padStart(2, "0")}`, label: r.label, count: n(r.count), cumulative };
      }),
    };
  }

  const invited = n(requests?.invited);
  const responded = n(requests?.responded);
  const pdfAsset = latestVersion?.assets.find((a) => a.kind === "PDF");
  return {
    scope: { editionId, label: edition ? edition.label : "All editions" },
    edition: edition ? { id: edition.id, label: edition.label, status: edition.status, issueNumber: edition.issueNumber, targetPageCount: edition.targetPageCount, publicationTargetAt: edition.publicationTargetAt } : null,
    campaign: campaign ? { opensAt: campaign.opensAt, graceEndsAt: campaign.graceEndsAt, status: campaign.status } : null,
    submissions: { total: n(subs?.total), accepted: n(subs?.accepted), rejected: n(subs?.rejected), needsReview: n(subs?.needsReview), duplicates: n(subs?.duplicates), missingInfo: n(subs?.missingInfo), acceptedRatio: n(subs?.accepted) + n(subs?.rejected) ? n(subs?.accepted) / (n(subs?.accepted) + n(subs?.rejected)) : 0 },
    contributors: {
      invited,
      responded,
      opened: n(requests?.opened),
      responseRate: responseRate(invited, responded),
      distribution: [
        { label: "0–25%", count: n(distribution?.b0) },
        { label: "25–50%", count: n(distribution?.b1) },
        { label: "50–75%", count: n(distribution?.b2) },
        { label: "75–100%", count: n(distribution?.b3) },
      ],
      mostActive: mostActiveRows.map((r) => ({ ...r, submissions: n(r.submissions), accepted: n(r.accepted), lastAt: r.lastAt ? new Date(r.lastAt) : null })),
    },
    stories: {
      total: n(stories?.total),
      selected: n(stories?.selected) + n(stories?.drafting) + n(stories?.inReview) + n(stories?.approved) + n(stories?.published),
      approved: n(stories?.approved) + n(stories?.published),
      byStatus: [
        { status: "CANDIDATE", count: n(stories?.candidate) },
        { status: "SELECTED", count: n(stories?.selected) },
        { status: "DRAFTING", count: n(stories?.drafting) },
        { status: "IN_REVIEW", count: n(stories?.inReview) },
        { status: "APPROVED", count: n(stories?.approved) },
        { status: "PUBLISHED", count: n(stories?.published) },
        { status: "REJECTED", count: n(stories?.rejected) },
        { status: "DROPPED", count: n(stories?.dropped) },
      ].filter((r) => r.count > 0),
    },
    articles: {
      total: n(articles?.total),
      drafted: n(articles?.drafted),
      approved: n(articles?.approved),
      avgManualEditRatio: articles?.avgManualEditRatio == null ? null : Number(articles.avgManualEditRatio),
      avgSubmissionToDraftHours: draftLatency?.hours == null ? null : Number(draftLatency.hours),
    },
    media: { total: n(media?.total), green: n(media?.green), yellow: n(media?.yellow), red: n(media?.red) },
    ai: {
      calls: n(ai?.calls),
      tokens: n(ai?.tokens),
      costCents: n(ai?.costCents),
      failed: n(ai?.failed),
      cached: n(ai?.cached),
      byService: byService.map((r) => ({ service: r.service, calls: n(r.calls), tokens: n(r.tokens), costCents: n(r.costCents) })),
      byModel: byModel.map((r) => ({ model: r.model, provider: r.provider, calls: n(r.calls), tokens: n(r.tokens), costCents: n(r.costCents), avgLatencyMs: r.avgLatencyMs == null ? null : Math.round(Number(r.avgLatencyMs)), cached: n(r.cached) })),
    },
    publication: latestVersion ? { label: latestVersion.label, kind: latestVersion.kind, status: latestVersion.status, pageCount: pdfAsset?.pageCount ?? null, createdAt: latestVersion.createdAt } : null,
    byCampus: campusRows.map((c) => ({ campusId: c.campusId, name: c.name, colour: c.colour, submissions: n(c.submissions), stories: storyCampusMap.get(c.campusId) ?? 0 })),
    byStoryType,
    timeline,
  };
}

export type EditionComparisonRow = {
  id: string;
  label: string;
  issueNumber: number;
  status: string;
  submissions: number;
  invited: number;
  responded: number;
  responseRate: number;
  stories: number;
  articlesApproved: number;
  pages: number | null;
  targetPageCount: number;
  aiCalls: number;
  aiCostCents: number;
};

/** One row per edition (all time), each metric a grouped aggregate. */
export async function editionComparison(): Promise<EditionComparisonRow[]> {
  const editions = await db.select().from(s.editions).orderBy(desc(s.editions.year), desc(s.editions.month));
  if (!editions.length) return [];
  const subRows = await db.select({ editionId: s.submissions.editionId, count: sql<number>`count(*)` }).from(s.submissions).where(ne(s.submissions.status, "DRAFT")).groupBy(s.submissions.editionId);
  const reqRows = await db.select({ editionId: s.submissionRequests.editionId, invited: sql<number>`count(*)`, responded: sql<number>`count(*) filter (where ${s.submissionRequests.status} = 'SUBMITTED')` }).from(s.submissionRequests).groupBy(s.submissionRequests.editionId);
  const storyRows = await db.select({ editionId: s.stories.editionId, count: sql<number>`count(*)` }).from(s.stories).where(inArray(s.stories.status, [...SELECTED_STORY_STATUSES])).groupBy(s.stories.editionId);
  const articleRows = await db.select({ editionId: s.articles.editionId, approved: sql<number>`count(*) filter (where ${s.articles.status} in ('APPROVED', 'LOCKED'))` }).from(s.articles).groupBy(s.articles.editionId);
  const aiRows = await db.select({ editionId: s.aiJobs.editionId, calls: sql<number>`count(*)`, costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)` }).from(s.aiJobs).groupBy(s.aiJobs.editionId);
  const pageRows = await db
    .selectDistinctOn([s.publicationVersions.editionId], { editionId: s.publicationVersions.editionId, pages: s.publicationAssets.pageCount })
    .from(s.publicationVersions)
    .innerJoin(s.publicationAssets, and(eq(s.publicationAssets.versionId, s.publicationVersions.id), eq(s.publicationAssets.kind, "PDF")))
    .where(eq(s.publicationVersions.status, "READY"))
    .orderBy(s.publicationVersions.editionId, desc(s.publicationVersions.sequence));
  const by = <T extends { editionId: string | null }>(rows: T[]) => new Map(rows.map((r) => [r.editionId ?? "", r]));
  const subs = by(subRows);
  const reqs = by(reqRows);
  const stories = by(storyRows);
  const articles = by(articleRows);
  const ai = by(aiRows);
  const pages = by(pageRows);
  return editions.map((e) => {
    const invited = n(reqs.get(e.id)?.invited);
    const responded = n(reqs.get(e.id)?.responded);
    return {
      id: e.id,
      label: e.label,
      issueNumber: e.issueNumber,
      status: e.status,
      submissions: n(subs.get(e.id)?.count),
      invited,
      responded,
      responseRate: responseRate(invited, responded),
      stories: n(stories.get(e.id)?.count),
      articlesApproved: n(articles.get(e.id)?.approved),
      pages: pages.get(e.id)?.pages ?? null,
      targetPageCount: e.targetPageCount,
      aiCalls: n(ai.get(e.id)?.calls),
      aiCostCents: n(ai.get(e.id)?.costCents),
    };
  });
}
