/**
 * Analytics read model for /analytics.
 *
 * Everything here is a SQL aggregate scoped by an edition (or all of them) and by an activity
 * window applied to the timestamp that is natural to each metric: `submitted_at` for
 * contributions, `reviewed_at` for triage decisions, `approved_at` for articles,
 * `created_at` for AI calls. Nothing is estimated — when a figure cannot be computed it is null.
 */
import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { averageOf, bucketByDay, hoursBetween, responseRate, safeRatio, type DayBucket } from "./compute";
import { SELECTED_STORY_STATUSES } from "./service";

/** Edition + activity window every query on this screen is scoped by. */
export type AnalyticsScope = { editionId: string | null; from: Date | null; to: Date | null };

export type WindowPreset = "all" | "30d" | "90d" | "12m" | "custom";

export type ActivityWindow = { from: Date | null; to: Date | null; preset: WindowPreset; days: number | null };

const DAY_MS = 86_400_000;

function parseDay(value: string | undefined, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDayInput(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** Reads `from`/`to` (YYYY-MM-DD, inclusive) out of the URL and names the preset they match. */
export function resolveWindow(sp: { from?: string; to?: string }, now = new Date()): ActivityWindow {
  const from = parseDay(sp.from);
  const to = parseDay(sp.to, true);
  if (!from && !to) return { from: null, to: null, preset: "all", days: null };
  const days = from && to ? Math.round((to.getTime() - from.getTime()) / DAY_MS) : null;
  const endsToday = to ? Math.abs(to.getTime() - new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).getTime()) < DAY_MS : false;
  let preset: WindowPreset = "custom";
  if (endsToday && days !== null) {
    if (days === 30) preset = "30d";
    else if (days === 90) preset = "90d";
    else if (days >= 364 && days <= 366) preset = "12m";
  }
  return { from, to, preset, days };
}

function windowOn(column: SQL | Parameters<typeof gte>[0], w: { from: Date | null; to: Date | null }): SQL[] {
  const out: SQL[] = [];
  if (w.from) out.push(gte(column as never, w.from));
  if (w.to) out.push(lte(column as never, w.to));
  return out;
}

const n = (value: unknown): number => Number(value ?? 0);

// ── Contributions over time ────────────────────────────────────────────────

export type TrendPoint = { label: string; value: number; cumulative: number };
export type SubmissionTrend = { granularity: "day" | "month"; points: TrendPoint[]; total: number };

const MONTH_FMT = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

/**
 * Submissions received per day (short windows, where `bucketByDay` zero-fills the campaign) or
 * per calendar month (long windows), with a running total.
 */
export async function submissionTrend(scope: AnalyticsScope): Promise<SubmissionTrend> {
  const where: SQL[] = [ne(s.submissions.status, "DRAFT"), sql`${s.submissions.submittedAt} is not null`, ...windowOn(s.submissions.submittedAt, scope)];
  if (scope.editionId) where.push(eq(s.submissions.editionId, scope.editionId));
  const spanDays = scope.from && scope.to ? Math.round((scope.to.getTime() - scope.from.getTime()) / DAY_MS) : null;
  const daily = spanDays !== null && spanDays <= 60;

  if (daily) {
    const rows = await db
      .select({ day: sql<string>`to_char(${s.submissions.submittedAt} at time zone 'Europe/Paris', 'YYYY-MM-DD')`, count: sql<number>`count(*)` })
      .from(s.submissions)
      .where(and(...where))
      .groupBy(sql`to_char(${s.submissions.submittedAt} at time zone 'Europe/Paris', 'YYYY-MM-DD')`);
    const buckets: DayBucket[] = bucketByDay(rows.map((r) => ({ day: r.day, count: n(r.count) })), scope.from && scope.to ? { start: scope.from, end: scope.to } : null);
    return { granularity: "day", points: buckets.map((b) => ({ label: b.label, value: b.count, cumulative: b.cumulative })), total: buckets.reduce((a, b) => a + b.count, 0) };
  }

  const rows = await db
    .select({ month: sql<string>`to_char(${s.submissions.submittedAt} at time zone 'Europe/Paris', 'YYYY-MM')`, count: sql<number>`count(*)` })
    .from(s.submissions)
    .where(and(...where))
    .groupBy(sql`to_char(${s.submissions.submittedAt} at time zone 'Europe/Paris', 'YYYY-MM')`)
    .orderBy(asc(sql`to_char(${s.submissions.submittedAt} at time zone 'Europe/Paris', 'YYYY-MM')`));
  let cumulative = 0;
  const points = rows.map((r) => {
    cumulative += n(r.count);
    const [y, m] = r.month.split("-").map(Number);
    return { label: MONTH_FMT.format(new Date(Date.UTC(y, m - 1, 1))), value: n(r.count), cumulative };
  });
  return { granularity: "month", points, total: cumulative };
}

// ── Response rate per contributor pool ─────────────────────────────────────

export type PoolResponse = { groupId: string; name: string; campusName: string | null; members: number; invited: number; responded: number; responseRate: number };

/** One row per contributor group: how many of its members were asked, and how many answered. */
export async function responseRateByPool(scope: AnalyticsScope): Promise<PoolResponse[]> {
  const requestWhere: SQL[] = [...windowOn(s.submissionRequests.createdAt, scope)];
  if (scope.editionId) requestWhere.push(eq(s.submissionRequests.editionId, scope.editionId));
  const rows = await db
    .select({
      groupId: s.contributorGroups.id,
      name: s.contributorGroups.name,
      campusName: s.campuses.name,
      members: sql<number>`count(distinct ${s.contributorGroupMembers.contributorId})`,
      invited: sql<number>`count(distinct ${s.submissionRequests.id})`,
      responded: sql<number>`count(distinct ${s.submissionRequests.id}) filter (where ${s.submissionRequests.status} = 'SUBMITTED')`,
    })
    .from(s.contributorGroups)
    .leftJoin(s.contributorGroupMembers, eq(s.contributorGroupMembers.groupId, s.contributorGroups.id))
    .leftJoin(s.campuses, eq(s.campuses.id, s.contributorGroups.campusId))
    .leftJoin(s.submissionRequests, and(eq(s.submissionRequests.contributorId, s.contributorGroupMembers.contributorId), requestWhere.length ? and(...requestWhere) : undefined))
    .groupBy(s.contributorGroups.id, s.campuses.name)
    .orderBy(desc(sql`count(distinct ${s.submissionRequests.id})`), asc(s.contributorGroups.name));
  return rows.map((r) => ({
    groupId: r.groupId,
    name: r.name,
    campusName: r.campusName,
    members: n(r.members),
    invited: n(r.invited),
    responded: n(r.responded),
    responseRate: responseRate(n(r.invited), n(r.responded)),
  }));
}

// ── Story-to-article conversion ────────────────────────────────────────────

export type FunnelStep = { key: string; label: string; value: number; hint: string };
export type Conversion = { steps: FunnelStep[]; acceptedRate: number; storyRate: number; articleRate: number; approvalRate: number };

/** Submissions → accepted → clusters → selected stories → drafted articles → approved articles. */
export async function conversionFunnel(scope: AnalyticsScope): Promise<Conversion> {
  const subWhere: SQL[] = [ne(s.submissions.status, "DRAFT"), ...windowOn(s.submissions.submittedAt, scope)];
  if (scope.editionId) subWhere.push(eq(s.submissions.editionId, scope.editionId));
  const [subs] = await db
    .select({ total: sql<number>`count(*)`, accepted: sql<number>`count(*) filter (where ${s.submissions.status} = 'ACCEPTED')` })
    .from(s.submissions)
    .where(and(...subWhere));

  const clusterWhere: SQL[] = [...windowOn(s.storyClusters.createdAt, scope)];
  if (scope.editionId) clusterWhere.push(eq(s.storyClusters.editionId, scope.editionId));
  const [clusters] = await db.select({ total: sql<number>`count(*)` }).from(s.storyClusters).where(clusterWhere.length ? and(...clusterWhere) : undefined);

  const storyWhere: SQL[] = [inArray(s.stories.status, [...SELECTED_STORY_STATUSES]), ...windowOn(s.stories.createdAt, scope)];
  if (scope.editionId) storyWhere.push(eq(s.stories.editionId, scope.editionId));
  const [stories] = await db.select({ total: sql<number>`count(*)` }).from(s.stories).where(and(...storyWhere));

  const articleWhere: SQL[] = [...windowOn(s.articles.createdAt, scope)];
  if (scope.editionId) articleWhere.push(eq(s.articles.editionId, scope.editionId));
  const [articles] = await db
    .select({
      drafted: sql<number>`count(*) filter (where ${s.articles.status} <> 'EMPTY')`,
      approved: sql<number>`count(*) filter (where ${s.articles.status} in ('APPROVED', 'LOCKED'))`,
    })
    .from(s.articles)
    .where(articleWhere.length ? and(...articleWhere) : undefined);

  const total = n(subs?.total);
  const accepted = n(subs?.accepted);
  const selected = n(stories?.total);
  const drafted = n(articles?.drafted);
  const approved = n(articles?.approved);
  return {
    steps: [
      { key: "submissions", label: "Submissions", value: total, hint: "received, drafts excluded" },
      { key: "accepted", label: "Accepted", value: accepted, hint: "kept after triage" },
      { key: "clusters", label: "Clusters", value: n(clusters?.total), hint: "grouped by the AI pipeline" },
      { key: "stories", label: "Stories selected", value: selected, hint: "on the editorial plan" },
      { key: "articles", label: "Articles written", value: drafted, hint: "at least one draft" },
      { key: "approved", label: "Articles approved", value: approved, hint: "approved or locked" },
    ],
    acceptedRate: safeRatio(accepted, total),
    storyRate: safeRatio(selected, accepted),
    articleRate: safeRatio(drafted, selected),
    approvalRate: safeRatio(approved, drafted),
  };
}

// ── Section coverage over time ─────────────────────────────────────────────

export type SectionRow = { slug: string; name: string; colour: string | null; counts: Record<string, number>; total: number };
export type SectionCoverage = { editions: { id: string; label: string }[]; sections: SectionRow[]; max: number };

/** Selected stories per section and per edition — the grid behind the coverage heatmap. */
export async function sectionCoverage(scope: AnalyticsScope): Promise<SectionCoverage> {
  const editionWhere: SQL[] = [];
  if (scope.editionId) editionWhere.push(eq(s.editions.id, scope.editionId));
  const editions = await db
    .select({ id: s.editions.id, label: s.editions.label })
    .from(s.editions)
    .where(editionWhere.length ? and(...editionWhere) : undefined)
    .orderBy(asc(s.editions.year), asc(s.editions.month));
  if (!editions.length) return { editions: [], sections: [], max: 0 };
  const ids = editions.map((e) => e.id);
  const rows = await db
    .select({
      editionId: s.stories.editionId,
      slug: sql<string>`coalesce(${s.editionSections.slug}, 'unassigned')`,
      name: sql<string>`coalesce(${s.editionSections.name}, 'Unassigned')`,
      colour: sql<string | null>`max(${s.editionSections.colour})`,
      order: sql<number>`coalesce(min(${s.editionSections.sortOrder}), 999)`,
      count: sql<number>`count(*)`,
    })
    .from(s.stories)
    .leftJoin(s.editionSections, eq(s.editionSections.id, s.stories.sectionId))
    .where(and(inArray(s.stories.editionId, ids), inArray(s.stories.status, [...SELECTED_STORY_STATUSES])))
    .groupBy(s.stories.editionId, sql`coalesce(${s.editionSections.slug}, 'unassigned')`, sql`coalesce(${s.editionSections.name}, 'Unassigned')`);

  const bySlug = new Map<string, SectionRow & { order: number }>();
  let max = 0;
  for (const r of rows) {
    const existing = bySlug.get(r.slug) ?? { slug: r.slug, name: r.name, colour: r.colour, counts: {}, total: 0, order: n(r.order) };
    existing.counts[r.editionId] = n(r.count);
    existing.total += n(r.count);
    existing.order = Math.min(existing.order, n(r.order));
    max = Math.max(max, n(r.count));
    bySlug.set(r.slug, existing);
  }
  const sections: SectionRow[] = [...bySlug.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((row) => ({ slug: row.slug, name: row.name, colour: row.colour, counts: row.counts, total: row.total }));
  return { editions, sections, max };
}

// ── Triage and approval latency ────────────────────────────────────────────

export type LatencyBucket = { label: string; value: number };
export type Latency = {
  reviewed: number;
  avgSubmissionToDecisionHours: number | null;
  medianSubmissionToDecisionHours: number | null;
  fastestHours: number | null;
  slowestHours: number | null;
  buckets: LatencyBucket[];
  approvedArticles: number;
  avgDraftToApprovalHours: number | null;
};

const LATENCY_EDGES: { label: string; max: number }[] = [
  { label: "< 6h", max: 6 },
  { label: "6–24h", max: 24 },
  { label: "1–3 days", max: 72 },
  { label: "3–7 days", max: 168 },
  { label: "> 7 days", max: Number.POSITIVE_INFINITY },
];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Hours from a contributor pressing send to an editor deciding, and from AI draft to approval. */
export async function approvalLatency(scope: AnalyticsScope): Promise<Latency> {
  const subWhere: SQL[] = [
    sql`${s.submissions.submittedAt} is not null`,
    sql`${s.submissions.reviewedAt} is not null`,
    inArray(s.submissions.status, ["ACCEPTED", "REJECTED", "DUPLICATE", "MISSING_INFO"]),
    ...windowOn(s.submissions.reviewedAt, scope),
  ];
  if (scope.editionId) subWhere.push(eq(s.submissions.editionId, scope.editionId));
  const pairs = await db
    .select({ submittedAt: s.submissions.submittedAt, reviewedAt: s.submissions.reviewedAt })
    .from(s.submissions)
    .where(and(...subWhere));
  const hours = pairs
    .map((p) => (p.submittedAt && p.reviewedAt ? hoursBetween(p.submittedAt, p.reviewedAt) : null))
    .filter((h): h is number => h !== null && Number.isFinite(h) && h >= 0);

  const buckets: LatencyBucket[] = LATENCY_EDGES.map((edge, i) => {
    const min = i === 0 ? 0 : LATENCY_EDGES[i - 1].max;
    return { label: edge.label, value: hours.filter((h) => h >= min && h < edge.max).length };
  });

  const artWhere: SQL[] = [sql`${s.articles.aiDraftedAt} is not null`, sql`${s.articles.approvedAt} is not null`, ...windowOn(s.articles.approvedAt, scope)];
  if (scope.editionId) artWhere.push(eq(s.articles.editionId, scope.editionId));
  const articleRows = await db.select({ draftedAt: s.articles.aiDraftedAt, approvedAt: s.articles.approvedAt }).from(s.articles).where(and(...artWhere));
  const articleHours = articleRows
    .map((a) => (a.draftedAt && a.approvedAt ? hoursBetween(a.draftedAt, a.approvedAt) : null))
    .filter((h): h is number => h !== null && Number.isFinite(h) && h >= 0);

  return {
    reviewed: hours.length,
    avgSubmissionToDecisionHours: averageOf(hours),
    medianSubmissionToDecisionHours: median(hours),
    fastestHours: hours.length ? Math.min(...hours) : null,
    slowestHours: hours.length ? Math.max(...hours) : null,
    buckets,
    approvedArticles: articleHours.length,
    avgDraftToApprovalHours: averageOf(articleHours),
  };
}

// ── AI spend and media rights per edition ──────────────────────────────────

export type AiSpendRow = { editionId: string | null; label: string; calls: number; tokens: number; costCents: number; failed: number; cached: number; avgLatencyMs: number | null };

/** AI calls, tokens and cost grouped by edition (calls with no edition land under "Unassigned"). */
export async function aiSpendByEdition(scope: AnalyticsScope): Promise<AiSpendRow[]> {
  const where: SQL[] = [...windowOn(s.aiJobs.createdAt, scope)];
  if (scope.editionId) where.push(eq(s.aiJobs.editionId, scope.editionId));
  const rows = await db
    .select({
      editionId: s.aiJobs.editionId,
      label: s.editions.label,
      year: s.editions.year,
      month: s.editions.month,
      calls: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens}, 0) + coalesce(${s.aiJobs.outputTokens}, 0)), 0)`,
      costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)`,
      failed: sql<number>`count(*) filter (where ${s.aiJobs.status} = 'FAILED')`,
      cached: sql<number>`count(*) filter (where ${s.aiJobs.cached})`,
      avgLatencyMs: sql<number | null>`avg(${s.aiJobs.latencyMs}) filter (where ${s.aiJobs.cached} = false)`,
    })
    .from(s.aiJobs)
    .leftJoin(s.editions, eq(s.editions.id, s.aiJobs.editionId))
    .where(where.length ? and(...where) : undefined)
    .groupBy(s.aiJobs.editionId, s.editions.label, s.editions.year, s.editions.month)
    .orderBy(asc(s.editions.year), asc(s.editions.month));
  return rows.map((r) => ({
    editionId: r.editionId,
    label: r.label ?? "Unassigned",
    calls: n(r.calls),
    tokens: n(r.tokens),
    costCents: n(r.costCents),
    failed: n(r.failed),
    cached: n(r.cached),
    avgLatencyMs: r.avgLatencyMs === null ? null : Math.round(Number(r.avgLatencyMs)),
  }));
}

export type RightsRow = { editionId: string | null; label: string; green: number; yellow: number; red: number; total: number };

/** Media rights split per edition — what can be printed, what still needs clearing. */
export async function rightsByEdition(scope: AnalyticsScope): Promise<RightsRow[]> {
  const where: SQL[] = [eq(s.mediaAssets.isArchived, false), ...windowOn(s.mediaAssets.createdAt, scope)];
  if (scope.editionId) where.push(eq(s.mediaAssets.editionId, scope.editionId));
  const rows = await db
    .select({
      editionId: s.mediaAssets.editionId,
      label: s.editions.label,
      year: s.editions.year,
      month: s.editions.month,
      green: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'GREEN')`,
      yellow: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'YELLOW')`,
      red: sql<number>`count(*) filter (where ${s.mediaAssets.rightsStatus} = 'RED')`,
      total: sql<number>`count(*)`,
    })
    .from(s.mediaAssets)
    .leftJoin(s.editions, eq(s.editions.id, s.mediaAssets.editionId))
    .where(and(...where))
    .groupBy(s.mediaAssets.editionId, s.editions.label, s.editions.year, s.editions.month)
    .orderBy(asc(s.editions.year), asc(s.editions.month));
  return rows.map((r) => ({ editionId: r.editionId, label: r.label ?? "Unassigned", green: n(r.green), yellow: n(r.yellow), red: n(r.red), total: n(r.total) }));
}

// ── Contributions per campus, per edition ──────────────────────────────────

export type CampusEditionRow = { campusId: string; name: string; colour: string | null; submissions: number; stories: number; contributors: number };

/** Submissions and selected stories per campus, inside the window. */
export async function contributionsByCampus(scope: AnalyticsScope): Promise<CampusEditionRow[]> {
  const subWhere: SQL[] = [ne(s.submissions.status, "DRAFT"), ...windowOn(s.submissions.submittedAt, scope)];
  if (scope.editionId) subWhere.push(eq(s.submissions.editionId, scope.editionId));
  const rows = await db
    .select({
      campusId: s.campuses.id,
      name: s.campuses.name,
      colour: s.campuses.colour,
      sortOrder: s.campuses.sortOrder,
      submissions: sql<number>`count(distinct ${s.submissions.id})`,
      contributors: sql<number>`count(distinct ${s.submissions.contributorId})`,
    })
    .from(s.campuses)
    .leftJoin(s.submissionCampuses, eq(s.submissionCampuses.campusId, s.campuses.id))
    .leftJoin(s.submissions, and(eq(s.submissions.id, s.submissionCampuses.submissionId), and(...subWhere)))
    .where(eq(s.campuses.isActive, true))
    .groupBy(s.campuses.id)
    .orderBy(asc(s.campuses.sortOrder));

  const storyWhere: SQL[] = [inArray(s.stories.status, [...SELECTED_STORY_STATUSES]), ...windowOn(s.stories.createdAt, scope)];
  if (scope.editionId) storyWhere.push(eq(s.stories.editionId, scope.editionId));
  const storyRows = await db
    .select({ campusId: s.storyCampuses.campusId, stories: sql<number>`count(distinct ${s.stories.id})` })
    .from(s.storyCampuses)
    .innerJoin(s.stories, eq(s.stories.id, s.storyCampuses.storyId))
    .where(and(...storyWhere))
    .groupBy(s.storyCampuses.campusId);
  const storyMap = new Map(storyRows.map((r) => [r.campusId, n(r.stories)]));
  return rows.map((r) => ({ campusId: r.campusId, name: r.name, colour: r.colour, submissions: n(r.submissions), contributors: n(r.contributors), stories: storyMap.get(r.campusId) ?? 0 }));
}

// ── Most active contributors ───────────────────────────────────────────────

export type TopContributor = { contributorId: string; name: string; email: string; campusName: string | null; campusColour: string | null; submissions: number; accepted: number; stories: number; lastAt: Date | null };

/** The people the newsroom actually runs on, inside the window. */
export async function mostActiveContributors(scope: AnalyticsScope, limit = 10): Promise<TopContributor[]> {
  const where: SQL[] = [ne(s.submissions.status, "DRAFT"), ...windowOn(s.submissions.submittedAt, scope)];
  if (scope.editionId) where.push(eq(s.submissions.editionId, scope.editionId));
  const rows = await db
    .select({
      contributorId: s.contributors.id,
      name: sql<string>`${s.contributors.firstName} || ' ' || ${s.contributors.lastName}`,
      email: s.contributors.email,
      campusName: s.campuses.name,
      campusColour: s.campuses.colour,
      submissions: sql<number>`count(distinct ${s.submissions.id})`,
      accepted: sql<number>`count(distinct ${s.submissions.id}) filter (where ${s.submissions.status} = 'ACCEPTED')`,
      stories: sql<number>`count(distinct ${s.storyClusterMembers.clusterId})`,
      lastAt: sql<Date | null>`max(${s.submissions.submittedAt})`,
    })
    .from(s.submissions)
    .innerJoin(s.contributors, eq(s.contributors.id, s.submissions.contributorId))
    .leftJoin(s.campuses, eq(s.campuses.id, s.contributors.campusId))
    .leftJoin(s.storyClusterMembers, eq(s.storyClusterMembers.submissionId, s.submissions.id))
    .where(and(...where))
    .groupBy(s.contributors.id, s.campuses.name, s.campuses.colour)
    .orderBy(desc(sql`count(distinct ${s.submissions.id})`), asc(s.contributors.lastName))
    .limit(limit);
  return rows.map((r) => ({ ...r, submissions: n(r.submissions), accepted: n(r.accepted), stories: n(r.stories), lastAt: r.lastAt ? new Date(r.lastAt) : null }));
}

export type AiServiceRow = { service: string; calls: number; tokens: number; costCents: number; avgLatencyMs: number | null };

/** AI calls, tokens and cost grouped by pipeline service, inside the window. */
export async function aiSpendByService(scope: AnalyticsScope): Promise<AiServiceRow[]> {
  const where: SQL[] = [...windowOn(s.aiJobs.createdAt, scope)];
  if (scope.editionId) where.push(eq(s.aiJobs.editionId, scope.editionId));
  const rows = await db
    .select({
      service: s.aiJobs.service,
      calls: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens}, 0) + coalesce(${s.aiJobs.outputTokens}, 0)), 0)`,
      costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)`,
      avgLatencyMs: sql<number | null>`avg(${s.aiJobs.latencyMs}) filter (where ${s.aiJobs.cached} = false)`,
    })
    .from(s.aiJobs)
    .where(where.length ? and(...where) : undefined)
    .groupBy(s.aiJobs.service)
    .orderBy(desc(sql`coalesce(sum(${s.aiJobs.costCents}), 0)`));
  return rows.map((r) => ({ service: r.service, calls: n(r.calls), tokens: n(r.tokens), costCents: n(r.costCents), avgLatencyMs: r.avgLatencyMs === null ? null : Math.round(Number(r.avgLatencyMs)) }));
}

export type AiModelRow = { model: string; provider: string; calls: number; tokens: number; costCents: number; avgLatencyMs: number | null; cached: number };

/** AI calls grouped by model, inside the window — what the newsroom actually paid for. */
export async function aiSpendByModel(scope: AnalyticsScope): Promise<AiModelRow[]> {
  const where: SQL[] = [...windowOn(s.aiJobs.createdAt, scope)];
  if (scope.editionId) where.push(eq(s.aiJobs.editionId, scope.editionId));
  const rows = await db
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
    .where(where.length ? and(...where) : undefined)
    .groupBy(s.aiJobs.model, s.aiJobs.provider)
    .orderBy(desc(sql`coalesce(sum(${s.aiJobs.costCents}), 0)`));
  return rows.map((r) => ({ model: r.model, provider: r.provider, calls: n(r.calls), tokens: n(r.tokens), costCents: n(r.costCents), avgLatencyMs: r.avgLatencyMs === null ? null : Math.round(Number(r.avgLatencyMs)), cached: n(r.cached) }));
}
