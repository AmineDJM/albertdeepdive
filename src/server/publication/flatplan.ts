import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  articles,
  editionSections,
  editions,
  pagePlanPages,
  pagePlans,
  stories,
  type PageFitEstimate,
  type ValidationIssue,
  type ValidationReport,
} from "@/server/db/schema";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { PAGE_TEMPLATES, templateByCode } from "@/lib/constants";
import { countWords, type ArticleBlock, type DocumentPage, type EditionDocument } from "@/lib/publication/document";
import { planEditionPageAllocation } from "@/server/ai/services/page-allocation-planner";
import { buildEditionDocument, documentHash } from "./document-builder";
import { loadDataUriAssets, loadEmbeddedFontCss, measureHtml, withBrowser } from "./pdf";
import { CONTINUATION_TEMPLATE, paginateDocument, type LayoutReport } from "./paginate";
import { renderDocumentHtml } from "./templates";
import { ISSUE_CODES, kindForEditionStatus, layoutReportAsValidation, validateEditionDocument } from "./validate";

/**
 * Read and write model of the flatplan screen.
 *
 * The persisted plan (`page_plans` + `page_plan_pages`) is the editorial intent: which story sits on
 * which page, with which template. The *real* page count is only known once the print engine has
 * flowed the text, so this module also runs the pagination pass (`paginateDocument` with a headless
 * Chromium measurement) and merges its result — continuation pages, fill ratios, copyfit levels —
 * into the same list of pages. The measurement is cached per edition and keyed by a hash of
 * everything that reaches the templates, so it is recomputed exactly when the plan or the content
 * changes and reused otherwise.
 */

const log = createLogger("publication:flatplan");

/** Templates that legitimately carry no article. */
const PAGES_WITHOUT_ARTICLE = new Set(["COVER_A", "COVER_B", "CONTENTS", "SECTION_OPENER", "BACK_PAGE", "QUOTE_PAGE"]);
/** A three-column continuation page holds roughly this many words. */
const CONTINUATION_CAPACITY = 900;
/** Below this fill ratio a text page is reported as under-filled. */
const UNDERFILL_RATIO = 0.55;
const BADLY_UNDERFILLED_RATIO = 0.35;
/** An article may exceed the space booked for it by this much before it is reported as not fitting. */
const OVERSET_TOLERANCE = 1.15;
const MEASURE_TIMEOUT_MS = 60_000;
const SNAPSHOT_CACHE_SIZE = 4;

export const FLATPLAN_TEMPLATES = PAGE_TEMPLATES.map((t) => ({
  code: t.code as string,
  name: t.name,
  family: t.family as string,
  capacityWords: t.capacityWords,
  imageSlots: t.imageSlots,
  description: t.description,
}));

export type FlatplanTemplate = (typeof FLATPLAN_TEMPLATES)[number];

export type FlatplanIssue = ValidationIssue;

export type FlatplanItem = {
  storyId: string;
  articleId: string | null;
  storyTitle: string;
  headline: string;
  kicker: string | null;
  storyType: string;
  articleStatus: string | null;
  wordCount: number;
};

export type FlatplanImage = {
  id: string;
  url: string | null;
  caption: string | null;
  credit: string | null;
  fileName: string | null;
  kind: string;
  rightsStatus: "GREEN" | "YELLOW" | "RED";
};

export type FlatplanPage = {
  /** Stable React key (plan row id, or the layout engine's synthetic continuation id). */
  key: string;
  /** `page_plan_pages.id` for planned pages, the synthetic id for engine-made continuation pages. */
  id: string;
  kind: "plan" | "engine-continuation";
  /** Position in the printed issue (1-based) after the copyfit pass. */
  number: number;
  /** Index among the draggable plan pages, `null` for pages that follow their parent. */
  anchorIndex: number | null;
  template: string;
  templateName: string;
  templateFamily: string;
  capacityWords: number;
  imageSlots: number;
  section: { id: string; name: string; slug: string; colour: string | null } | null;
  items: FlatplanItem[];
  images: FlatplanImage[];
  isLocked: boolean;
  isArticleLocked: boolean;
  isImageLocked: boolean;
  isPlanContinuation: boolean;
  continuationOfNumber: number | null;
  notes: string | null;
  words: number;
  fill: number;
  fillSource: "measured" | "estimated";
  overflow: boolean;
  overflowBlocks: number;
  /** Copyfit steps applied by the engine (each step shrinks the type by 2.5 %). */
  fitLevel: number;
  warnings: FlatplanIssue[];
};

export type FlatplanSectionRun = {
  id: string | null;
  name: string;
  slug: string | null;
  colour: string | null;
  firstPage: number;
  lastPage: number;
  pages: number;
  stories: number;
  /** False when the section's pages are not one continuous run (it cannot be moved as a block). */
  contiguous: boolean;
};

export type FlatplanStoryRef = {
  id: string;
  title: string;
  storyType: string;
  status: string;
  wordCount: number;
  sectionName: string | null;
  page: number | null;
};

export type FlatplanReport = {
  pages: number;
  plannedPages: number;
  continuationPagesAdded: number;
  blocksMoved: number;
  paragraphsSplit: number;
  copyfitFlows: number;
  rounds: number;
  engine: string;
  ok: boolean;
  measuredAt: string;
  /** True when the plan or the content changed after this measurement. */
  stale: boolean;
};

export type Flatplan = {
  edition: {
    id: string;
    label: string;
    issueLabel: string;
    status: string;
    pageSize: string;
    targetPageCount: number;
  };
  plan: {
    id: string;
    name: string;
    status: string;
    pageCount: number;
    updatedAt: string;
    validatedAt: string | null;
  } | null;
  pages: FlatplanPage[];
  sectionRuns: FlatplanSectionRun[];
  /** Every story that can be placed, with the page it currently sits on. */
  stories: FlatplanStoryRef[];
  warnings: FlatplanIssue[];
  report: FlatplanReport | null;
  /** Non-null when the copyfit pass could not run (Chromium missing, render error…). */
  measurementError: string | null;
  stats: {
    pages: number;
    plannedPages: number;
    continuationPages: number;
    spreads: number;
    words: number;
    capacityWords: number;
    images: number;
    lockedPages: number;
    errors: number;
    warnings: number;
    infos: number;
    fill: number;
    signaturePadding: number;
  };
};

// ── Measurement cache ───────────────────────────────────────────────────────

type LayoutSnapshot = { hash: string; at: string; report: LayoutReport; document: EditionDocument };

const snapshots = new Map<string, LayoutSnapshot>();
const inflight = new Map<string, Promise<LayoutSnapshot>>();

/**
 * Hash of everything that changes the printed result. Locks and layout notes are editorial metadata
 * that no template reads, so toggling them must not invalidate a measurement.
 */
function layoutHash(doc: EditionDocument): string {
  return documentHash({ ...doc, pages: doc.pages.map((p) => ({ ...p, isLocked: false, notes: null })) });
}

/** Runs the real print pagination (measure → flow → re-measure) on a document. */
async function measureLayout(doc: EditionDocument): Promise<LayoutSnapshot> {
  const hash = layoutHash(doc);
  const started = Date.now();
  const [fontCss, assets] = await Promise.all([loadEmbeddedFontCss(), loadDataUriAssets(doc, "measure")]);
  const snapshot = await withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      const { document, report } = await paginateDocument(doc, {
        render: (d) => renderDocumentHtml(d, { mode: "print", assetSource: assets.source, fontCss }),
        measure: (html) => measureHtml(page, html),
        engine: `Chromium ${browser.version()}`,
        log: (message, meta) => log.debug(message, meta),
      });
      return { hash, at: new Date().toISOString(), report, document } satisfies LayoutSnapshot;
    } finally {
      await context.close().catch(() => {});
    }
  });
  log.info("copyfit pass finished", { editionId: doc.meta.editionId, pages: snapshot.report.pages, rounds: snapshot.report.rounds, ms: Date.now() - started });
  return snapshot;
}

function rememberSnapshot(editionId: string, snapshot: LayoutSnapshot) {
  snapshots.delete(editionId);
  snapshots.set(editionId, snapshot);
  while (snapshots.size > SNAPSHOT_CACHE_SIZE) {
    const oldest = snapshots.keys().next().value;
    if (!oldest) break;
    snapshots.delete(oldest);
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Returns the copyfit measurement for a document, reusing the cached one when the document has not
 * changed. Concurrent callers share a single browser pass.
 */
async function layoutSnapshotFor(doc: EditionDocument, force = false): Promise<{ snapshot: LayoutSnapshot | null; error: string | null }> {
  const editionId = doc.meta.editionId;
  const hash = layoutHash(doc);
  const cached = snapshots.get(editionId);
  if (!force && cached?.hash === hash) return { snapshot: cached, error: null };
  const key = `${editionId}:${hash}`;
  let pass = inflight.get(key);
  if (!pass) {
    pass = measureLayout(doc).finally(() => inflight.delete(key));
    inflight.set(key, pass);
  }
  try {
    const snapshot = await withTimeout(pass, MEASURE_TIMEOUT_MS, "The copyfit pass took too long and was stopped.");
    rememberSnapshot(editionId, snapshot);
    return { snapshot, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The copyfit pass failed.";
    log.error("copyfit pass failed", { editionId, err });
    return { snapshot: cached ?? null, error: message };
  }
}

/** Drops the cached measurement of an edition (after the plan changed). */
export function invalidateFlatplanLayout(editionId: string) {
  snapshots.delete(editionId);
}

// ── Read model ──────────────────────────────────────────────────────────────

function issueKey(issue: FlatplanIssue) {
  return `${issue.code}:${issue.page ?? ""}:${issue.entityId ?? ""}:${issue.message}`;
}

function severityRank(severity: FlatplanIssue["severity"]) {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function blocksOfSlice(slice: { blockIds: string[]; fragments?: ArticleBlock[] }, body: ArticleBlock[]): ArticleBlock[] {
  const lookup = new Map<string, ArticleBlock>();
  for (const b of body) lookup.set(b.id, b);
  for (const f of slice.fragments ?? []) lookup.set(f.id, f);
  return slice.blockIds.map((id) => lookup.get(id)).filter((b): b is ArticleBlock => !!b);
}

function capacityOf(template: string): { capacityWords: number; imageSlots: number; name: string; family: string } {
  if (template === CONTINUATION_TEMPLATE) {
    return { capacityWords: CONTINUATION_CAPACITY, imageSlots: 3, name: "Continuation", family: "article" };
  }
  const t = templateByCode(template);
  return { capacityWords: t.capacityWords, imageSlots: t.imageSlots, name: t.name, family: t.family };
}

export type GetFlatplanOptions = {
  /** `false` skips the browser pass entirely, `"force"` always re-measures. */
  measure?: boolean | "force";
};

export async function getFlatplan(editionId: string, options: GetFlatplanOptions = {}): Promise<Flatplan> {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");

  const doc = await buildEditionDocument(editionId, { versionLabel: "flatplan", includeUnapproved: true });
  const plan = await activePlan(editionId, { create: false });
  const planRows = plan ? await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id)).orderBy(asc(pagePlanPages.pageNumber)) : [];

  const measureMode = options.measure ?? true;
  const hash = layoutHash(doc);
  const { snapshot, error: measurementError } =
    measureMode === false || !doc.pages.length
      ? { snapshot: snapshots.get(editionId) ?? null, error: null as string | null }
      : await layoutSnapshotFor(doc, measureMode === "force");
  const current = snapshot?.hash === hash;
  const effective = snapshot && current ? snapshot.document : doc;

  const validation = validateEditionDocument(effective, { kind: kindForEditionStatus(edition.status) });
  const layoutIssues = snapshot && current ? layoutReportAsValidation(snapshot.report).issues : [];

  const rowById = new Map(planRows.map((r) => [r.id, r]));
  const articleById = new Map(doc.articles.map((a) => [a.id, a]));
  const mediaById = new Map(doc.media.map((m) => [m.id, m]));
  const sectionById = new Map(doc.sections.map((s) => [s.id, s]));
  const storyIdByArticleId = new Map(doc.articles.map((a) => [a.id, a.storyId]));

  const fillByPageId = new Map<string, number>();
  const overflowByPageId = new Map<string, number>();
  if (snapshot && current) {
    for (const f of snapshot.report.fit) fillByPageId.set(f.pageId, Math.max(fillByPageId.get(f.pageId) ?? 0, f.ratio));
    for (const o of snapshot.report.remainingOverflow) overflowByPageId.set(o.pageId, (overflowByPageId.get(o.pageId) ?? 0) + o.blocks.length);
  }

  // Per-page issues from the validator and the layout report, indexed by page number.
  const issuesByPage = new Map<number, FlatplanIssue[]>();
  const allIssues: FlatplanIssue[] = [];
  const seenIssues = new Set<string>();
  const pushIssue = (issue: FlatplanIssue) => {
    const key = issueKey(issue);
    if (seenIssues.has(key)) return;
    seenIssues.add(key);
    allIssues.push(issue);
    if (issue.page) issuesByPage.set(issue.page, [...(issuesByPage.get(issue.page) ?? []), issue]);
  };
  const LAYOUT_RELEVANT = new Set<string>([
    ISSUE_CODES.RED_RIGHTS,
    ISSUE_CODES.YELLOW_RIGHTS,
    ISSUE_CODES.MISSING_IMAGE_FILE,
    ISSUE_CODES.LOW_RES_HERO,
    ISSUE_CODES.PAGE_WITHOUT_CONTENT,
    ISSUE_CODES.DUPLICATE_ARTICLE_ON_PAGES,
    ISSUE_CODES.PAGE_NUMBERS_INCONSISTENT,
    ISSUE_CODES.COVER_MISSING,
    ISSUE_CODES.SECTION_EMPTY,
    ISSUE_CODES.STORY_NOT_ON_PLAN,
    ISSUE_CODES.ARTICLE_NOT_APPROVED,
    ISSUE_CODES.EMPTY_ARTICLE,
    ISSUE_CODES.NO_ACTIVE_PLAN,
    ISSUE_CODES.ARTICLE_EXCLUDED,
  ]);
  for (const issue of validation.issues) if (LAYOUT_RELEVANT.has(issue.code)) pushIssue(issue);
  for (const issue of layoutIssues) pushIssue(issue);

  // ── Pages ────────────────────────────────────────────────────────────────
  const anchors: string[] = [];
  const pages: FlatplanPage[] = effective.pages.map((p) => {
    const row = rowById.get(p.id);
    const kind: FlatplanPage["kind"] = row ? "plan" : "engine-continuation";
    const isPlanContinuation = !!row?.continuationOfPageId;
    if (kind === "plan" && !isPlanContinuation) anchors.push(p.id);
    const tpl = capacityOf(p.template);
    const items = pageItems(p, articleById, storyIdByArticleId);
    const images = pageImages(p, items, articleById, mediaById);
    const words = pageWords(p, articleById, items);
    const measuredFill = fillByPageId.get(p.id);
    const estimateRatio = row?.fitEstimate?.ratio ?? (tpl.capacityWords ? words / tpl.capacityWords : 0);
    const fill = measuredFill ?? Math.min(1.6, estimateRatio);
    return {
      key: p.id,
      id: p.id,
      kind,
      number: p.number,
      anchorIndex: kind === "plan" && !isPlanContinuation ? anchors.length - 1 : null,
      template: p.template,
      templateName: tpl.name,
      templateFamily: tpl.family,
      capacityWords: tpl.capacityWords,
      imageSlots: tpl.imageSlots,
      section: sectionOf(p, sectionById),
      items,
      images,
      isLocked: row?.isLocked ?? false,
      isArticleLocked: row?.isArticleLocked ?? false,
      isImageLocked: row?.isImageLocked ?? false,
      isPlanContinuation,
      continuationOfNumber: p.continuationOf ?? null,
      notes: row?.notes ?? null,
      words,
      fill,
      fillSource: measuredFill === undefined ? "estimated" : "measured",
      overflow: (overflowByPageId.get(p.id) ?? 0) > 0 || (measuredFill === undefined && estimateRatio > OVERSET_TOLERANCE),
      overflowBlocks: overflowByPageId.get(p.id) ?? 0,
      fitLevel: Math.max(0, ...(p.slices ?? []).map((s) => s.fit ?? 0)),
      warnings: [],
    };
  });

  // ── Computed layout warnings ─────────────────────────────────────────────
  for (const page of pages) {
    if (page.overflow && !overflowByPageId.get(page.id)) {
      const over = Math.round((page.fill - 1) * page.capacityWords);
      pushIssue({
        code: "ESTIMATED_OVERSET",
        severity: "warning",
        message: `Page ${page.number} is planned with about ${over} words more than the ${page.templateName} template holds; the text will spill onto a continuation page.`,
        page: page.number,
        entityId: page.id,
      });
    }
    const textual = page.items.length > 0 && !PAGES_WITHOUT_ARTICLE.has(page.template);
    if (textual && page.fill < UNDERFILL_RATIO && page.fillSource === "measured") {
      pushIssue({
        code: "PAGE_UNDERFILLED",
        severity: page.fill < BADLY_UNDERFILLED_RATIO ? "warning" : "info",
        message: `Page ${page.number} is only ${Math.round(page.fill * 100)} % full (${page.words} of about ${page.capacityWords} words). Consider a denser template or another story on the page.`,
        page: page.number,
        entityId: page.id,
      });
    }
  }
  // An article booked on too little space overall.
  const spaceByArticle = new Map<string, { capacity: number; first: number }>();
  for (const page of pages) {
    for (const item of page.items) {
      if (!item.articleId) continue;
      const entry = spaceByArticle.get(item.articleId) ?? { capacity: 0, first: page.number };
      entry.capacity += page.items.length ? page.capacityWords / page.items.length : page.capacityWords;
      entry.first = Math.min(entry.first, page.number);
      spaceByArticle.set(item.articleId, entry);
    }
  }
  for (const [articleId, space] of spaceByArticle) {
    const article = articleById.get(articleId);
    if (!article || !article.wordCount) continue;
    if (article.wordCount > space.capacity * OVERSET_TOLERANCE) {
      const missing = Math.round(article.wordCount - space.capacity);
      pushIssue({
        code: "ARTICLE_DOES_NOT_FIT",
        severity: "warning",
        message: `"${article.headline || article.storyTitle}" has ${article.wordCount} words for about ${Math.round(space.capacity)} words of space (${missing} words too many).`,
        page: space.first,
        entityId: articleId,
      });
    }
  }
  for (const page of pages) page.warnings = (issuesByPage.get(page.number) ?? []).slice().sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  // ── Section running order ────────────────────────────────────────────────
  const sectionRuns: FlatplanSectionRun[] = [];
  const seenSections = new Map<string, FlatplanSectionRun>();
  for (const page of pages) {
    const id = page.section?.id ?? null;
    const key = id ?? "__none";
    const previous = sectionRuns[sectionRuns.length - 1];
    const existing = seenSections.get(key);
    if (previous && (previous.id ?? "__none") === key) {
      previous.lastPage = page.number;
      previous.pages += 1;
      previous.stories += page.items.length;
    } else if (existing) {
      existing.lastPage = page.number;
      existing.pages += 1;
      existing.stories += page.items.length;
      existing.contiguous = false;
    } else {
      const run: FlatplanSectionRun = {
        id,
        name: page.section?.name ?? "Unassigned",
        slug: page.section?.slug ?? null,
        colour: page.section?.colour ?? null,
        firstPage: page.number,
        lastPage: page.number,
        pages: 1,
        stories: page.items.length,
        contiguous: true,
      };
      seenSections.set(key, run);
      sectionRuns.push(run);
    }
  }

  // ── Stories that can be placed, and the page they sit on ─────────────────
  const pageOfStory = new Map<string, number>();
  for (const page of pages) for (const item of page.items) if (!pageOfStory.has(item.storyId)) pageOfStory.set(item.storyId, page.number);
  const storyRows = await db
    .select({
      id: stories.id,
      title: stories.title,
      storyType: stories.storyType,
      status: stories.status,
      sectionId: stories.sectionId,
      wordCount: sql<number>`coalesce(${articles.wordCount}, 0)`,
    })
    .from(stories)
    .leftJoin(articles, eq(articles.storyId, stories.id))
    .where(and(eq(stories.editionId, editionId), inArray(stories.status, ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED"])))
    .orderBy(desc(stories.priority), asc(stories.title));
  const storyRefs: FlatplanStoryRef[] = storyRows.map((s) => ({
    id: s.id,
    title: s.title,
    storyType: s.storyType,
    status: s.status,
    wordCount: Number(s.wordCount) || 0,
    sectionName: s.sectionId ? (sectionById.get(s.sectionId)?.name ?? null) : null,
    page: pageOfStory.get(s.id) ?? null,
  }));

  const words = pages.reduce((n, p) => n + p.words, 0);
  const capacityWords = pages.reduce((n, p) => n + p.capacityWords, 0);
  const filled = pages.filter((p) => p.items.length > 0 || p.fill > 0);
  const averageFill = filled.length ? filled.reduce((n, p) => n + Math.min(1, p.fill), 0) / filled.length : 0;
  const continuationPages = pages.filter((p) => p.kind === "engine-continuation").length;
  const counts = { errors: 0, warnings: 0, infos: 0 };
  for (const issue of allIssues) counts[issue.severity === "error" ? "errors" : issue.severity === "warning" ? "warnings" : "infos"] += 1;

  return {
    edition: {
      id: edition.id,
      label: edition.label,
      issueLabel: doc.meta.issueLabel,
      status: edition.status,
      pageSize: `${doc.meta.pageSize.name} · ${doc.meta.pageSize.widthMm}×${doc.meta.pageSize.heightMm} mm`,
      targetPageCount: edition.targetPageCount,
    },
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          status: plan.status,
          pageCount: planRows.length,
          updatedAt: plan.updatedAt.toISOString(),
          validatedAt: plan.validationReport?.checkedAt ?? null,
        }
      : null,
    pages,
    sectionRuns,
    stories: storyRefs,
    warnings: allIssues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.page ?? 0) - (b.page ?? 0) || a.code.localeCompare(b.code)),
    report: snapshot
      ? {
          pages: snapshot.report.pages,
          plannedPages: snapshot.report.plannedPages,
          continuationPagesAdded: snapshot.report.continuationPagesAdded,
          blocksMoved: snapshot.report.blocksMoved,
          paragraphsSplit: snapshot.report.paragraphsSplit,
          copyfitFlows: snapshot.report.copyfitFlows,
          rounds: snapshot.report.rounds,
          engine: snapshot.report.engine,
          ok: snapshot.report.ok,
          measuredAt: snapshot.at,
          stale: !current,
        }
      : null,
    measurementError,
    stats: {
      pages: pages.length,
      plannedPages: planRows.length,
      continuationPages,
      spreads: pages.length ? 1 + Math.ceil((pages.length - 1) / 2) : 0,
      words,
      capacityWords,
      images: new Set(pages.flatMap((p) => p.images.map((i) => i.id))).size,
      lockedPages: pages.filter((p) => p.isLocked).length,
      errors: counts.errors,
      warnings: counts.warnings,
      infos: counts.infos,
      fill: averageFill,
      signaturePadding: pages.length % 4 === 0 ? 0 : 4 - (pages.length % 4),
    },
  };
}

function sectionOf(page: DocumentPage, sectionById: Map<string, EditionDocument["sections"][number]>) {
  const section = page.sectionId ? sectionById.get(page.sectionId) : undefined;
  return section ? { id: section.id, name: section.name, slug: section.slug, colour: section.colour } : null;
}

function pageItems(page: DocumentPage, articleById: Map<string, EditionDocument["articles"][number]>, storyIdByArticleId: Map<string, string>): FlatplanItem[] {
  return page.articleIds
    .map((id) => articleById.get(id))
    .filter((a): a is EditionDocument["articles"][number] => !!a)
    .map((a) => ({
      storyId: storyIdByArticleId.get(a.id) ?? a.storyId,
      articleId: a.id,
      storyTitle: a.storyTitle ?? a.headline,
      headline: a.headline || a.storyTitle || "Untitled",
      kicker: a.kicker,
      storyType: a.storyType,
      articleStatus: a.status,
      wordCount: a.wordCount,
    }));
}

function pageImages(
  page: DocumentPage,
  items: FlatplanItem[],
  articleById: Map<string, EditionDocument["articles"][number]>,
  mediaById: Map<string, EditionDocument["media"][number]>,
): FlatplanImage[] {
  const ids: string[] = [...page.mediaIds];
  for (const item of items) {
    const article = item.articleId ? articleById.get(item.articleId) : undefined;
    if (!article) continue;
    if (article.heroMediaId) ids.push(article.heroMediaId);
    for (const m of article.media) ids.push(m.mediaId);
    if (article.bdd) {
      for (const id of [article.bdd.logoMediaId, article.bdd.teamPhotoMediaId, article.bdd.dashboardMediaId, article.bdd.diagramMediaId]) if (id) ids.push(id);
    }
    for (const block of article.body) if (block.type === "image") ids.push(block.assetId);
  }
  const seen = new Set<string>();
  const out: FlatplanImage[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const media = mediaById.get(id);
    if (!media) continue;
    out.push({
      id: media.id,
      url: media.src.thumb?.url ?? media.src.web?.url ?? null,
      caption: media.caption,
      credit: media.credit ?? media.photographer ?? null,
      fileName: media.fileName ?? null,
      kind: media.kind,
      rightsStatus: media.rightsStatus,
    });
  }
  return out;
}

function pageWords(page: DocumentPage, articleById: Map<string, EditionDocument["articles"][number]>, items: FlatplanItem[]): number {
  if (page.slices?.length) {
    return page.slices.reduce((n, slice) => {
      const article = articleById.get(slice.articleId);
      if (!article) return n;
      return n + countWords(blocksOfSlice(slice, article.body));
    }, 0);
  }
  return items.reduce((n, item) => n + item.wordCount, 0);
}

// ── Mutations ───────────────────────────────────────────────────────────────

type PlanRow = typeof pagePlans.$inferSelect;

async function activePlan(editionId: string, options: { create: boolean; userId?: string | null }): Promise<PlanRow | null> {
  const found = await db.query.pagePlans.findFirst({
    where: and(eq(pagePlans.editionId, editionId), eq(pagePlans.isActive, true)),
    orderBy: [desc(pagePlans.createdAt)],
  });
  if (found || !options.create) return found ?? null;
  const [created] = await db.insert(pagePlans).values({ editionId, name: "Flatplan", createdById: options.userId ?? null }).returning();
  return created;
}

async function requirePlanPage(editionId: string, pageId: string) {
  const row = await db.query.pagePlanPages.findFirst({ where: eq(pagePlanPages.id, pageId) });
  if (!row) throw new NotFoundError("Page");
  const plan = await db.query.pagePlans.findFirst({ where: eq(pagePlans.id, row.planId) });
  if (!plan || plan.editionId !== editionId) throw new NotFoundError("Page");
  return { row, plan };
}

function estimateFor(template: string, contentWords: number, imagesUsed: number): PageFitEstimate {
  const tpl = capacityOf(template);
  const ratio = tpl.capacityWords ? contentWords / tpl.capacityWords : 0;
  return {
    capacityWords: tpl.capacityWords,
    contentWords,
    ratio: Math.round(ratio * 100) / 100,
    overflow: ratio > OVERSET_TOLERANCE,
    imagesSlots: tpl.imageSlots,
    imagesUsed: Math.min(tpl.imageSlots, imagesUsed),
  };
}

/** Total word count of the articles of a set of stories (fallback when a page has no estimate yet). */
async function wordsOnPage(storyIds: string[]): Promise<number> {
  if (!storyIds.length) return 0;
  const rows = await db.select({ wordCount: articles.wordCount }).from(articles).where(inArray(articles.storyId, storyIds));
  return rows.reduce((n, r) => n + r.wordCount, 0);
}

async function touchPlan(planId: string) {
  await db.update(pagePlans).set({ updatedAt: new Date() }).where(eq(pagePlans.id, planId));
}

/**
 * Re-runs the deterministic page allocator and rewrites the plan. Locked pages keep their page
 * number and their content: their stories are removed from the allocation and the newly allocated
 * pages flow around them.
 */
export async function regeneratePagePlan(
  editionId: string,
  options: { userId?: string | null; includeCandidates?: boolean } = {},
): Promise<{ pages: number; locked: number; warnings: string[] }> {
  const plan = await activePlan(editionId, { create: true, userId: options.userId });
  if (!plan) throw new NotFoundError("Page plan");
  const allocation = await planEditionPageAllocation(editionId, { includeCandidates: options.includeCandidates });
  const sectionRows = await db.select().from(editionSections).where(eq(editionSections.editionId, editionId));
  const sectionIdBySlug = new Map(sectionRows.map((s) => [s.slug, s.id]));
  const existing = await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id)).orderBy(asc(pagePlanPages.pageNumber));
  const locked = existing.filter((r) => r.isLocked);
  const lockedStoryIds = new Set(locked.flatMap((r) => [...(r.storyId ? [r.storyId] : []), ...r.storyIds]));

  // Stories that sit on a locked page are not allocated again; a page left without any of its
  // stories disappears, while structural pages (cover, contents, back page) always stay — unless a
  // locked page already plays that role, in which case the allocator's version is dropped.
  const lockedCovers = locked.some((r) => capacityOf(r.template).family === "cover");
  const lockedTemplates = new Set(locked.map((r) => r.template));
  const allocated = allocation.pages
    .map((p) => ({ page: p, kept: p.storyIds.filter((id) => !lockedStoryIds.has(id)) }))
    .filter(({ page, kept }) => kept.length > 0 || page.storyIds.length === 0)
    .filter(({ page }) => {
      if (lockedCovers && capacityOf(page.template).family === "cover") return false;
      if ((page.template === "CONTENTS" || page.template === "BACK_PAGE") && lockedTemplates.has(page.template)) return false;
      return true;
    })
    .map(({ page, kept }) => ({ ...page, storyIds: kept }));

  const articleRows = await db.select({ id: articles.id, storyId: articles.storyId, wordCount: articles.wordCount }).from(articles).where(eq(articles.editionId, editionId));
  const articleByStory = new Map(articleRows.map((a) => [a.storyId, a]));

  type Slot = { kind: "locked"; row: (typeof existing)[number] } | { kind: "new"; page: (typeof allocated)[number] };
  const lockedByNumber = new Map(locked.map((r) => [r.pageNumber, r]));
  const slots: Slot[] = [];
  const total = allocated.length + locked.length;
  let next = 0;
  for (let n = 1; slots.length < total; n += 1) {
    const lockedRow = lockedByNumber.get(n);
    if (lockedRow) {
      slots.push({ kind: "locked", row: lockedRow });
      lockedByNumber.delete(n);
      continue;
    }
    if (next < allocated.length) slots.push({ kind: "new", page: allocated[next++] });
    else if (lockedByNumber.size) {
      const [number] = [...lockedByNumber.keys()].sort((a, b) => a - b);
      slots.push({ kind: "locked", row: lockedByNumber.get(number)! });
      lockedByNumber.delete(number);
    } else break;
  }

  // Allocation page number → final page number, so continuation links can be rebuilt afterwards.
  const finalNumberByAllocation = new Map<number, number>();
  slots.forEach((slot, i) => {
    if (slot.kind === "new") finalNumberByAllocation.set(slot.page.pageNumber, i + 1);
  });

  await db.transaction(async (tx) => {
    const lockedIds = locked.map((r) => r.id);
    if (lockedIds.length) {
      await tx.delete(pagePlanPages).where(and(eq(pagePlanPages.planId, plan.id), notInArray(pagePlanPages.id, lockedIds)));
      // Park locked rows on negative numbers so the freshly inserted pages cannot collide with them.
      for (const row of locked) await tx.update(pagePlanPages).set({ pageNumber: -row.pageNumber }).where(eq(pagePlanPages.id, row.id));
    } else {
      await tx.delete(pagePlanPages).where(eq(pagePlanPages.planId, plan.id));
    }
    const idByNumber = new Map<number, string>();
    for (const [index, slot] of slots.entries()) {
      const pageNumber = index + 1;
      if (slot.kind === "locked") {
        await tx.update(pagePlanPages).set({ pageNumber }).where(eq(pagePlanPages.id, slot.row.id));
        idByNumber.set(pageNumber, slot.row.id);
        continue;
      }
      const page = slot.page;
      const storyId = page.storyIds[0] ?? null;
      const article = storyId ? articleByStory.get(storyId) : undefined;
      const [inserted] = await tx
        .insert(pagePlanPages)
        .values({
          planId: plan.id,
          pageNumber,
          sectionId: sectionIdBySlug.get(page.sectionSlug) ?? null,
          template: page.template,
          storyId,
          articleId: article?.id ?? null,
          storyIds: page.storyIds,
          mediaAssetIds: [],
          fitEstimate: {
            capacityWords: page.capacityWords,
            contentWords: page.contentWords,
            ratio: page.capacityWords ? Math.round((page.contentWords / page.capacityWords) * 100) / 100 : 0,
            overflow: page.contentWords > page.capacityWords * OVERSET_TOLERANCE,
            imagesSlots: page.imageSlots,
            imagesUsed: page.mediaSlotsUsed,
          },
          warnings: [],
        })
        .returning({ id: pagePlanPages.id });
      idByNumber.set(pageNumber, inserted.id);
    }
    // Continuation links, now that every page has its final number.
    for (const [index, slot] of slots.entries()) {
      if (slot.kind !== "new" || !slot.page.continuation || slot.page.continuationOfPage === null) continue;
      const parentNumber = finalNumberByAllocation.get(slot.page.continuationOfPage);
      const parentId = parentNumber ? idByNumber.get(parentNumber) : undefined;
      const selfId = idByNumber.get(index + 1);
      if (parentId && selfId) await tx.update(pagePlanPages).set({ continuationOfPageId: parentId }).where(eq(pagePlanPages.id, selfId));
    }
    await tx.update(pagePlans).set({ pageCount: slots.length, generatedByAi: true, updatedAt: new Date() }).where(eq(pagePlans.id, plan.id));
  });

  invalidateFlatplanLayout(editionId);
  await audit({
    action: "flatplan.regenerate",
    userId: options.userId,
    entityType: "PAGE_PLAN",
    entityId: plan.id,
    editionId,
    metadata: { pages: slots.length, locked: locked.length, warnings: allocation.warnings.length },
  });
  // The allocator counts its own pages; page-count advice is recomputed for the merged plan and
  // shown in the flatplan statistics, so only the placement notes are passed on.
  const warnings = allocation.warnings.filter((w) => !/multiple of 4|exceed the target/i.test(w));
  return { pages: slots.length, locked: locked.length, warnings };
}

export async function setPageTemplate(editionId: string, pageId: string, template: string, userId?: string | null): Promise<{ template: string; pageNumber: number }> {
  if (!PAGE_TEMPLATES.some((t) => t.code === template)) throw new ValidationError(`Unknown template "${template}"`);
  const { row, plan } = await requirePlanPage(editionId, pageId);
  const contentWords = row.fitEstimate?.contentWords ?? (await wordsOnPage(row.storyIds.length ? row.storyIds : row.storyId ? [row.storyId] : []));
  await db
    .update(pagePlanPages)
    .set({ template, fitEstimate: estimateFor(template, contentWords, row.fitEstimate?.imagesUsed ?? row.mediaAssetIds.length) })
    .where(eq(pagePlanPages.id, pageId));
  await touchPlan(plan.id);
  invalidateFlatplanLayout(editionId);
  await audit({ action: "flatplan.page.template", userId, entityType: "PAGE", entityId: pageId, editionId, metadata: { from: row.template, to: template, page: row.pageNumber } });
  return { template, pageNumber: row.pageNumber };
}

/**
 * Persists a new running order. `orderedAnchorIds` lists the draggable pages; each one keeps the
 * planned continuation pages that follow it, so an article never gets separated from its jump page.
 */
export async function reorderPlanPages(editionId: string, orderedAnchorIds: string[], userId?: string | null): Promise<{ pages: number }> {
  const plan = await activePlan(editionId, { create: false });
  if (!plan) throw new NotFoundError("Page plan");
  const rows = await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id)).orderBy(asc(pagePlanPages.pageNumber));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const anchors = rows.filter((r) => !r.continuationOfPageId).map((r) => r.id);
  if (orderedAnchorIds.length !== anchors.length || orderedAnchorIds.some((id) => !byId.has(id))) {
    throw new ValidationError("The page order is out of date. Refresh the flatplan and try again.");
  }
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.continuationOfPageId) continue;
    childrenByParent.set(row.continuationOfPageId, [...(childrenByParent.get(row.continuationOfPageId) ?? []), row.id]);
  }
  const finalOrder: string[] = [];
  for (const id of orderedAnchorIds) {
    finalOrder.push(id, ...(childrenByParent.get(id) ?? []));
  }
  for (const row of rows) if (!finalOrder.includes(row.id)) finalOrder.push(row.id);
  const unchanged = finalOrder.every((id, i) => rows[i]?.id === id);
  if (unchanged) return { pages: rows.length };

  await db.transaction(async (tx) => {
    for (const row of rows) await tx.update(pagePlanPages).set({ pageNumber: -row.pageNumber }).where(eq(pagePlanPages.id, row.id));
    for (const [index, id] of finalOrder.entries()) await tx.update(pagePlanPages).set({ pageNumber: index + 1 }).where(eq(pagePlanPages.id, id));
    await tx.update(pagePlans).set({ pageCount: finalOrder.length, updatedAt: new Date() }).where(eq(pagePlans.id, plan.id));
  });
  invalidateFlatplanLayout(editionId);
  await audit({ action: "flatplan.reorder", userId, entityType: "PAGE_PLAN", entityId: plan.id, editionId, metadata: { pages: finalOrder.length } });
  return { pages: finalOrder.length };
}

/** Moves one page (with its planned continuations) up or down in the running order. */
export async function movePlanPage(editionId: string, pageId: string, direction: "up" | "down", userId?: string | null): Promise<{ pages: number }> {
  const plan = await activePlan(editionId, { create: false });
  if (!plan) throw new NotFoundError("Page plan");
  const rows = await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id)).orderBy(asc(pagePlanPages.pageNumber));
  const anchors = rows.filter((r) => !r.continuationOfPageId).map((r) => r.id);
  const index = anchors.indexOf(pageId);
  if (index < 0) throw new ValidationError("This page follows another page and moves with it.");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= anchors.length) throw new ValidationError(direction === "up" ? "This page is already first." : "This page is already last.");
  const next = [...anchors];
  [next[index], next[target]] = [next[target], next[index]];
  return reorderPlanPages(editionId, next, userId);
}

/** Moves a whole section (its continuous run of pages) before the previous / after the next one. */
export async function moveSectionRun(editionId: string, sectionId: string | null, direction: "up" | "down", userId?: string | null): Promise<{ pages: number }> {
  const plan = await activePlan(editionId, { create: false });
  if (!plan) throw new NotFoundError("Page plan");
  const rows = await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id)).orderBy(asc(pagePlanPages.pageNumber));
  const anchors = rows.filter((r) => !r.continuationOfPageId);
  const key = (row: (typeof anchors)[number]) => row.sectionId ?? "__none";
  const wanted = sectionId ?? "__none";
  const runs: { key: string; ids: string[] }[] = [];
  for (const row of anchors) {
    const previous = runs[runs.length - 1];
    if (previous && previous.key === key(row)) previous.ids.push(row.id);
    else runs.push({ key: key(row), ids: [row.id] });
  }
  const index = runs.findIndex((r) => r.key === wanted);
  if (index < 0) throw new ValidationError("This section has no page in the plan.");
  if (runs.filter((r) => r.key === wanted).length > 1) throw new ValidationError("This section's pages are not next to each other; move the pages individually.");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= runs.length) throw new ValidationError(direction === "up" ? "This section is already first." : "This section is already last.");
  const next = [...runs];
  [next[index], next[target]] = [next[target], next[index]];
  return reorderPlanPages(editionId, next.flatMap((r) => r.ids), userId);
}

export async function setPageFlags(
  editionId: string,
  pageId: string,
  patch: { isLocked?: boolean; isArticleLocked?: boolean; isImageLocked?: boolean },
  userId?: string | null,
): Promise<{ isLocked: boolean; isArticleLocked: boolean; isImageLocked: boolean; pageNumber: number }> {
  const { row, plan } = await requirePlanPage(editionId, pageId);
  const nextValues = {
    isLocked: patch.isLocked ?? row.isLocked,
    isArticleLocked: patch.isArticleLocked ?? row.isArticleLocked,
    isImageLocked: patch.isImageLocked ?? row.isImageLocked,
  };
  await db.update(pagePlanPages).set(nextValues).where(eq(pagePlanPages.id, pageId));
  await touchPlan(plan.id);
  await audit({ action: "flatplan.page.lock", userId, entityType: "PAGE", entityId: pageId, editionId, metadata: { ...nextValues, page: row.pageNumber } });
  return { ...nextValues, pageNumber: row.pageNumber };
}

/** Pins a story (and its article) to a page, or clears the page. Pinning locks the page by default. */
export async function setPageStory(
  editionId: string,
  pageId: string,
  storyId: string | null,
  options: { pin?: boolean; userId?: string | null } = {},
): Promise<{ pageNumber: number; storyTitle: string | null }> {
  const { row, plan } = await requirePlanPage(editionId, pageId);
  if (!storyId) {
    await db.update(pagePlanPages).set({ storyId: null, articleId: null, storyIds: [], fitEstimate: estimateFor(row.template, 0, 0), warnings: [] }).where(eq(pagePlanPages.id, pageId));
    // Pages planned as a second page for this story have nothing left to show either.
    await db.update(pagePlanPages).set({ storyId: null, articleId: null, storyIds: [] }).where(eq(pagePlanPages.continuationOfPageId, pageId));
    await touchPlan(plan.id);
    invalidateFlatplanLayout(editionId);
    await audit({ action: "flatplan.page.story", userId: options.userId, entityType: "PAGE", entityId: pageId, editionId, metadata: { cleared: true, page: row.pageNumber } });
    return { pageNumber: row.pageNumber, storyTitle: null };
  }
  const story = await db.query.stories.findFirst({ where: and(eq(stories.id, storyId), eq(stories.editionId, editionId)) });
  if (!story) throw new NotFoundError("Story");
  const article = await db.query.articles.findFirst({ where: eq(articles.storyId, storyId) });
  // A story lives on one page (plus that page's own continuations): take it off any other page.
  const siblings = await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id));
  for (const other of siblings) {
    if (other.id === pageId || other.continuationOfPageId === pageId) continue;
    const onPage = other.storyId === storyId || other.storyIds.includes(storyId);
    if (!onPage) continue;
    const remaining = other.storyIds.filter((id) => id !== storyId);
    const nextStoryId = other.storyId === storyId ? (remaining[0] ?? null) : other.storyId;
    const nextArticle = nextStoryId ? await db.query.articles.findFirst({ where: eq(articles.storyId, nextStoryId) }) : undefined;
    await db.update(pagePlanPages).set({ storyIds: remaining, storyId: nextStoryId, articleId: nextArticle?.id ?? null }).where(eq(pagePlanPages.id, other.id));
  }
  await db
    .update(pagePlanPages)
    .set({
      storyId,
      articleId: article?.id ?? null,
      storyIds: [storyId],
      sectionId: row.sectionId ?? story.sectionId ?? null,
      isLocked: options.pin ?? row.isLocked,
      fitEstimate: estimateFor(row.template, article?.wordCount ?? 0, row.mediaAssetIds.length),
    })
    .where(eq(pagePlanPages.id, pageId));
  await touchPlan(plan.id);
  invalidateFlatplanLayout(editionId);
  await audit({ action: "flatplan.page.story", userId: options.userId, entityType: "PAGE", entityId: pageId, editionId, metadata: { storyId, page: row.pageNumber, pinned: options.pin ?? row.isLocked } });
  return { pageNumber: row.pageNumber, storyTitle: story.title };
}

export async function setPageNotes(editionId: string, pageId: string, notes: string | null, userId?: string | null): Promise<{ pageNumber: number }> {
  const { row, plan } = await requirePlanPage(editionId, pageId);
  const clean = notes?.trim() ? notes.trim().slice(0, 500) : null;
  await db.update(pagePlanPages).set({ notes: clean }).where(eq(pagePlanPages.id, pageId));
  await touchPlan(plan.id);
  await audit({ action: "flatplan.page.notes", userId, entityType: "PAGE", entityId: pageId, editionId, metadata: { page: row.pageNumber } });
  return { pageNumber: row.pageNumber };
}

/**
 * Runs the copyfit pass and stores its outcome on the plan: the layout report on the plan itself and
 * the measured fill / overflow of every planned page (so the numbers survive a restart).
 */
export async function runCopyfitPass(editionId: string, userId?: string | null): Promise<FlatplanReport> {
  const doc = await buildEditionDocument(editionId, { versionLabel: "flatplan", includeUnapproved: true });
  const { snapshot, error } = await layoutSnapshotFor(doc, true);
  if (!snapshot || error) throw new ValidationError(error ?? "The copyfit pass could not run.");
  const plan = await activePlan(editionId, { create: false });
  if (plan) {
    const report: ValidationReport = layoutReportAsValidation(snapshot.report);
    const rows = await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id));
    const fillByPageId = new Map<string, number>();
    const overflowByPageId = new Map<string, number>();
    for (const f of snapshot.report.fit) fillByPageId.set(f.pageId, Math.max(fillByPageId.get(f.pageId) ?? 0, f.ratio));
    for (const o of snapshot.report.remainingOverflow) overflowByPageId.set(o.pageId, (overflowByPageId.get(o.pageId) ?? 0) + o.blocks.length);
    const numberById = new Map(snapshot.document.pages.map((p) => [p.id, p.number]));
    for (const row of rows) {
      const fill = fillByPageId.get(row.id);
      const overflow = overflowByPageId.get(row.id) ?? 0;
      const estimate = row.fitEstimate;
      const warnings = overflow
        ? [{ code: ISSUE_CODES.TEXT_OVERFLOW, severity: "error" as const, message: `${overflow} block(s) still overflow after the copyfit pass.` }]
        : [];
      await db
        .update(pagePlanPages)
        .set({
          fitEstimate: estimate ? { ...estimate, ratio: fill === undefined ? estimate.ratio : Math.round(fill * 100) / 100, overflow: overflow > 0 } : estimate,
          warnings,
        })
        .where(eq(pagePlanPages.id, row.id));
    }
    await db.update(pagePlans).set({ validationReport: report, pageCount: rows.length, updatedAt: new Date() }).where(eq(pagePlans.id, plan.id));
    log.info("copyfit persisted", { editionId, planId: plan.id, pages: numberById.size });
  }
  await audit({
    action: "flatplan.copyfit",
    userId,
    entityType: "PAGE_PLAN",
    entityId: plan?.id ?? null,
    editionId,
    metadata: { pages: snapshot.report.pages, rounds: snapshot.report.rounds, continuation: snapshot.report.continuationPagesAdded },
  });
  return {
    pages: snapshot.report.pages,
    plannedPages: snapshot.report.plannedPages,
    continuationPagesAdded: snapshot.report.continuationPagesAdded,
    blocksMoved: snapshot.report.blocksMoved,
    paragraphsSplit: snapshot.report.paragraphsSplit,
    copyfitFlows: snapshot.report.copyfitFlows,
    rounds: snapshot.report.rounds,
    engine: snapshot.report.engine,
    ok: snapshot.report.ok,
    measuredAt: snapshot.at,
    stale: false,
  };
}
