import { and, asc, count, desc, eq, exists, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { mediaUrls } from "@/server/media/urls";

/** Read model for the stories board: selection, scores, flags and section assignment. */

export type StoryFilter = {
  q?: string;
  status?: string;
  sectionId?: string;
  campusId?: string;
  storyType?: string;
  flag?: "needs_attention" | "conflicts" | "no_media" | "unassigned" | string;
  sort?: "score" | "priority" | "recent" | "title" | string;
  cluster?: string;
};

const SELECTED = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"] as const;

export async function listStories(editionId: string, f: StoryFilter = {}) {
  const conditions = [eq(s.stories.editionId, editionId)];
  if (f.status && f.status !== "all") {
    if (f.status === "selected") conditions.push(inArray(s.stories.status, [...SELECTED]));
    else conditions.push(eq(s.stories.status, f.status as (typeof s.storyStatusEnum.enumValues)[number]));
  }
  if (f.sectionId) conditions.push(f.sectionId === "none" ? isNull(s.stories.sectionId) : eq(s.stories.sectionId, f.sectionId));
  if (f.storyType && f.storyType !== "all") conditions.push(eq(s.stories.storyType, f.storyType as (typeof s.submissionTypeEnum.enumValues)[number]));
  if (f.q) conditions.push(or(ilike(s.stories.title, `%${f.q}%`), ilike(s.stories.summary, `%${f.q}%`))!);
  if (f.campusId) {
    conditions.push(
      f.campusId === "school"
        ? sql`not exists (select 1 from ${s.storyCampuses} sc where sc.story_id = ${s.stories.id})`
        : exists(db.select({ one: sql`1` }).from(s.storyCampuses).where(and(eq(s.storyCampuses.storyId, s.stories.id), eq(s.storyCampuses.campusId, f.campusId)))),
    );
  }
  if (f.cluster) conditions.push(eq(s.stories.clusterId, f.cluster));
  if (f.flag === "needs_attention") {
    conditions.push(sql`(jsonb_array_length(${s.stories.warnings}) > 0 or exists (select 1 from jsonb_array_elements(${s.stories.missingInformation}) m where coalesce((m->>'resolved')::boolean, false) = false))`);
  }
  if (f.flag === "conflicts") conditions.push(exists(db.select({ one: sql`1` }).from(s.facts).where(and(eq(s.facts.storyId, s.stories.id), eq(s.facts.status, "DISPUTED")))));
  if (f.flag === "no_media") conditions.push(sql`not exists (select 1 from ${s.storyMedia} sm where sm.story_id = ${s.stories.id})`);
  if (f.flag === "unassigned") conditions.push(isNull(s.stories.sectionId));

  const orderBy = (() => {
    switch (f.sort) {
      case "priority":
        return [desc(s.stories.priority), desc(s.stories.updatedAt)];
      case "recent":
        return [desc(s.stories.updatedAt)];
      case "title":
        return [asc(s.stories.title)];
      default:
        return [sql`coalesce(${s.stories.editorialScore}, 0) desc`, desc(s.stories.priority)];
    }
  })();

  const rows = await db.query.stories.findMany({
    where: and(...conditions),
    orderBy,
    with: {
      section: { columns: { id: true, name: true, slug: true, colour: true } },
      campuses: { with: { campus: { columns: { id: true, name: true, colour: true } } } },
      article: { columns: { id: true, status: true, headline: true, wordCount: true, standfirst: true } },
      media: { columns: { mediaAssetId: true, role: true, sortOrder: true }, orderBy: [asc(s.storyMedia.sortOrder)] },
      cluster: { columns: { id: true, title: true, submissionCount: true, status: true } },
      assignedTo: { columns: { id: true, name: true } },
    },
    limit: 300,
  });

  const heroIds = rows.map((r) => r.media.find((m) => m.role === "hero")?.mediaAssetId ?? r.media[0]?.mediaAssetId).filter((id): id is string => !!id);
  const [thumbs, disputed] = await Promise.all([
    mediaUrls(heroIds, "THUMBNAIL"),
    db.select({ storyId: s.facts.storyId, n: count() }).from(s.facts).where(and(eq(s.facts.editionId, editionId), eq(s.facts.status, "DISPUTED"))).groupBy(s.facts.storyId),
  ]);
  const disputedByStory = new Map(disputed.map((d) => [d.storyId, Number(d.n)]));

  return rows.map((row) => {
    const heroId = row.media.find((m) => m.role === "hero")?.mediaAssetId ?? row.media[0]?.mediaAssetId ?? null;
    const missing = row.missingInformation.filter((m) => !m.resolved);
    return {
      ...row,
      heroUrl: heroId ? (thumbs[heroId] ?? null) : null,
      mediaCount: row.media.length,
      disputedFacts: disputedByStory.get(row.id) ?? 0,
      openMissingInformation: missing,
      campusList: row.campuses.map((c) => c.campus),
      isSelected: (SELECTED as readonly string[]).includes(row.status),
    };
  });
}

export type StoryListRow = Awaited<ReturnType<typeof listStories>>[number];

export async function storyBoardFacets(editionId: string) {
  const [row] = await db
    .select({
      total: count(),
      candidates: sql<number>`count(*) filter (where ${s.stories.status} = 'CANDIDATE')`,
      selected: sql<number>`count(*) filter (where ${s.stories.status} in ('SELECTED','DRAFTING','IN_REVIEW','APPROVED','PUBLISHED'))`,
      approved: sql<number>`count(*) filter (where ${s.stories.status} in ('APPROVED','PUBLISHED'))`,
      rejected: sql<number>`count(*) filter (where ${s.stories.status} in ('REJECTED','DROPPED'))`,
      unassigned: sql<number>`count(*) filter (where ${s.stories.sectionId} is null)`,
      flagged: sql<number>`count(*) filter (where jsonb_array_length(${s.stories.warnings}) > 0 or exists (select 1 from jsonb_array_elements(${s.stories.missingInformation}) m where coalesce((m->>'resolved')::boolean, false) = false))`,
    })
    .from(s.stories)
    .where(eq(s.stories.editionId, editionId));
  const [conflicts] = await db.select({ n: sql<number>`count(distinct ${s.facts.storyId})` }).from(s.facts).where(and(eq(s.facts.editionId, editionId), eq(s.facts.status, "DISPUTED")));
  return {
    total: Number(row.total),
    candidates: Number(row.candidates),
    selected: Number(row.selected),
    approved: Number(row.approved),
    rejected: Number(row.rejected),
    unassigned: Number(row.unassigned),
    flagged: Number(row.flagged),
    conflicts: Number(conflicts.n),
  };
}

/** Clusters that have not become stories yet, for the "organise" panel. */
export async function pendingClusters(editionId: string) {
  const rows = await db.query.storyClusters.findMany({
    where: and(eq(s.storyClusters.editionId, editionId), inArray(s.storyClusters.status, ["PROPOSED", "CONFIRMED"])),
    with: { members: { with: { submission: { columns: { id: true, title: true, storyType: true } } } }, story: { columns: { id: true } } },
    orderBy: [sql`${s.storyClusters.aiScoreTotal} desc nulls last`],
  });
  return rows.filter((c) => !c.story);
}
