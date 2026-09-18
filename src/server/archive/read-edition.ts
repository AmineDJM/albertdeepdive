/**
 * Read model for the Archive screens.
 *
 * `archiveShelf` decorates `archiveEditions()` (which already resolves covers and the signed
 * downloads of the latest READY version) with the two things the back-catalogue card needs and
 * the service does not compute: how many articles the issue holds and who is credited in it.
 * `archiveEditionDetail` is the issue file: table of contents, articles by section, versions.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { mediaUrl } from "@/server/media/urls";
import { archiveEditions, ARCHIVE_STORY_STATUSES, type ArchiveEdition } from "./service";

const n = (value: unknown): number => Number(value ?? 0);

export type CreditedContributor = { id: string; name: string; campusName: string | null; campusColour: string | null; articles: number };

export type ShelfEdition = ArchiveEdition & {
  title: string;
  tagline: string | null;
  articles: number;
  words: number;
  sections: number;
  credited: CreditedContributor[];
  creditedCount: number;
};

/** Every contributor whose submission feeds an article of the edition, plus named article authors. */
async function creditsByEdition(editionIds: string[]): Promise<Map<string, CreditedContributor[]>> {
  const out = new Map<string, CreditedContributor[]>();
  if (!editionIds.length) return out;
  const rows = await db
    .select({
      editionId: s.articles.editionId,
      contributorId: s.contributors.id,
      name: sql<string>`${s.contributors.firstName} || ' ' || ${s.contributors.lastName}`,
      campusName: s.campuses.name,
      campusColour: s.campuses.colour,
      articles: sql<number>`count(distinct ${s.articles.id})`,
    })
    .from(s.articleSources)
    .innerJoin(s.articles, eq(s.articles.id, s.articleSources.articleId))
    .innerJoin(s.submissions, eq(s.submissions.id, s.articleSources.submissionId))
    .innerJoin(s.contributors, eq(s.contributors.id, s.submissions.contributorId))
    .leftJoin(s.campuses, eq(s.campuses.id, s.contributors.campusId))
    .where(inArray(s.articles.editionId, editionIds))
    .groupBy(s.articles.editionId, s.contributors.id, s.campuses.name, s.campuses.colour)
    .orderBy(desc(sql`count(distinct ${s.articles.id})`), asc(s.contributors.lastName));
  for (const r of rows) {
    const list = out.get(r.editionId) ?? [];
    list.push({ id: r.contributorId, name: r.name, campusName: r.campusName, campusColour: r.campusColour, articles: n(r.articles) });
    out.set(r.editionId, list);
  }
  return out;
}

/** The back-catalogue: one card per edition, newest first. */
export async function archiveShelf(): Promise<ShelfEdition[]> {
  const editions = await archiveEditions();
  if (!editions.length) return [];
  const ids = editions.map((e) => e.id);
  const [rows, sectionRows, meta, credits] = await Promise.all([
    db
      .select({ editionId: s.articles.editionId, articles: sql<number>`count(*) filter (where ${s.articles.status} <> 'EMPTY')`, words: sql<number>`coalesce(sum(${s.articles.wordCount}), 0)` })
      .from(s.articles)
      .where(inArray(s.articles.editionId, ids))
      .groupBy(s.articles.editionId),
    db.select({ editionId: s.editionSections.editionId, sections: sql<number>`count(*)` }).from(s.editionSections).where(inArray(s.editionSections.editionId, ids)).groupBy(s.editionSections.editionId),
    db.select({ id: s.editions.id, title: s.editions.title, theme: s.editions.theme }).from(s.editions).where(inArray(s.editions.id, ids)),
    creditsByEdition(ids),
  ]);
  const articleMap = new Map(rows.map((r) => [r.editionId, r]));
  const sectionMap = new Map(sectionRows.map((r) => [r.editionId, n(r.sections)]));
  const metaMap = new Map(meta.map((r) => [r.id, r]));
  return editions.map((e) => {
    const credited = credits.get(e.id) ?? [];
    return {
      ...e,
      title: metaMap.get(e.id)?.title ?? e.title,
      tagline: metaMap.get(e.id)?.theme?.tagline ?? null,
      articles: n(articleMap.get(e.id)?.articles),
      words: n(articleMap.get(e.id)?.words),
      sections: sectionMap.get(e.id) ?? 0,
      credited: credited.slice(0, 8),
      creditedCount: credited.length,
    };
  });
}

export type TocEntry = {
  pageNumber: number;
  template: string;
  sectionName: string | null;
  sectionColour: string | null;
  storyId: string | null;
  articleId: string | null;
  headline: string | null;
  isContinuation: boolean;
  extraStories: number;
};

export type ArchiveArticle = {
  id: string | null;
  storyId: string;
  headline: string;
  standfirst: string | null;
  byline: string | null;
  status: string;
  storyType: string;
  wordCount: number;
  revision: number;
  isCover: boolean;
  pageNumber: number | null;
  sources: number;
};

export type ArchiveSection = { id: string; slug: string; name: string; kicker: string | null; colour: string | null; targetPages: number | null; articles: ArchiveArticle[] };

export type ArchiveVersion = {
  id: string;
  label: string;
  sequence: number;
  kind: string;
  status: string;
  isImmutable: boolean;
  notes: string | null;
  createdAt: Date;
  completedAt: Date | null;
  createdByName: string | null;
  pageCount: number | null;
  issues: number;
  assets: { id: string; kind: string; fileName: string; sizeBytes: number; pageCount: number | null; url: string }[];
};

export type ArchiveRevision = { id: string; articleId: string; headline: string; version: number; createdAt: Date; createdByAi: boolean; createdByName: string | null; changeSummary: string | null; wordCount: number };

export type ArchiveEditionDetail = {
  edition: { id: string; label: string; title: string; issueLabel: string; status: string; slug: string; month: number; year: number; tagline: string | null; accentColour: string | null; coverHeadline: string | null; coverStandfirst: string | null; editorial: string | null; publishedAt: Date | null; publicationTargetAt: Date | null; targetPageCount: number; editorInChief: string | null };
  coverUrl: string | null;
  downloads: ArchiveEdition["downloads"];
  pageCount: number | null;
  toc: TocEntry[];
  planName: string | null;
  sections: ArchiveSection[];
  versions: ArchiveVersion[];
  revisions: ArchiveRevision[];
  credited: CreditedContributor[];
  stats: { stories: number; articles: number; words: number; media: number; pages: number };
};

/** One archived issue: what is in it, on which page, and every render it produced. */
export async function archiveEditionDetail(editionId: string): Promise<ArchiveEditionDetail | null> {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), with: { editorInChief: true } });
  if (!edition) return null;

  const [sections, storyRows, plan, versions, credits] = await Promise.all([
    db.select().from(s.editionSections).where(eq(s.editionSections.editionId, editionId)).orderBy(asc(s.editionSections.sortOrder)),
    db
      .select({
        storyId: s.stories.id,
        sectionId: s.stories.sectionId,
        title: s.stories.title,
        storyType: s.stories.storyType,
        isCover: s.stories.isCover,
        priority: s.stories.priority,
        articleId: s.articles.id,
        headline: s.articles.headline,
        standfirst: s.articles.standfirst,
        byline: s.articles.byline,
        status: s.articles.status,
        wordCount: s.articles.wordCount,
        revision: s.articles.currentRevision,
        sources: sql<number>`(select count(*) from ${s.articleSources} src where src.article_id = ${s.articles.id})`,
      })
      .from(s.stories)
      .leftJoin(s.articles, eq(s.articles.storyId, s.stories.id))
      .where(and(eq(s.stories.editionId, editionId), inArray(s.stories.status, [...ARCHIVE_STORY_STATUSES])))
      .orderBy(desc(s.stories.isCover), desc(s.stories.priority), asc(s.stories.title)),
    db.query.pagePlans.findFirst({ where: and(eq(s.pagePlans.editionId, editionId), eq(s.pagePlans.isActive, true)), orderBy: [desc(s.pagePlans.updatedAt)] }),
    db
      .select({ version: s.publicationVersions, createdByName: s.users.name })
      .from(s.publicationVersions)
      .leftJoin(s.users, eq(s.users.id, s.publicationVersions.createdById))
      .where(eq(s.publicationVersions.editionId, editionId))
      .orderBy(desc(s.publicationVersions.sequence)),
    creditsByEdition([editionId]),
  ]);

  const pages = plan
    ? await db
        .select({ page: s.pagePlanPages, sectionName: s.editionSections.name, sectionColour: s.editionSections.colour, headline: s.articles.headline, storyTitle: s.stories.title })
        .from(s.pagePlanPages)
        .leftJoin(s.editionSections, eq(s.editionSections.id, s.pagePlanPages.sectionId))
        .leftJoin(s.stories, eq(s.stories.id, s.pagePlanPages.storyId))
        .leftJoin(s.articles, eq(s.articles.id, s.pagePlanPages.articleId))
        .where(eq(s.pagePlanPages.planId, plan.id))
        .orderBy(asc(s.pagePlanPages.pageNumber))
    : [];

  const pageByStory = new Map<string, number>();
  for (const row of pages) if (row.page.storyId && !pageByStory.has(row.page.storyId)) pageByStory.set(row.page.storyId, row.page.pageNumber);

  const toc: TocEntry[] = pages.map((row) => ({
    pageNumber: row.page.pageNumber,
    template: row.page.template,
    sectionName: row.sectionName,
    sectionColour: row.sectionColour,
    storyId: row.page.storyId,
    articleId: row.page.articleId,
    headline: row.headline?.trim() || row.storyTitle || null,
    isContinuation: !!row.page.continuationOfPageId,
    extraStories: Math.max(0, row.page.storyIds.length - 1),
  }));

  const bySection = new Map<string, ArchiveArticle[]>();
  for (const r of storyRows) {
    const key = r.sectionId ?? "unassigned";
    const list = bySection.get(key) ?? [];
    list.push({
      id: r.articleId,
      storyId: r.storyId,
      headline: r.headline?.trim() || r.title,
      standfirst: r.standfirst,
      byline: r.byline,
      status: r.status ?? "EMPTY",
      storyType: r.storyType,
      wordCount: r.wordCount ?? 0,
      revision: r.revision ?? 0,
      isCover: r.isCover,
      pageNumber: pageByStory.get(r.storyId) ?? null,
      sources: n(r.sources),
    });
    bySection.set(key, list);
  }
  const orderedSections: ArchiveSection[] = sections
    .map((sec) => ({ id: sec.id, slug: sec.slug, name: sec.name, kicker: sec.kicker, colour: sec.colour, targetPages: sec.targetPages, articles: (bySection.get(sec.id) ?? []).sort((a, b) => (a.pageNumber ?? 999) - (b.pageNumber ?? 999)) }))
    .filter((sec) => sec.articles.length > 0);
  const unassigned = bySection.get("unassigned") ?? [];
  if (unassigned.length) orderedSections.push({ id: "unassigned", slug: "unassigned", name: "Not yet placed", kicker: null, colour: null, targetPages: null, articles: unassigned });

  const versionIds = versions.map((v) => v.version.id);
  const assets = versionIds.length ? await db.select().from(s.publicationAssets).where(inArray(s.publicationAssets.versionId, versionIds)) : [];
  const storage = await getStorage();
  const versionViews: ArchiveVersion[] = [];
  for (const { version, createdByName } of versions) {
    const own = assets.filter((a) => a.versionId === version.id);
    const resolved: ArchiveVersion["assets"] = [];
    for (const a of own) {
      resolved.push({ id: a.id, kind: a.kind, fileName: a.fileName, sizeBytes: a.sizeBytes, pageCount: a.pageCount, url: await storage.getSignedUrl(a.storageKey, { expiresInSeconds: 3600, download: { fileName: a.fileName } }) });
    }
    versionViews.push({
      id: version.id,
      label: version.label,
      sequence: version.sequence,
      kind: version.kind,
      status: version.status,
      isImmutable: version.isImmutable,
      notes: version.notes,
      createdAt: version.createdAt,
      completedAt: version.completedAt,
      createdByName,
      pageCount: own.find((a) => a.kind === "PDF")?.pageCount ?? null,
      issues: (version.validationReport?.issues.length ?? 0) + (version.layoutReport?.issues.length ?? 0),
      assets: resolved,
    });
  }

  const articleIds = storyRows.map((r) => r.articleId).filter((id): id is string => !!id);
  const revisions = articleIds.length
    ? await db
        .select({ revision: s.articleRevisions, createdByName: s.users.name })
        .from(s.articleRevisions)
        .leftJoin(s.users, eq(s.users.id, s.articleRevisions.createdById))
        .where(inArray(s.articleRevisions.articleId, articleIds))
        .orderBy(desc(s.articleRevisions.createdAt))
        .limit(40)
    : [];

  const [mediaCount] = await db.select({ n: sql<number>`count(*)` }).from(s.mediaAssets).where(and(eq(s.mediaAssets.editionId, editionId), eq(s.mediaAssets.isArchived, false)));
  const latestReady = versionViews.find((v) => v.status === "READY");

  return {
    edition: {
      id: edition.id,
      label: edition.label,
      title: edition.title,
      issueLabel: `${edition.isSpecialIssue ? "Special issue" : "Issue"} N°${edition.issueNumber}`,
      status: edition.status,
      slug: edition.slug,
      month: edition.month,
      year: edition.year,
      tagline: edition.theme?.tagline ?? null,
      accentColour: edition.theme?.accentColour ?? null,
      coverHeadline: edition.coverHeadline,
      coverStandfirst: edition.coverStandfirst,
      editorial: edition.editorial,
      publishedAt: edition.publishedAt,
      publicationTargetAt: edition.publicationTargetAt,
      targetPageCount: edition.targetPageCount,
      editorInChief: edition.editorInChief?.name ?? null,
    },
    coverUrl: edition.coverMediaAssetId ? await mediaUrl(edition.coverMediaAssetId, "WEB") : null,
    downloads: latestReady ? latestReady.assets.filter((a) => a.kind === "PDF" || a.kind === "DOCX").map((a) => ({ kind: a.kind as "PDF" | "DOCX", url: a.url, fileName: a.fileName, sizeBytes: a.sizeBytes })) : [],
    pageCount: latestReady?.pageCount ?? plan?.pageCount ?? null,
    toc,
    planName: plan?.name ?? null,
    sections: orderedSections,
    versions: versionViews,
    revisions: revisions.map((r) => ({ id: r.revision.id, articleId: r.revision.articleId, headline: r.revision.headline, version: r.revision.version, createdAt: r.revision.createdAt, createdByAi: r.revision.createdByAi, createdByName: r.createdByName, changeSummary: r.revision.changeSummary, wordCount: r.revision.wordCount })),
    credited: credits.get(editionId) ?? [],
    stats: { stories: storyRows.length, articles: storyRows.filter((r) => r.articleId && r.status !== "EMPTY").length, words: storyRows.reduce((a, r) => a + (r.wordCount ?? 0), 0), media: n(mediaCount?.n), pages: plan?.pageCount ?? 0 },
  };
}
