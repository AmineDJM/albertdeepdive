import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { mediaUrls } from "@/server/media/urls";

/**
 * Content: what the organisation has to say, across every edition being made.
 *
 * A story is shown by the one state that matters to a person deciding what to do with it: ready,
 * needs review, missing information, used. The states are read from what the pipeline already
 * recorded — warnings, unresolved missing information, the article's approval — never from a new
 * flag somebody has to maintain. Nothing here names a cluster, a score or a model.
 */

export const CONTENT_STATES = ["ready", "needs_review", "missing", "used"] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

export type ContentStory = {
  id: string;
  editionId: string;
  editionLabel: string;
  title: string;
  summary: string | null;
  storyType: string;
  status: string;
  state: ContentState;
  sources: number;
  campuses: { id: string; name: string; colour: string | null }[];
  section: { id: string; name: string; colour: string | null } | null;
  heroUrl: string | null;
  missing: string[];
  warnings: string[];
  eventDate: Date | null;
  updatedAt: Date;
};

export type ContentFilter = { state?: string; q?: string; editionId?: string; storyType?: string };

const LIVE: (typeof s.editionStatusEnum.enumValues)[number][] = ["UPCOMING", "OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD", "CLOSED", "PROCESSING", "EDITORIAL_REVIEW", "LAYOUT", "FINAL_REVIEW", "PUBLISHED"];

function stateOf(row: { status: string; warnings: { message: string }[]; missingInformation: { resolved?: boolean }[]; article: { status: string } | null }): ContentState {
  const missing = row.missingInformation.filter((m) => !m.resolved);
  if (row.status === "PUBLISHED" || row.article?.status === "APPROVED" || row.article?.status === "LOCKED") return "used";
  if (missing.length) return "missing";
  if (row.status === "CANDIDATE" || row.warnings.length) return "needs_review";
  return "ready";
}

export async function listContentStories(organizationId: string, f: ContentFilter = {}): Promise<{ rows: ContentStory[]; facets: Record<ContentState | "total", number> }> {
  const conditions = [eq(s.editions.organizationId, organizationId), isNull(s.editions.hiddenAt), inArray(s.editions.status, LIVE), ne(s.stories.status, "REJECTED"), ne(s.stories.status, "DROPPED")];
  if (f.editionId) conditions.push(eq(s.stories.editionId, f.editionId));
  if (f.storyType && f.storyType !== "all") conditions.push(eq(s.stories.storyType, f.storyType as (typeof s.submissionTypeEnum.enumValues)[number]));
  if (f.q) conditions.push(or(ilike(s.stories.title, `%${f.q}%`), ilike(s.stories.summary, `%${f.q}%`))!);

  const ids = await db
    .select({ id: s.stories.id })
    .from(s.stories)
    .innerJoin(s.editions, eq(s.editions.id, s.stories.editionId))
    .where(and(...conditions))
    .orderBy(desc(s.stories.updatedAt))
    .limit(400);
  if (!ids.length) return { rows: [], facets: { total: 0, ready: 0, needs_review: 0, missing: 0, used: 0 } };

  const rows = await db.query.stories.findMany({
    where: inArray(s.stories.id, ids.map((row) => row.id)),
    orderBy: [desc(s.stories.updatedAt)],
    with: {
      edition: { columns: { id: true, label: true } },
      section: { columns: { id: true, name: true, colour: true } },
      campuses: { with: { campus: { columns: { id: true, name: true, colour: true } } } },
      article: { columns: { id: true, status: true } },
      media: { columns: { mediaAssetId: true, role: true, sortOrder: true }, orderBy: [asc(s.storyMedia.sortOrder)] },
      cluster: { columns: { id: true, submissionCount: true } },
    },
  });
  const heroIds = rows.map((r) => r.media.find((m) => m.role === "hero")?.mediaAssetId ?? r.media[0]?.mediaAssetId).filter((id): id is string => Boolean(id));
  const thumbs = await mediaUrls(heroIds, "THUMBNAIL");

  const all: ContentStory[] = rows.map((row) => {
    const heroId = row.media.find((m) => m.role === "hero")?.mediaAssetId ?? row.media[0]?.mediaAssetId ?? null;
    return {
      id: row.id,
      editionId: row.editionId,
      editionLabel: row.edition.label,
      title: row.title,
      summary: row.summary,
      storyType: row.storyType,
      status: row.status,
      state: stateOf(row),
      sources: row.cluster?.submissionCount ?? 0,
      campuses: row.campuses.map((c) => c.campus),
      section: row.section,
      heroUrl: heroId ? (thumbs[heroId] ?? null) : null,
      missing: row.missingInformation.filter((m) => !m.resolved).map((m) => m.label),
      warnings: row.warnings.map((w) => w.message),
      eventDate: row.eventDate,
      updatedAt: row.updatedAt,
    };
  });
  const facets = { total: all.length, ready: 0, needs_review: 0, missing: 0, used: 0 } as Record<ContentState | "total", number>;
  for (const story of all) facets[story.state] += 1;
  const wanted = f.state && (CONTENT_STATES as readonly string[]).includes(f.state) ? (f.state as ContentState) : null;
  const order: Record<ContentState, number> = { needs_review: 0, missing: 1, ready: 2, used: 3 };
  return { rows: (wanted ? all.filter((story) => story.state === wanted) : all).sort((a, b) => order[a.state] - order[b.state] || b.updatedAt.getTime() - a.updatedAt.getTime()), facets };
}

export type Contribution = {
  id: string;
  editionId: string;
  editionLabel: string;
  title: string;
  description: string | null;
  status: string;
  storyType: string;
  contributorName: string;
  campuses: { id: string; name: string; colour: string | null }[];
  mediaCount: number;
  submittedAt: Date | null;
  createdAt: Date;
};

export type ContributionFilter = { view?: string; q?: string; editionId?: string };

const VIEWS: Record<string, readonly (typeof s.submissionStatusEnum.enumValues)[number][]> = {
  needs_review: ["NEW", "NEEDS_REVIEW"],
  missing_info: ["MISSING_INFO"],
  accepted: ["ACCEPTED", "POTENTIAL_STORY"],
  rejected: ["REJECTED", "DUPLICATE", "ARCHIVED"],
};

/** What people sent in, across the editions being made. */
export async function listContributions(organizationId: string, f: ContributionFilter = {}): Promise<{ rows: Contribution[]; facets: Record<string, number> }> {
  const base = [eq(s.editions.organizationId, organizationId), isNull(s.editions.hiddenAt), ne(s.submissions.status, "DRAFT" as const)];
  if (f.editionId) base.push(eq(s.submissions.editionId, f.editionId));
  if (f.q) {
    const like = `%${f.q}%`;
    base.push(or(ilike(s.submissions.title, like), ilike(s.submissions.description, like))!);
  }
  const statuses = f.view && f.view !== "all" ? VIEWS[f.view] : undefined;
  const conditions = statuses ? [...base, inArray(s.submissions.status, [...statuses])] : base;

  const [facetRow, rowsRaw] = await Promise.all([
    db
      .select({
        total: count(),
        needs_review: sql<number>`count(*) filter (where ${s.submissions.status} in ('NEW','NEEDS_REVIEW'))`,
        missing_info: sql<number>`count(*) filter (where ${s.submissions.status} = 'MISSING_INFO')`,
        accepted: sql<number>`count(*) filter (where ${s.submissions.status} in ('ACCEPTED','POTENTIAL_STORY'))`,
        rejected: sql<number>`count(*) filter (where ${s.submissions.status} in ('REJECTED','DUPLICATE','ARCHIVED'))`,
      })
      .from(s.submissions)
      .innerJoin(s.editions, eq(s.editions.id, s.submissions.editionId))
      .where(and(...base)),
    db
      .select({ id: s.submissions.id })
      .from(s.submissions)
      .innerJoin(s.editions, eq(s.editions.id, s.submissions.editionId))
      .where(and(...conditions))
      .orderBy(desc(s.submissions.createdAt))
      .limit(200),
  ]);
  const facets = Object.fromEntries(Object.entries(facetRow[0] ?? {}).map(([key, value]) => [key, Number(value)]));
  if (!rowsRaw.length) return { rows: [], facets };
  const rows = await db.query.submissions.findMany({
    where: inArray(s.submissions.id, rowsRaw.map((row) => row.id)),
    orderBy: [desc(s.submissions.createdAt)],
    with: {
      edition: { columns: { id: true, label: true } },
      contributor: { columns: { firstName: true, lastName: true } },
      campuses: { with: { campus: { columns: { id: true, name: true, colour: true } } } },
    },
  });
  const media = await db
    .select({ submissionId: s.mediaAssets.submissionId, n: count() })
    .from(s.mediaAssets)
    .where(and(inArray(s.mediaAssets.submissionId, rows.map((row) => row.id)), eq(s.mediaAssets.isArchived, false)))
    .groupBy(s.mediaAssets.submissionId);
  const mediaCount = new Map(media.map((row) => [row.submissionId, Number(row.n)]));
  return {
    rows: rows.map((row) => ({
      id: row.id,
      editionId: row.editionId,
      editionLabel: row.edition.label,
      title: row.title,
      description: row.description,
      status: row.status,
      storyType: row.storyType,
      contributorName: row.contributor ? `${row.contributor.firstName} ${row.contributor.lastName}` : "Unknown",
      campuses: row.campuses.map((c) => c.campus),
      mediaCount: mediaCount.get(row.id) ?? 0,
      submittedAt: row.submittedAt,
      createdAt: row.createdAt,
    })),
    facets,
  };
}

/** The editions a person can file content against, newest first. */
export async function contentEditions(organizationId: string) {
  return db.query.editions.findMany({ where: and(eq(s.editions.organizationId, organizationId), isNull(s.editions.hiddenAt), inArray(s.editions.status, LIVE)), orderBy: [desc(s.editions.year), desc(s.editions.month)], columns: { id: true, label: true, status: true } });
}
