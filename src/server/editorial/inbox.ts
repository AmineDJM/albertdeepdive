import { and, asc, count, desc, eq, exists, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NotFoundError } from "@/lib/action-result";
import { mediaUrls } from "@/server/media/urls";
import { listComments } from "./comments";

/**
 * Read model for the triage inbox: the submissions of an edition with the facets, filters and
 * per-row context (contributor, campuses, media thumbnails, cluster, warnings) the screen needs.
 */

export type InboxFilter = {
  q?: string;
  /** Saved views: new | needs_review | missing_info | duplicate | potential | accepted | rejected | all */
  view?: string;
  status?: string;
  campusId?: string;
  storyType?: string;
  contributorId?: string;
  clusterId?: string;
  hasMedia?: "true" | "false" | string;
  flagged?: "true" | string;
  sort?: "newest" | "oldest" | "importance" | "type" | string;
  page?: number | string;
  pageSize?: number | string;
};

const VIEW_STATUSES: Record<string, readonly (typeof s.submissionStatusEnum.enumValues)[number][]> = {
  new: ["NEW"],
  needs_review: ["NEW", "NEEDS_REVIEW"],
  missing_info: ["MISSING_INFO"],
  duplicate: ["DUPLICATE"],
  potential: ["POTENTIAL_STORY"],
  accepted: ["ACCEPTED"],
  rejected: ["REJECTED", "ARCHIVED"],
};

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

function buildConditions(editionId: string, f: InboxFilter) {
  const conditions = [eq(s.submissions.editionId, editionId), ne(s.submissions.status, "DRAFT" as const)];
  const viewStatuses = f.view && f.view !== "all" ? VIEW_STATUSES[f.view] : undefined;
  if (f.status && f.status !== "all") conditions.push(eq(s.submissions.status, f.status as (typeof s.submissionStatusEnum.enumValues)[number]));
  else if (viewStatuses) conditions.push(inArray(s.submissions.status, [...viewStatuses]));
  if (f.storyType && f.storyType !== "all") conditions.push(eq(s.submissions.storyType, f.storyType as (typeof s.submissionTypeEnum.enumValues)[number]));
  if (f.contributorId) conditions.push(eq(s.submissions.contributorId, f.contributorId));
  if (f.clusterId) conditions.push(eq(s.submissions.suggestedClusterId, f.clusterId));
  if (f.q) {
    const like = `%${f.q}%`;
    conditions.push(or(ilike(s.submissions.title, like), ilike(s.submissions.description, like), ilike(s.submissions.peopleInvolved, like), ilike(s.submissions.organisationsInvolved, like))!);
  }
  if (f.campusId) {
    conditions.push(
      f.campusId === "school"
        ? eq(s.submissions.campusScope, "SCHOOL_WIDE")
        : exists(db.select({ one: sql`1` }).from(s.submissionCampuses).where(and(eq(s.submissionCampuses.submissionId, s.submissions.id), eq(s.submissionCampuses.campusId, f.campusId)))),
    );
  }
  if (f.hasMedia === "true") conditions.push(exists(db.select({ one: sql`1` }).from(s.mediaAssets).where(and(eq(s.mediaAssets.submissionId, s.submissions.id), eq(s.mediaAssets.isArchived, false)))));
  if (f.hasMedia === "false") conditions.push(sql`not exists (select 1 from ${s.mediaAssets} ma where ma.submission_id = ${s.submissions.id} and ma.is_archived = false)`);
  if (f.flagged === "true") conditions.push(sql`jsonb_array_length(${s.submissions.aiWarnings}) > 0`);
  return and(...conditions);
}

export type InboxRow = Awaited<ReturnType<typeof listInbox>>["rows"][number];

export async function listInbox(editionId: string, filters: InboxFilter = {}) {
  const page = clampInt(filters.page, 1, 1, 10_000);
  const pageSize = clampInt(filters.pageSize, 40, 5, 200);
  const where = buildConditions(editionId, filters);

  const orderBy = (() => {
    switch (filters.sort) {
      case "oldest":
        return [asc(s.submissions.createdAt)];
      case "importance":
        return [desc(sql`coalesce(${s.submissions.aiImportance}, 0)`), desc(s.submissions.createdAt)];
      case "type":
        return [asc(s.submissions.storyType), desc(s.submissions.createdAt)];
      default:
        return [desc(s.submissions.createdAt)];
    }
  })();

  const [rowsRaw, [{ total }]] = await Promise.all([
    db.query.submissions.findMany({
      where,
      orderBy,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      with: {
        contributor: { columns: { id: true, firstName: true, lastName: true, email: true, type: true } },
        campuses: { with: { campus: { columns: { id: true, name: true, slug: true, colour: true } } } },
      },
    }),
    db.select({ total: count() }).from(s.submissions).where(where),
  ]);

  const ids = rowsRaw.map((r) => r.id);
  const [assets, clusters, requests] = await Promise.all([
    ids.length ? db.select({ id: s.mediaAssets.id, submissionId: s.mediaAssets.submissionId, kind: s.mediaAssets.kind, rightsStatus: s.mediaAssets.rightsStatus }).from(s.mediaAssets).where(and(inArray(s.mediaAssets.submissionId, ids), eq(s.mediaAssets.isArchived, false))) : [],
    db.select({ id: s.storyClusters.id, title: s.storyClusters.title, status: s.storyClusters.status }).from(s.storyClusters).where(eq(s.storyClusters.editionId, editionId)),
    ids.length ? db.select({ submissionId: s.informationRequests.submissionId, status: s.informationRequests.status }).from(s.informationRequests).where(inArray(s.informationRequests.submissionId, ids)) : [],
  ]);
  const thumbs = await mediaUrls(assets.map((a) => a.id), "THUMBNAIL");
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const assetsBySubmission = new Map<string, typeof assets>();
  for (const a of assets) assetsBySubmission.set(a.submissionId!, [...(assetsBySubmission.get(a.submissionId!) ?? []), a]);
  const pendingRequestIds = new Set(requests.filter((r) => r.status === "PENDING" || r.status === "SENT").map((r) => r.submissionId));

  const rows = rowsRaw.map((row) => {
    const media = assetsBySubmission.get(row.id) ?? [];
    return {
      ...row,
      contributorName: row.contributor ? `${row.contributor.firstName} ${row.contributor.lastName}` : "Unknown",
      campusList: row.campuses.map((c) => c.campus),
      mediaCount: media.length,
      thumbnails: media.slice(0, 3).map((m) => ({ id: m.id, url: thumbs[m.id] ?? null, rightsStatus: m.rightsStatus })),
      cluster: row.suggestedClusterId ? (clusterById.get(row.suggestedClusterId) ?? null) : null,
      awaitingInformation: pendingRequestIds.has(row.id),
      errorCount: row.aiWarnings.filter((w) => w.severity === "error").length,
      warningCount: row.aiWarnings.filter((w) => w.severity === "warning").length,
    };
  });

  return { rows, total: Number(total), page, pageSize, pages: Math.max(1, Math.ceil(Number(total) / pageSize)) };
}

/** Counts for the saved views, computed in one pass over the edition. */
export async function inboxFacets(editionId: string) {
  const [row] = await db
    .select({
      total: count(),
      unprocessed: sql<number>`count(*) filter (where ${s.submissions.processedAt} is null)`,
      newCount: sql<number>`count(*) filter (where ${s.submissions.status} = 'NEW')`,
      needsReview: sql<number>`count(*) filter (where ${s.submissions.status} in ('NEW','NEEDS_REVIEW'))`,
      missingInfo: sql<number>`count(*) filter (where ${s.submissions.status} = 'MISSING_INFO')`,
      duplicate: sql<number>`count(*) filter (where ${s.submissions.status} = 'DUPLICATE')`,
      potential: sql<number>`count(*) filter (where ${s.submissions.status} = 'POTENTIAL_STORY')`,
      accepted: sql<number>`count(*) filter (where ${s.submissions.status} = 'ACCEPTED')`,
      rejected: sql<number>`count(*) filter (where ${s.submissions.status} in ('REJECTED','ARCHIVED'))`,
      flagged: sql<number>`count(*) filter (where jsonb_array_length(${s.submissions.aiWarnings}) > 0)`,
      withoutMedia: sql<number>`count(*) filter (where not exists (select 1 from media_assets ma where ma.submission_id = ${s.submissions.id} and ma.is_archived = false))`,
    })
    .from(s.submissions)
    .where(and(eq(s.submissions.editionId, editionId), ne(s.submissions.status, "DRAFT")));
  const byType = await db
    .select({ storyType: s.submissions.storyType, n: count() })
    .from(s.submissions)
    .where(and(eq(s.submissions.editionId, editionId), ne(s.submissions.status, "DRAFT")))
    .groupBy(s.submissions.storyType)
    .orderBy(desc(count()));
  return {
    total: Number(row.total),
    unprocessed: Number(row.unprocessed),
    new: Number(row.newCount),
    needsReview: Number(row.needsReview),
    missingInfo: Number(row.missingInfo),
    duplicate: Number(row.duplicate),
    potential: Number(row.potential),
    accepted: Number(row.accepted),
    rejected: Number(row.rejected),
    flagged: Number(row.flagged),
    withoutMedia: Number(row.withoutMedia),
    byType: byType.map((t) => ({ storyType: t.storyType, count: Number(t.n) })),
  };
}

/** Everything the submission detail panel shows, including its provenance downstream. */
export async function submissionDetail(submissionId: string) {
  const row = await db.query.submissions.findFirst({
    where: eq(s.submissions.id, submissionId),
    with: {
      contributor: true,
      campuses: { with: { campus: true } },
      attachments: { orderBy: [asc(s.submissionAttachments.sortOrder)] },
      mediaAssets: true,
      edition: { columns: { id: true, label: true, title: true, status: true } },
      request: { columns: { id: true, status: true, sentAt: true, submittedAt: true } },
    },
  });
  if (!row) throw new NotFoundError("Submission");

  const [cluster, duplicateOf, derivedStories, urls, comments, infoRequests] = await Promise.all([
    row.suggestedClusterId ? db.query.storyClusters.findFirst({ where: eq(s.storyClusters.id, row.suggestedClusterId), columns: { id: true, title: true, status: true, submissionCount: true } }) : null,
    row.duplicateOfId ? db.query.submissions.findFirst({ where: eq(s.submissions.id, row.duplicateOfId), columns: { id: true, title: true, status: true } }) : null,
    db
      .select({ id: s.stories.id, title: s.stories.title, status: s.stories.status, slug: s.stories.slug })
      .from(s.stories)
      .innerJoin(s.storyClusters, eq(s.stories.clusterId, s.storyClusters.id))
      .innerJoin(s.storyClusterMembers, eq(s.storyClusterMembers.clusterId, s.storyClusters.id))
      .where(eq(s.storyClusterMembers.submissionId, submissionId)),
    Promise.resolve(row.urls),
    listComments("SUBMISSION", submissionId),
    db.query.informationRequests.findMany({ where: eq(s.informationRequests.submissionId, submissionId), orderBy: [desc(s.informationRequests.createdAt)] }),
  ]);

  const thumbs = await mediaUrls(row.mediaAssets.map((m) => m.id), "WEB");
  return {
    submission: row,
    contributorName: row.contributor ? `${row.contributor.firstName} ${row.contributor.lastName}` : "Unknown",
    campusList: row.campuses.map((c) => c.campus),
    media: row.mediaAssets.map((m) => ({ ...m, url: thumbs[m.id] ?? null })),
    cluster: cluster ?? null,
    duplicateOf: duplicateOf ?? null,
    stories: derivedStories,
    urls,
    comments: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, userName: c.user?.name ?? null })),
    infoRequests,
  };
}

/** Submissions that are not in any cluster yet (used by the "organise" step of the control room). */
export async function unclusteredCount(editionId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(s.submissions)
    .where(
      and(
        eq(s.submissions.editionId, editionId),
        inArray(s.submissions.status, ["NEW", "NEEDS_REVIEW", "POTENTIAL_STORY", "ACCEPTED", "MISSING_INFO"]),
        isNull(s.submissions.suggestedClusterId),
      ),
    );
  return Number(row.n);
}
