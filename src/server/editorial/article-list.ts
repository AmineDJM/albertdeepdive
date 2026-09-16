/**
 * Read model for the article desk: one row per written article of an edition, with the story it
 * comes from, its section, its assignee, how much of the AI draft an editor rewrote and what
 * still needs attention. Read-only — nothing here mutates.
 */
import { and, asc, count, eq, exists, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { MissingInformationItem, WarningItem } from "@/server/db/schema";

export type ArticleDeskFilter = {
  q?: string;
  status?: string;
  sectionId?: string;
  campusId?: string;
  assignee?: string;
  sort?: "section" | "recent" | "words" | "status" | "manual" | string;
};

export const ARTICLE_STATUSES = ["EMPTY", "AI_DRAFT", "IN_EDITING", "READY_FOR_REVIEW", "APPROVED", "LOCKED"] as const;
export type ArticleDeskStatus = (typeof ARTICLE_STATUSES)[number];

/** Statuses that count as "done" on the desk summary. */
const APPROVED_STATUSES: readonly ArticleDeskStatus[] = ["APPROVED", "LOCKED"];
const REVIEW_STATUSES: readonly ArticleDeskStatus[] = ["READY_FOR_REVIEW"];
const DRAFTING_STATUSES: readonly ArticleDeskStatus[] = ["EMPTY", "AI_DRAFT", "IN_EDITING"];

export type ArticleDeskRow = {
  id: string;
  storyId: string;
  headline: string;
  kicker: string | null;
  standfirst: string | null;
  status: ArticleDeskStatus;
  wordCount: number;
  /** Share of the last AI draft an editor rewrote (0–1), null when there was never an AI draft. */
  manualEditRatio: number | null;
  revision: number;
  warnings: WarningItem[];
  storyWarnings: WarningItem[];
  openQuestions: MissingInformationItem[];
  section: { id: string; name: string; colour: string | null; sortOrder: number } | null;
  story: { id: string; title: string; status: string; priority: number; isCover: boolean; targetLength: string };
  campuses: { id: string; name: string; colour: string | null }[];
  assignee: { id: string; name: string } | null;
  lastEditedAt: Date | null;
  lastEditedByName: string | null;
  aiDraftedAt: Date | null;
  approvedAt: Date | null;
  updatedAt: Date;
};

export type ArticleDeskFacets = {
  total: number;
  approved: number;
  inReview: number;
  drafting: number;
  locked: number;
  warnings: number;
  words: number;
  /** Selected stories that have no article row yet. */
  missingDrafts: number;
  selectedStories: number;
};

function statusFilter(status: string | undefined) {
  if (!status || status === "all") return null;
  if (status === "approved") return inArray(s.articles.status, [...APPROVED_STATUSES]);
  if (status === "review") return inArray(s.articles.status, [...REVIEW_STATUSES]);
  if (status === "drafting") return inArray(s.articles.status, [...DRAFTING_STATUSES]);
  if ((ARTICLE_STATUSES as readonly string[]).includes(status)) return eq(s.articles.status, status as ArticleDeskStatus);
  return null;
}

export async function listArticleDesk(editionId: string, f: ArticleDeskFilter = {}): Promise<ArticleDeskRow[]> {
  const conditions = [eq(s.articles.editionId, editionId)];
  const status = statusFilter(f.status);
  if (status) conditions.push(status);

  if (f.sectionId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(s.stories)
          .where(and(eq(s.stories.id, s.articles.storyId), f.sectionId === "none" ? isNull(s.stories.sectionId) : eq(s.stories.sectionId, f.sectionId))),
      ),
    );
  }
  if (f.campusId) {
    conditions.push(
      f.campusId === "school"
        ? sql`not exists (select 1 from ${s.storyCampuses} sc where sc.story_id = ${s.articles.storyId})`
        : exists(
            db
              .select({ one: sql`1` })
              .from(s.storyCampuses)
              .where(and(eq(s.storyCampuses.storyId, s.articles.storyId), eq(s.storyCampuses.campusId, f.campusId))),
          ),
    );
  }
  if (f.assignee) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(s.stories)
          .where(and(eq(s.stories.id, s.articles.storyId), f.assignee === "none" ? isNull(s.stories.assignedToUserId) : eq(s.stories.assignedToUserId, f.assignee))),
      ),
    );
  }
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    conditions.push(
      or(
        ilike(s.articles.headline, like),
        ilike(s.articles.standfirst, like),
        exists(db.select({ one: sql`1` }).from(s.stories).where(and(eq(s.stories.id, s.articles.storyId), ilike(s.stories.title, like)))),
      )!,
    );
  }

  const rows = await db.query.articles.findMany({
    where: and(...conditions),
    limit: 300,
    with: {
      story: {
        columns: { id: true, title: true, status: true, priority: true, isCover: true, targetLength: true, warnings: true, missingInformation: true },
        with: {
          section: { columns: { id: true, name: true, colour: true, sortOrder: true } },
          campuses: { with: { campus: { columns: { id: true, name: true, colour: true } } } },
          assignedTo: { columns: { id: true, name: true } },
        },
      },
    },
  });

  const editorIds = [...new Set(rows.map((r) => r.lastEditedById).filter((id): id is string => !!id))];
  const editors = editorIds.length
    ? await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, editorIds))
    : [];
  const editorName = new Map(editors.map((u) => [u.id, u.name]));

  const list: ArticleDeskRow[] = rows.map((row) => ({
    id: row.id,
    storyId: row.storyId,
    headline: row.headline || row.story.title,
    kicker: row.kicker,
    standfirst: row.standfirst,
    status: row.status,
    wordCount: row.wordCount,
    manualEditRatio: row.manualEditRatio,
    revision: row.currentRevision,
    warnings: row.warnings,
    storyWarnings: row.story.warnings,
    openQuestions: row.story.missingInformation.filter((m) => !m.resolved),
    section: row.story.section ? { id: row.story.section.id, name: row.story.section.name, colour: row.story.section.colour, sortOrder: row.story.section.sortOrder } : null,
    story: { id: row.story.id, title: row.story.title, status: row.story.status, priority: row.story.priority, isCover: row.story.isCover, targetLength: row.story.targetLength },
    campuses: row.story.campuses.map((c) => c.campus),
    assignee: row.story.assignedTo ? { id: row.story.assignedTo.id, name: row.story.assignedTo.name } : null,
    lastEditedAt: row.lastEditedAt,
    lastEditedByName: row.lastEditedById ? (editorName.get(row.lastEditedById) ?? null) : null,
    aiDraftedAt: row.aiDraftedAt,
    approvedAt: row.approvedAt,
    updatedAt: row.updatedAt,
  }));

  const statusRank: Record<ArticleDeskStatus, number> = { READY_FOR_REVIEW: 0, IN_EDITING: 1, AI_DRAFT: 2, EMPTY: 3, APPROVED: 4, LOCKED: 5 };
  const time = (d: Date | null) => (d ? d.getTime() : 0);
  switch (f.sort) {
    case "recent":
      list.sort((a, b) => Math.max(time(b.lastEditedAt), time(b.updatedAt)) - Math.max(time(a.lastEditedAt), time(a.updatedAt)));
      break;
    case "words":
      list.sort((a, b) => b.wordCount - a.wordCount);
      break;
    case "status":
      list.sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.story.priority - a.story.priority);
      break;
    case "manual":
      list.sort((a, b) => (b.manualEditRatio ?? -1) - (a.manualEditRatio ?? -1));
      break;
    default:
      list.sort(
        (a, b) =>
          (a.section?.sortOrder ?? 999) - (b.section?.sortOrder ?? 999) ||
          (a.section?.name ?? "").localeCompare(b.section?.name ?? "") ||
          b.story.priority - a.story.priority ||
          a.headline.localeCompare(b.headline),
      );
  }
  return list;
}

export async function articleDeskFacets(editionId: string): Promise<ArticleDeskFacets> {
  const [row] = await db
    .select({
      total: count(),
      approved: sql<number>`count(*) filter (where ${s.articles.status} in ('APPROVED','LOCKED'))`,
      locked: sql<number>`count(*) filter (where ${s.articles.status} = 'LOCKED')`,
      inReview: sql<number>`count(*) filter (where ${s.articles.status} = 'READY_FOR_REVIEW')`,
      drafting: sql<number>`count(*) filter (where ${s.articles.status} in ('EMPTY','AI_DRAFT','IN_EDITING'))`,
      warnings: sql<number>`count(*) filter (where jsonb_array_length(${s.articles.warnings}) > 0)`,
      words: sql<number>`coalesce(sum(${s.articles.wordCount}), 0)`,
    })
    .from(s.articles)
    .where(eq(s.articles.editionId, editionId));

  const [stories] = await db
    .select({
      selected: count(),
      // Columns interpolated inside a raw select are rendered unqualified, so the correlation is written by hand.
      missing: sql<number>`count(*) filter (where not exists (select 1 from ${s.articles} a where a.story_id = ${s.stories}.id))`,
    })
    .from(s.stories)
    .where(and(eq(s.stories.editionId, editionId), inArray(s.stories.status, ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"])));

  return {
    total: Number(row?.total ?? 0),
    approved: Number(row?.approved ?? 0),
    locked: Number(row?.locked ?? 0),
    inReview: Number(row?.inReview ?? 0),
    drafting: Number(row?.drafting ?? 0),
    warnings: Number(row?.warnings ?? 0),
    words: Number(row?.words ?? 0),
    missingDrafts: Number(stories?.missing ?? 0),
    selectedStories: Number(stories?.selected ?? 0),
  };
}

/** Languages the articles of an edition are written in (articles carry the language, not the edition). */
export async function editionLanguages(editionId: string): Promise<{ code: string; count: number }[]> {
  const rows = await db
    .select({ code: s.articles.language, n: count() })
    .from(s.articles)
    .where(eq(s.articles.editionId, editionId))
    .groupBy(s.articles.language);
  return rows.map((r) => ({ code: r.code, count: Number(r.n) })).sort((a, b) => b.count - a.count);
}

/** Editors an article of this edition is assigned to, for the desk filter. */
export async function articleAssignees(editionId: string) {
  const rows = await db
    .selectDistinct({ id: s.users.id, name: s.users.name })
    .from(s.stories)
    .innerJoin(s.users, eq(s.users.id, s.stories.assignedToUserId))
    .where(eq(s.stories.editionId, editionId))
    .orderBy(asc(s.users.name));
  return rows;
}
