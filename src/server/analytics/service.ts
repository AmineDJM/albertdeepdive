/**
 * Analytics — every figure is a SQL aggregate scoped to one workspace, and inside it to one
 * edition or to all of that workspace's editions.
 *
 * "All editions" used to mean every edition on the platform. It is now every edition this
 * workspace owns, which is what the words were always taken to mean by the person reading the
 * page.
 */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { STORY_TYPES } from "@/lib/constants";
import { bucketByDay, responseRate, type DayBucket } from "./compute";
import { inOwnEditions, ownedBy, pickedEdition, type TenantScope } from "./scope";

export const SELECTED_STORY_STATUSES = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"] as const;

export type EditionOption = { id: string; label: string; issueNumber: number; status: (typeof s.editions)["$inferSelect"]["status"]; isSpecialIssue: boolean };

/** The editions this workspace may filter by — and the only ids the page will accept back. */
export async function listEditionOptions(scope: TenantScope): Promise<EditionOption[]> {
  return db
    .select({ id: s.editions.id, label: s.editions.label, issueNumber: s.editions.issueNumber, status: s.editions.status, isSpecialIssue: s.editions.isSpecialIssue })
    .from(s.editions)
    .where(ownedBy(s.editions.organizationId, scope))
    .orderBy(desc(s.editions.year), desc(s.editions.month));
}

export type CampusBreakdown = { campusId: string; name: string; colour: string | null; submissions: number; stories: number };
export type TypeBreakdown = { storyType: string; label: string; short: string; submissions: number; stories: number };
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
  publication: { label: string; kind: string; status: string; pageCount: number | null; createdAt: Date } | null;
  byCampus: CampusBreakdown[];
  byStoryType: TypeBreakdown[];
  timeline: { granularity: "day" | "edition"; points: DayBucket[] };
};

function n(value: unknown): number {
  return Number(value ?? 0);
}

export async function editionAnalytics(scope: TenantScope): Promise<EditionAnalytics> {
  const editionId = scope.editionId;
  // The id was verified against the workspace before the scope was built; the second equality here
  // is the belt to that braces, so this cannot become a way in if a future caller skips the door.
  const edition = editionId
    ? await db.query.editions.findFirst({
        where: and(eq(s.editions.id, editionId), eq(s.editions.organizationId, scope.organizationId)),
        with: { campaigns: { orderBy: [desc(s.submissionCampaigns.createdAt)], limit: 1 } },
      })
    : null;
  if (editionId && !edition) throw new Error("Edition not found");
  const campaign = edition?.campaigns[0] ?? null;
  const subScope: SQL = and(inOwnEditions(s.submissions.editionId, scope), ne(s.submissions.status, "DRAFT"))!;
  const storyScope = (col: typeof s.stories.editionId) => inOwnEditions(col, scope);

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
    .where(inOwnEditions(s.submissionRequests.editionId, scope));

  const [distribution] = await db
    .select({
      b0: sql<number>`count(*) filter (where coalesce(${s.contributors.responseRate}, 0) < 0.25)`,
      b1: sql<number>`count(*) filter (where ${s.contributors.responseRate} >= 0.25 and ${s.contributors.responseRate} < 0.5)`,
      b2: sql<number>`count(*) filter (where ${s.contributors.responseRate} >= 0.5 and ${s.contributors.responseRate} < 0.75)`,
      b3: sql<number>`count(*) filter (where ${s.contributors.responseRate} >= 0.75)`,
    })
    .from(s.contributors)
    .where(
      and(
        ownedBy(s.contributors.organizationId, scope),
        editionId
          ? sql`exists (select 1 from ${s.submissionRequests} r where r.contributor_id = ${s.contributors.id} and r.edition_id = ${editionId})`
          : sql`${s.contributors.invitationsCount} > 0`,
      ),
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
    .where(inOwnEditions(s.articles.editionId, scope));

  const [draftLatency] = await db.execute<{ hours: string | null }>(sql`
    select avg(t.hours) as hours from (
      select a.id, extract(epoch from (a.ai_drafted_at - min(sub.submitted_at))) / 3600 as hours
      from ${s.articles} a
      join ${s.articleSources} src on src.article_id = a.id
      join ${s.submissions} sub on sub.id = src.submission_id
      where a.ai_drafted_at is not null and sub.submitted_at is not null
        and a.edition_id in (select id from editions where organization_id = ${scope.organizationId})
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
    .where(and(ownedBy(s.mediaAssets.organizationId, scope), eq(s.mediaAssets.isArchived, false), pickedEdition(s.mediaAssets.editionId, scope)));

  // Without a picked edition this used to take the latest READY version anywhere on the platform,
  // and print another customer's page count on this customer's page.
  const latestVersion = await db.query.publicationVersions.findFirst({
    where: editionId
      ? and(eq(s.publicationVersions.editionId, editionId), inOwnEditions(s.publicationVersions.editionId, scope))
      : and(eq(s.publicationVersions.status, "READY"), inOwnEditions(s.publicationVersions.editionId, scope)),
    orderBy: editionId ? [desc(s.publicationVersions.sequence)] : [desc(s.publicationVersions.createdAt)],
    with: { assets: true },
  });

  const campusRows = await db
    .select({ campusId: s.campuses.id, name: s.campuses.name, colour: s.campuses.colour, submissions: sql<number>`count(distinct ${s.submissions.id})` })
    .from(s.campuses)
    .leftJoin(s.submissionCampuses, eq(s.submissionCampuses.campusId, s.campuses.id))
    .leftJoin(s.submissions, and(eq(s.submissions.id, s.submissionCampuses.submissionId), subScope))
    .where(and(ownedBy(s.campuses.organizationId, scope), eq(s.campuses.isActive, true)))
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
      .where(ownedBy(s.editions.organizationId, scope))
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
};

/** One row per edition (all time), each metric a grouped aggregate. */
export async function editionComparison(scope: TenantScope): Promise<EditionComparisonRow[]> {
  const editions = await db.select().from(s.editions).where(ownedBy(s.editions.organizationId, scope)).orderBy(desc(s.editions.year), desc(s.editions.month));
  if (!editions.length) return [];
  const mine = editions.map((e) => e.id);
  const subRows = await db.select({ editionId: s.submissions.editionId, count: sql<number>`count(*)` }).from(s.submissions).where(and(inArray(s.submissions.editionId, mine), ne(s.submissions.status, "DRAFT"))).groupBy(s.submissions.editionId);
  const reqRows = await db.select({ editionId: s.submissionRequests.editionId, invited: sql<number>`count(*)`, responded: sql<number>`count(*) filter (where ${s.submissionRequests.status} = 'SUBMITTED')` }).from(s.submissionRequests).where(inArray(s.submissionRequests.editionId, mine)).groupBy(s.submissionRequests.editionId);
  const storyRows = await db.select({ editionId: s.stories.editionId, count: sql<number>`count(*)` }).from(s.stories).where(and(inArray(s.stories.editionId, mine), inArray(s.stories.status, [...SELECTED_STORY_STATUSES]))).groupBy(s.stories.editionId);
  const articleRows = await db.select({ editionId: s.articles.editionId, approved: sql<number>`count(*) filter (where ${s.articles.status} in ('APPROVED', 'LOCKED'))` }).from(s.articles).where(inArray(s.articles.editionId, mine)).groupBy(s.articles.editionId);
  const pageRows = await db
    .selectDistinctOn([s.publicationVersions.editionId], { editionId: s.publicationVersions.editionId, pages: s.publicationAssets.pageCount })
    .from(s.publicationVersions)
    .innerJoin(s.publicationAssets, and(eq(s.publicationAssets.versionId, s.publicationVersions.id), eq(s.publicationAssets.kind, "PDF")))
    .where(and(inArray(s.publicationVersions.editionId, mine), eq(s.publicationVersions.status, "READY")))
    .orderBy(s.publicationVersions.editionId, desc(s.publicationVersions.sequence));
  const by = <T extends { editionId: string | null }>(rows: T[]) => new Map(rows.map((r) => [r.editionId ?? "", r]));
  const subs = by(subRows);
  const reqs = by(reqRows);
  const stories = by(storyRows);
  const articles = by(articleRows);
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
    };
  });
}
