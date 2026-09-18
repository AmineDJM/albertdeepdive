import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  articleSources,
  articles,
  businessDeepDives,
  campuses,
  contributors,
  editionSections,
  editions,
  events,
  facts,
  mediaAssets,
  mediaVariants,
  pagePlanPages,
  pagePlans,
  quotes,
  stories,
  storyCampuses,
  storyMedia,
  submissions,
  systemSettings,
  users,
} from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { createLogger } from "@/server/logger";
import { NotFoundError } from "@/lib/action-result";
import {
  PAGE_SIZES,
  countWords,
  editionDocumentSchema,
  type ArticleBlock,
  type DocumentArticle,
  type DocumentMedia,
  type DocumentPage,
  type EditionDocument,
} from "@/lib/publication/document";
import { issueLabelFor } from "@/lib/publication/text";

const log = createLogger("publication:document");

export type BuildDocumentOptions = {
  versionLabel: string;
  /** Keep articles that are not APPROVED/LOCKED (drafts, previews). Default false. */
  includeUnapproved?: boolean;
  /** Validity of the signed media URLs embedded in the document (default 24 h). */
  signedUrlTtlSeconds?: number;
};

const SIGNED_URL_TTL = 24 * 60 * 60;
const APPROVED_ARTICLE_STATUSES = new Set(["APPROVED", "LOCKED"]);
const SELECTED_STORY_STATUSES = new Set(["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED"]);
const MEDIA_ROLE_RANK: Record<string, number> = { hero: 0, portrait: 1, logo: 2, gallery: 3, screenshot: 4, diagram: 5, cover: 9 };
const CREDIT_TAGS: Record<string, string> = { "editor-in-chief": "Editor in chief", translator: "Translator" };

type Warning = EditionDocument["warnings"][number];

function uniq<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function readSetting<T>(rows: { key: string; value: unknown }[], key: string): T | null {
  const row = rows.find((r) => r.key === key);
  return row ? (row.value as T) : null;
}

/**
 * Assembles the canonical EditionDocument from the database: edition metadata, ordered sections,
 * the ACTIVE page plan, every article placed on it (with blocks, quotes, media links, BDD satellite,
 * facts, sources), the media catalogue with signed variant URLs, cover, table of contents,
 * references and warnings. Ordering is deterministic everywhere so `documentHash` is stable.
 */
export async function buildEditionDocument(editionId: string, options: BuildDocumentOptions): Promise<EditionDocument> {
  const includeUnapproved = options.includeUnapproved ?? false;
  const ttl = options.signedUrlTtlSeconds ?? SIGNED_URL_TTL;
  const storage = await getStorage();
  const warnings: Warning[] = [];

  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");

  const [sectionRows, settingRows, campusRows, editorInChief] = await Promise.all([
    db
      .select()
      .from(editionSections)
      .where(and(eq(editionSections.editionId, editionId), eq(editionSections.isHidden, false)))
      .orderBy(asc(editionSections.sortOrder), asc(editionSections.name)),
    db.select({ key: systemSettings.key, value: systemSettings.value }).from(systemSettings),
    db.select().from(campuses).where(eq(campuses.isActive, true)).orderBy(asc(campuses.sortOrder), asc(campuses.name)),
    edition.editorInChiefId ? db.query.users.findFirst({ where: eq(users.id, edition.editorInChiefId) }) : Promise.resolve(undefined),
  ]);
  const sectionById = new Map(sectionRows.map((s) => [s.id, s]));

  // ── Active page plan ───────────────────────────────────────────────────────
  const plan = await db.query.pagePlans.findFirst({
    where: and(eq(pagePlans.editionId, editionId), eq(pagePlans.isActive, true)),
    orderBy: [desc(pagePlans.createdAt)],
  });
  const planPages = plan
    ? await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id)).orderBy(asc(pagePlanPages.pageNumber))
    : [];
  if (!plan) warnings.push({ code: "NO_ACTIVE_PLAN", severity: "error", message: "The edition has no active page plan." });

  // ── Stories & articles in scope ────────────────────────────────────────────
  const allStories = await db.select().from(stories).where(eq(stories.editionId, editionId)).orderBy(asc(stories.slug));
  const storyById = new Map(allStories.map((st) => [st.id, st]));
  const plannedStoryIds = uniq(planPages.flatMap((p) => [...(p.storyId ? [p.storyId] : []), ...p.storyIds]));
  const scopeStoryIds = uniq([...plannedStoryIds, ...(edition.coverStoryId ? [edition.coverStoryId] : [])]).filter((id) =>
    storyById.has(id),
  );

  const articleRows = scopeStoryIds.length
    ? await db.select().from(articles).where(inArray(articles.storyId, scopeStoryIds))
    : [];
  const articleByStoryId = new Map(articleRows.map((a) => [a.storyId, a]));
  const articleIds = articleRows.map((a) => a.id);

  const [campusLinks, mediaLinks, quoteRows, factRows, eventRows, bddRows, sourceRows] = await Promise.all([
    scopeStoryIds.length
      ? db
          .select({ storyId: storyCampuses.storyId, campusId: storyCampuses.campusId, name: campuses.name, sortOrder: campuses.sortOrder })
          .from(storyCampuses)
          .innerJoin(campuses, eq(campuses.id, storyCampuses.campusId))
          .where(inArray(storyCampuses.storyId, scopeStoryIds))
      : Promise.resolve([]),
    scopeStoryIds.length
      ? db.select().from(storyMedia).where(inArray(storyMedia.storyId, scopeStoryIds))
      : Promise.resolve([]),
    scopeStoryIds.length
      ? db
          .select()
          .from(quotes)
          .where(and(inArray(quotes.storyId, scopeStoryIds), eq(quotes.isApproved, true)))
          .orderBy(desc(quotes.isPullQuoteCandidate), desc(quotes.aiScore), asc(quotes.createdAt), asc(quotes.id))
      : Promise.resolve([]),
    scopeStoryIds.length
      ? db.select().from(facts).where(inArray(facts.storyId, scopeStoryIds)).orderBy(asc(facts.createdAt), asc(facts.id))
      : Promise.resolve([]),
    scopeStoryIds.length
      ? db.select().from(events).where(inArray(events.storyId, scopeStoryIds)).orderBy(asc(events.createdAt), asc(events.id))
      : Promise.resolve([]),
    scopeStoryIds.length
      ? db.select().from(businessDeepDives).where(inArray(businessDeepDives.storyId, scopeStoryIds))
      : Promise.resolve([]),
    articleIds.length ? db.select().from(articleSources).where(inArray(articleSources.articleId, articleIds)) : Promise.resolve([]),
  ]);

  const submissionIds = uniq(sourceRows.map((r) => r.submissionId));
  const submissionRows = submissionIds.length
    ? await db
        .select({ id: submissions.id, title: submissions.title, urls: submissions.urls, eventDateText: submissions.eventDateText })
        .from(submissions)
        .where(inArray(submissions.id, submissionIds))
    : [];
  const submissionById = new Map(submissionRows.map((r) => [r.id, r]));

  // ── Media catalogue ────────────────────────────────────────────────────────
  const mediaIds = uniq([
    ...mediaLinks.map((m) => m.mediaAssetId),
    ...planPages.flatMap((p) => p.mediaAssetIds),
    ...(edition.coverMediaAssetId ? [edition.coverMediaAssetId] : []),
    ...bddRows.flatMap((b) => [b.logoAssetId, b.teamPhotoAssetId, b.dashboardAssetId, b.diagramAssetId].filter((x): x is string => !!x)),
  ]).sort();
  const [assetRows, variantRows] = await Promise.all([
    mediaIds.length ? db.select().from(mediaAssets).where(inArray(mediaAssets.id, mediaIds)) : Promise.resolve([]),
    mediaIds.length ? db.select().from(mediaVariants).where(inArray(mediaVariants.assetId, mediaIds)) : Promise.resolve([]),
  ]);
  const variantsByAsset = new Map<string, typeof variantRows>();
  for (const v of variantRows) {
    const list = variantsByAsset.get(v.assetId) ?? [];
    list.push(v);
    variantsByAsset.set(v.assetId, list);
  }

  async function variantSource(assetId: string, kind: "PRINT" | "WEB" | "THUMBNAIL") {
    const v = (variantsByAsset.get(assetId) ?? []).find((x) => x.kind === kind);
    if (!v) return null;
    return {
      key: v.storageKey,
      url: await storage.getSignedUrl(v.storageKey, { expiresInSeconds: ttl }),
      path: storage.localPath ? storage.localPath(v.storageKey) : null,
      width: v.width,
      height: v.height,
    };
  }

  const media: DocumentMedia[] = [];
  for (const asset of [...assetRows].sort((a, b) => a.id.localeCompare(b.id))) {
    const [print, web, thumb] = await Promise.all([
      variantSource(asset.id, "PRINT"),
      variantSource(asset.id, "WEB"),
      variantSource(asset.id, "THUMBNAIL"),
    ]);
    const printKey = print?.key ?? web?.key ?? asset.storageKey;
    const exists = await storage.exists(printKey);
    if (!exists) {
      warnings.push({
        code: "MISSING_MEDIA_FILE",
        severity: "error",
        message: `The file for "${asset.fileName}" is missing from storage (${printKey}).`,
        entityId: asset.id,
      });
    }
    media.push({
      id: asset.id,
      kind: asset.kind,
      caption: asset.caption,
      credit: asset.credit,
      altText: asset.altText,
      width: asset.width,
      height: asset.height,
      aspectRatio: asset.aspectRatio ?? (asset.width && asset.height ? Math.round((asset.width / asset.height) * 1000) / 1000 : null),
      rightsStatus: asset.rightsStatus,
      fileName: asset.fileName,
      photographer: asset.photographer,
      src: { print, web, thumb },
    });
  }
  const mediaById = new Map(media.map((m) => [m.id, m]));

  // ── Articles ───────────────────────────────────────────────────────────────
  const campusNamesByStory = new Map<string, string[]>();
  for (const link of [...campusLinks].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
    campusNamesByStory.set(link.storyId, [...(campusNamesByStory.get(link.storyId) ?? []), link.name]);
  }
  const bddByStory = new Map(bddRows.map((b) => [b.storyId, b]));
  const eventByStory = new Map<string, (typeof eventRows)[number]>();
  for (const ev of eventRows) if (!eventByStory.has(ev.storyId ?? "")) eventByStory.set(ev.storyId ?? "", ev);

  const docArticles: DocumentArticle[] = [];
  const excludedArticleIds = new Set<string>();
  for (const storyId of [...scopeStoryIds].sort()) {
    const story = storyById.get(storyId)!;
    const article = articleByStoryId.get(storyId);
    if (!article) {
      warnings.push({ code: "STORY_WITHOUT_ARTICLE", severity: "error", message: `Story "${story.title}" has no article.`, entityId: storyId });
      continue;
    }
    if (!includeUnapproved && !APPROVED_ARTICLE_STATUSES.has(article.status)) {
      excludedArticleIds.add(article.id);
      warnings.push({
        code: "ARTICLE_EXCLUDED",
        severity: "warning",
        message: `"${article.headline || story.title}" is ${article.status.toLowerCase().replace(/_/g, " ")} and was left out of this version.`,
        entityId: article.id,
      });
      continue;
    }
    const body = (article.body as ArticleBlock[]).map((b) => ({ ...b }));
    const links = mediaLinks
      .filter((m) => m.storyId === storyId && mediaById.has(m.mediaAssetId))
      .sort(
        (a, b) =>
          (MEDIA_ROLE_RANK[a.role] ?? 6) - (MEDIA_ROLE_RANK[b.role] ?? 6) ||
          a.sortOrder - b.sortOrder ||
          a.mediaAssetId.localeCompare(b.mediaAssetId),
      );
    const heroLink =
      links.find((l) => l.role === "hero") ??
      links.find((l) => l.role === "portrait") ??
      links.find((l) => mediaById.get(l.mediaAssetId)?.kind === "photo" && l.role !== "cover") ??
      links.find((l) => l.role !== "cover") ??
      null;
    const pullQuotes: DocumentArticle["pullQuotes"] = [];
    const seenQuotes = new Set<string>();
    const pushQuote = (text: string, attribution: string | null) => {
      const key = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
      if (!key || seenQuotes.has(key)) return;
      seenQuotes.add(key);
      pullQuotes.push({ text: text.trim(), attribution });
    };
    for (const q of quoteRows.filter((q) => q.storyId === storyId && q.isPullQuoteCandidate)) {
      pushQuote(q.text, [q.speakerName, q.speakerRole].filter(Boolean).join(", ") || null);
    }
    for (const b of body) if (b.type === "pullquote") pushQuote(b.text, b.attribution ?? null);
    for (const q of quoteRows.filter((q) => q.storyId === storyId && !q.isPullQuoteCandidate)) {
      pushQuote(q.text, [q.speakerName, q.speakerRole].filter(Boolean).join(", ") || null);
    }
    const bdd = bddByStory.get(storyId);
    const event = eventByStory.get(storyId);
    const sources = sourceRows
      .filter((r) => r.articleId === article.id)
      .sort((a, b) => (a.role === "PRIMARY" ? 0 : 1) - (b.role === "PRIMARY" ? 0 : 1) || a.submissionId.localeCompare(b.submissionId));
    const primarySubmission = sources.map((r) => submissionById.get(r.submissionId)).find((r) => r?.eventDateText);
    docArticles.push({
      id: article.id,
      storyId,
      sectionId: story.sectionId && sectionById.has(story.sectionId) ? story.sectionId : null,
      storyType: story.storyType,
      kicker: article.kicker,
      headline: article.headline,
      standfirst: article.standfirst,
      byline: article.byline,
      body,
      pullQuotes,
      media: links.map((l) => ({ mediaId: l.mediaAssetId, role: l.role, sortOrder: l.sortOrder })),
      heroMediaId: heroLink?.mediaAssetId ?? null,
      tags: [...article.tags].sort(),
      campuses: campusNamesByStory.get(storyId) ?? [],
      wordCount: countWords(body),
      bdd: bdd
        ? {
            companyName: bdd.companyName,
            cohortLabel: bdd.cohortLabel,
            dateText: bdd.dateText,
            theCase: bdd.theCase,
            theData: bdd.theData,
            theChallenge: bdd.theChallenge,
            theApproach: bdd.theApproach,
            theMethods: bdd.theMethods,
            theSolution: bdd.theSolution,
            theResults: bdd.theResults,
            keyTakeaways: bdd.keyTakeaways,
            winningTeam: bdd.winningTeam,
            finalists: bdd.finalists,
            jury: bdd.jury,
            technologies: bdd.technologies,
            metrics: bdd.metrics,
            logoMediaId: bdd.logoAssetId && mediaById.has(bdd.logoAssetId) ? bdd.logoAssetId : null,
            teamPhotoMediaId: bdd.teamPhotoAssetId && mediaById.has(bdd.teamPhotoAssetId) ? bdd.teamPhotoAssetId : null,
            dashboardMediaId: bdd.dashboardAssetId && mediaById.has(bdd.dashboardAssetId) ? bdd.dashboardAssetId : null,
            diagramMediaId: bdd.diagramAssetId && mediaById.has(bdd.diagramAssetId) ? bdd.diagramAssetId : null,
          }
        : null,
      sourceIds: sources.map((r) => r.submissionId),
      status: article.status,
      eventDateText: event?.dateText ?? primarySubmission?.eventDateText ?? (story.eventDate ? story.eventDate.toISOString().slice(0, 10) : null),
      storyTitle: story.title,
      storySlug: story.slug,
      storyStatus: story.status,
      facts: factRows
        .filter((f) => f.storyId === storyId)
        .map((f) => ({ id: f.id, statement: f.statement, status: f.status, confidence: f.confidence, conflictGroup: f.conflictGroup })),
      event: event
        ? {
            title: event.title,
            dateText: event.dateText,
            location: event.location,
            organiser: event.organiser,
            signupUrl: event.signupUrl,
            isUpcoming: event.isUpcoming,
          }
        : null,
    });
  }
  const articleByStory = new Map(docArticles.map((a) => [a.storyId, a]));

  // ── Pages ──────────────────────────────────────────────────────────────────
  const pageNumberById = new Map(planPages.map((p) => [p.id, p.pageNumber]));
  const pages: DocumentPage[] = planPages.map((p) => {
    const storyIds = uniq([...(p.storyId ? [p.storyId] : []), ...p.storyIds]);
    const articleIdsOnPage = storyIds.map((id) => articleByStory.get(id)?.id).filter((id): id is string => !!id);
    for (const id of storyIds) {
      const st = storyById.get(id);
      const art = st ? articleByStoryId.get(id) : undefined;
      if (art && excludedArticleIds.has(art.id)) continue; // already reported
      if (art && !APPROVED_ARTICLE_STATUSES.has(art.status)) {
        warnings.push({
          code: "ARTICLE_NOT_APPROVED",
          severity: "warning",
          message: `Page ${p.pageNumber}: "${art.headline || st?.title}" is ${art.status.toLowerCase().replace(/_/g, " ")}.`,
          page: p.pageNumber,
          entityId: art.id,
        });
      }
      if (!st) {
        warnings.push({ code: "UNKNOWN_STORY_ON_PAGE", severity: "error", message: `Page ${p.pageNumber} references an unknown story.`, page: p.pageNumber, entityId: id });
      }
    }
    return {
      id: p.id,
      number: p.pageNumber,
      template: p.template,
      sectionId: p.sectionId && sectionById.has(p.sectionId) ? p.sectionId : null,
      articleIds: articleIdsOnPage,
      mediaIds: p.mediaAssetIds.filter((id) => mediaById.has(id)),
      continuationOf: p.continuationOfPageId ? (pageNumberById.get(p.continuationOfPageId) ?? null) : null,
      isLocked: p.isLocked,
      notes: p.notes,
      continuationOfPageId: p.continuationOfPageId ?? null,
      isContinuation: !!p.continuationOfPageId,
      storyIds,
      slices: undefined,
    };
  });

  for (const st of allStories) {
    if (SELECTED_STORY_STATUSES.has(st.status) && !plannedStoryIds.includes(st.id)) {
      warnings.push({ code: "STORY_NOT_ON_PLAN", severity: "info", message: `"${st.title}" is ${st.status.toLowerCase()} but not placed on any page.`, entityId: st.id });
    }
  }

  // ── Cover, TOC, references ─────────────────────────────────────────────────
  const firstPageOfArticle = new Map<string, number>();
  for (const page of pages) for (const id of page.articleIds) if (!firstPageOfArticle.has(id)) firstPageOfArticle.set(id, page.number);

  const coverStory = edition.coverStoryId ? storyById.get(edition.coverStoryId) : undefined;
  const coverArticle = coverStory ? articleByStory.get(coverStory.id) : undefined;
  const coverMediaId = edition.coverMediaAssetId && mediaById.has(edition.coverMediaAssetId) ? edition.coverMediaAssetId : (coverArticle?.heroMediaId ?? null);
  const teasers = plannedStoryIds
    .map((id) => storyById.get(id))
    .filter((st): st is NonNullable<typeof st> => !!st && st.id !== edition.coverStoryId && articleByStory.has(st.id))
    .sort((a, b) => Number(b.isSpotlight) - Number(a.isSpotlight) || b.priority - a.priority || a.title.localeCompare(b.title))
    .slice(0, 6)
    .map((st) => {
      const article = articleByStory.get(st.id)!;
      return { articleId: article.id, line: st.title, page: firstPageOfArticle.get(article.id) ?? null };
    });

  const toc: EditionDocument["toc"] = [];
  const listed = new Set<string>();
  for (const page of pages) {
    for (const id of page.articleIds) {
      if (listed.has(id)) continue;
      listed.add(id);
      const article = docArticles.find((a) => a.id === id)!;
      const section = (page.sectionId && sectionById.get(page.sectionId)) || (article.sectionId && sectionById.get(article.sectionId)) || null;
      toc.push({ page: page.number, sectionName: section?.name ?? "", text: article.headline || article.storyTitle || "", articleId: id });
    }
  }

  const references: EditionDocument["references"] = [];
  const seenRefs = new Set<string>();
  for (const article of docArticles) {
    for (const submissionId of article.sourceIds) {
      const sub = submissionById.get(submissionId);
      for (const url of sub?.urls ?? []) {
        const key = `${article.id}:${url}`;
        if (seenRefs.has(key)) continue;
        seenRefs.add(key);
        references.push({ articleId: article.id, url, label: sub?.title ?? null });
      }
    }
  }

  // ── Meta ───────────────────────────────────────────────────────────────────
  const masthead = readSetting<{ title?: string; tagline?: string | null }>(settingRows, "masthead");
  const contact = readSetting<{ email?: string | null; website?: string | null; instagram?: string | null }>(settingRows, "contact");
  const credits = await resolveCredits(settingRows, editorInChief?.name ?? null);
  const pageSize = PAGE_SIZES[(edition.pageSize as keyof typeof PAGE_SIZES) ?? "A4"] ?? PAGE_SIZES.A4;

  const document: EditionDocument = {
    schemaVersion: "1",
    meta: {
      editionId: edition.id,
      versionLabel: options.versionLabel,
      issueNumber: edition.issueNumber,
      title: edition.title,
      label: edition.label,
      month: edition.month,
      year: edition.year,
      isSpecialIssue: edition.isSpecialIssue,
      issueLabel: issueLabelFor(edition.issueNumber, edition.isSpecialIssue),
      publicationDate: (edition.publishedAt ?? edition.publicationTargetAt)?.toISOString() ?? null,
      generatedAt: new Date().toISOString(),
      pageSize: { name: pageSize.name, widthMm: pageSize.widthMm, heightMm: pageSize.heightMm },
      masthead: { title: masthead?.title || "Albert's Deep Dive", tagline: masthead?.tagline ?? null },
      cover: {
        storyId: coverStory?.id ?? null,
        articleId: coverArticle?.id ?? null,
        headline: edition.coverHeadline ?? coverArticle?.headline ?? null,
        standfirst: edition.coverStandfirst ?? coverArticle?.standfirst ?? null,
        mediaId: coverMediaId,
        teasers,
      },
      editorial: edition.editorial,
      credits,
      contactEmail: contact?.email ?? null,
      website: contact?.website ?? null,
      campuses: campusRows.map((c) => ({ id: c.id, name: c.name })),
      social: { instagram: contact?.instagram ?? null },
      editionStatus: edition.status,
      planId: plan?.id ?? null,
      planStatus: plan?.status ?? null,
      slug: edition.slug,
    },
    sections: sectionRows.map((s) => ({ id: s.id, slug: s.slug, name: s.name, kicker: s.kicker, colour: s.colour, sortOrder: s.sortOrder })),
    articles: docArticles,
    media,
    pages,
    toc,
    references,
    warnings,
  };

  const parsed = editionDocumentSchema.safeParse(document);
  if (!parsed.success) {
    log.error("document failed schema validation", { issues: parsed.error.issues.slice(0, 5) });
    throw new Error(`EditionDocument schema violation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  log.info("document built", { editionId, articles: docArticles.length, pages: pages.length, media: media.length, warnings: warnings.length });
  return parsed.data;
}

async function resolveCredits(settingRows: { key: string; value: unknown }[], editorInChiefName: string | null) {
  const configured = readSetting<{ role: string; name: string }[]>(settingRows, "credits");
  if (Array.isArray(configured) && configured.length) {
    return configured.filter((c) => c && typeof c.role === "string" && typeof c.name === "string").map((c) => ({ role: c.role, name: c.name }));
  }
  // Fallback: the editorial team is tagged on contributors (editor-in-chief, translator).
  const rows = await db
    .select({ firstName: contributors.firstName, lastName: contributors.lastName, tags: contributors.tags })
    .from(contributors)
    .where(eq(contributors.isActive, true))
    .orderBy(asc(contributors.lastName), asc(contributors.firstName));
  const credits: { role: string; name: string }[] = [];
  for (const [tag, role] of Object.entries(CREDIT_TAGS)) {
    for (const row of rows) {
      if (row.tags.includes(tag)) credits.push({ role, name: `${row.firstName} ${row.lastName}` });
    }
  }
  if (credits.length) return credits;
  return editorInChiefName ? [{ role: "Editor in chief", name: editorInChiefName }] : [];
}

const VOLATILE_KEYS = new Set(["generatedAt", "url", "paginatedAt"]);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => !VOLATILE_KEYS.has(k) && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** sha256 of the document with volatile fields (generatedAt, signed URLs) stripped and keys sorted. */
export function documentHash(doc: EditionDocument): string {
  return createHash("sha256").update(stableStringify(doc)).digest("hex");
}
