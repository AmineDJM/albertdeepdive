import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { editions, publicationAssets, publicationVersions, qualityGateOverrides, users } from "@/server/db/schema";
import type { ValidationIssue, ValidationReport } from "@/server/db/schema";
import type { EditionDocument } from "@/lib/publication/document";
import { buildEditionDocument } from "./document-builder";
import type { LayoutReport } from "./paginate";

/**
 * Structural validation of an EditionDocument (pure) and the edition-level quality gates (DB).
 * Issue codes are stable identifiers the UI and tests rely on.
 */

export type PublicationKind = "DRAFT" | "EDITORIAL_REVIEW" | "FINAL_REVIEW" | "PUBLISHED";

export const ISSUE_CODES = {
  RED_RIGHTS: "RED_RIGHTS",
  YELLOW_RIGHTS: "YELLOW_RIGHTS",
  MISSING_CAPTION: "MISSING_CAPTION",
  MISSING_CREDIT: "MISSING_CREDIT",
  MISSING_IMAGE_FILE: "MISSING_IMAGE_FILE",
  LOW_RES_HERO: "LOW_RES_HERO",
  ARTICLE_NOT_APPROVED: "ARTICLE_NOT_APPROVED",
  EMPTY_ARTICLE: "EMPTY_ARTICLE",
  HEADLINE_TOO_LONG: "HEADLINE_TOO_LONG",
  MISSING_STANDFIRST: "MISSING_STANDFIRST",
  MISSING_BYLINE: "MISSING_BYLINE",
  UNRESOLVED_CONFLICT: "UNRESOLVED_CONFLICT",
  MISSING_SOURCE: "MISSING_SOURCE",
  PAGE_WITHOUT_CONTENT: "PAGE_WITHOUT_CONTENT",
  DUPLICATE_ARTICLE_ON_PAGES: "DUPLICATE_ARTICLE_ON_PAGES",
  TOC_MISMATCH: "TOC_MISMATCH",
  COVER_MISSING: "COVER_MISSING",
  SECTION_EMPTY: "SECTION_EMPTY",
  PAGE_NUMBERS_INCONSISTENT: "PAGE_NUMBERS_INCONSISTENT",
  NO_ACTIVE_PLAN: "NO_ACTIVE_PLAN",
  ARTICLE_EXCLUDED: "ARTICLE_EXCLUDED",
  STORY_NOT_ON_PLAN: "STORY_NOT_ON_PLAN",
  // layout report codes
  TEXT_OVERFLOW: "TEXT_OVERFLOW",
  BLANK_PAGE: "BLANK_PAGE",
  IMAGE_FAILED: "IMAGE_FAILED",
  PAGE_COUNT_MISMATCH: "PAGE_COUNT_MISMATCH",
  CONTINUATION_UNDERFULL: "CONTINUATION_UNDERFULL",
} as const;

export const HEADLINE_MAX_LENGTH = 90;
export const HERO_MIN_PRINT_WIDTH = 1400;
const APPROVED = new Set(["APPROVED", "LOCKED"]);
const PAGES_WITHOUT_ARTICLE = new Set(["COVER_A", "COVER_B", "CONTENTS", "SECTION_OPENER", "BACK_PAGE"]);
const VISUAL_COMPANIONS = new Set(["BDD_VISUAL", "PHOTO_STORY", "QUOTE_PAGE"]);
const STRUCTURAL_SECTIONS = new Set(["cover", "this-month", "back-page"]);

export function validateEditionDocument(doc: EditionDocument, options: { kind: PublicationKind }): ValidationReport {
  const strict = options.kind === "FINAL_REVIEW" || options.kind === "PUBLISHED";
  const issues: ValidationIssue[] = [];
  const push = (issue: ValidationIssue) => issues.push(issue);
  const mediaById = new Map(doc.media.map((m) => [m.id, m]));
  const articleById = new Map(doc.articles.map((a) => [a.id, a]));
  const firstPage = new Map<string, number>();
  const pagesOfArticle = new Map<string, EditionDocument["pages"]>();
  for (const page of doc.pages) {
    for (const id of page.articleIds) {
      if (!firstPage.has(id)) firstPage.set(id, page.number);
      pagesOfArticle.set(id, [...(pagesOfArticle.get(id) ?? []), page]);
    }
  }
  const plannedArticles = doc.articles.filter((a) => firstPage.has(a.id));

  // ── Builder warnings that are structural problems ────────────────────────
  for (const w of doc.warnings) {
    if (w.code === "MISSING_MEDIA_FILE") push({ code: ISSUE_CODES.MISSING_IMAGE_FILE, severity: "error", message: w.message, entityId: w.entityId });
    else if (w.code === "NO_ACTIVE_PLAN" || w.code === "UNKNOWN_STORY_ON_PAGE" || w.code === "STORY_WITHOUT_ARTICLE") push({ ...w, severity: "error" });
    else if (w.code === "ARTICLE_EXCLUDED") push({ code: ISSUE_CODES.ARTICLE_EXCLUDED, severity: strict ? "error" : "warning", message: w.message, entityId: w.entityId });
    else if (w.code === "STORY_NOT_ON_PLAN") push({ code: ISSUE_CODES.STORY_NOT_ON_PLAN, severity: "info", message: w.message, entityId: w.entityId });
  }

  // ── Media in use ─────────────────────────────────────────────────────────
  const usedMedia = new Map<string, { page?: number; articleId?: string }>();
  const markUsed = (id: string | null | undefined, ctx: { page?: number; articleId?: string }) => {
    if (id && mediaById.has(id) && !usedMedia.has(id)) usedMedia.set(id, ctx);
  };
  markUsed(doc.meta.cover.mediaId, { page: doc.pages.find((p) => p.template.startsWith("COVER"))?.number });
  for (const page of doc.pages) for (const id of page.mediaIds) markUsed(id, { page: page.number });
  for (const article of plannedArticles) {
    const page = firstPage.get(article.id);
    markUsed(article.heroMediaId, { page, articleId: article.id });
    for (const m of article.media) markUsed(m.mediaId, { page, articleId: article.id });
    if (article.bdd) for (const id of [article.bdd.logoMediaId, article.bdd.teamPhotoMediaId, article.bdd.dashboardMediaId, article.bdd.diagramMediaId]) markUsed(id, { page, articleId: article.id });
    for (const b of article.body) if (b.type === "image") markUsed(b.assetId, { page, articleId: article.id });
  }
  for (const [id, ctx] of usedMedia) {
    const media = mediaById.get(id)!;
    const label = media.caption || media.fileName || id;
    if (media.rightsStatus === "RED") push({ code: ISSUE_CODES.RED_RIGHTS, severity: "error", message: `"${label}" is marked RED (do not publish).`, page: ctx.page, entityId: id });
    else if (media.rightsStatus === "YELLOW") push({ code: ISSUE_CODES.YELLOW_RIGHTS, severity: "warning", message: `"${label}": image rights are unclear (YELLOW).`, page: ctx.page, entityId: id });
    if (!media.caption && media.kind !== "logo") push({ code: ISSUE_CODES.MISSING_CAPTION, severity: "warning", message: `"${media.fileName ?? id}" has no caption.`, page: ctx.page, entityId: id });
    if (!media.credit && !media.photographer && media.kind === "photo") push({ code: ISSUE_CODES.MISSING_CREDIT, severity: "info", message: `"${label}" has no photo credit.`, page: ctx.page, entityId: id });
    if (!media.src.print && !media.src.web && !media.src.thumb) push({ code: ISSUE_CODES.MISSING_IMAGE_FILE, severity: "error", message: `"${label}" has no renderable variant.`, page: ctx.page, entityId: id });
  }
  for (const article of plannedArticles) {
    const hero = article.heroMediaId ? mediaById.get(article.heroMediaId) : undefined;
    const width = hero?.src.print?.width ?? hero?.src.web?.width ?? hero?.width ?? null;
    if (hero && width !== null && width < HERO_MIN_PRINT_WIDTH) {
      push({ code: ISSUE_CODES.LOW_RES_HERO, severity: "warning", message: `Hero image of "${article.headline || article.storyTitle}" is only ${width}px wide (print needs ≥ ${HERO_MIN_PRINT_WIDTH}px).`, page: firstPage.get(article.id), entityId: hero.id });
    }
  }

  // ── Articles ─────────────────────────────────────────────────────────────
  for (const article of plannedArticles) {
    const page = firstPage.get(article.id);
    const name = article.headline || article.storyTitle || article.id;
    if (!APPROVED.has(article.status)) {
      push({ code: ISSUE_CODES.ARTICLE_NOT_APPROVED, severity: strict ? "error" : "warning", message: `"${name}" is ${article.status.toLowerCase().replace(/_/g, " ")}, not approved.`, page, entityId: article.id });
    }
    if (!article.body.length || article.wordCount === 0) push({ code: ISSUE_CODES.EMPTY_ARTICLE, severity: "error", message: `"${name}" has no body text.`, page, entityId: article.id });
    if (article.headline.length > HEADLINE_MAX_LENGTH) push({ code: ISSUE_CODES.HEADLINE_TOO_LONG, severity: "warning", message: `Headline of "${article.storyTitle ?? name}" is ${article.headline.length} characters (max ${HEADLINE_MAX_LENGTH}).`, page, entityId: article.id });
    if (!article.standfirst) push({ code: ISSUE_CODES.MISSING_STANDFIRST, severity: "info", message: `"${name}" has no standfirst.`, page, entityId: article.id });
    if (!article.byline) push({ code: ISSUE_CODES.MISSING_BYLINE, severity: "info", message: `"${name}" has no byline.`, page, entityId: article.id });
    const disputed = (article.facts ?? []).filter((f) => f.status === "DISPUTED");
    if (disputed.length) push({ code: ISSUE_CODES.UNRESOLVED_CONFLICT, severity: "error", message: `"${name}" has ${disputed.length} disputed fact(s): ${disputed[0].statement}`, page, entityId: article.id });
    if (!article.sourceIds.length) push({ code: ISSUE_CODES.MISSING_SOURCE, severity: "warning", message: `"${name}" is not linked to any submission.`, page, entityId: article.id });
  }

  // ── Pages ────────────────────────────────────────────────────────────────
  doc.pages.forEach((page, index) => {
    if (page.number !== index + 1) push({ code: ISSUE_CODES.PAGE_NUMBERS_INCONSISTENT, severity: "error", message: `Page at position ${index + 1} is numbered ${page.number}.`, page: page.number, entityId: page.id });
    const hasContent = page.articleIds.length > 0 || (page.template === "CONTINUATION" && (page.slices?.length ?? 0) > 0);
    if (!hasContent && !PAGES_WITHOUT_ARTICLE.has(page.template)) {
      push({ code: ISSUE_CODES.PAGE_WITHOUT_CONTENT, severity: "error", message: `Page ${page.number} (${page.template}) has no article.`, page: page.number, entityId: page.id });
    }
  });
  for (const [articleId, pages] of pagesOfArticle) {
    const main = pages.filter((p) => p.template !== "CONTINUATION" && !VISUAL_COMPANIONS.has(p.template));
    const article = articleById.get(articleId);
    if (main.length > 1) {
      push({ code: ISSUE_CODES.DUPLICATE_ARTICLE_ON_PAGES, severity: "warning", message: `"${article?.headline ?? articleId}" is placed on pages ${main.map((p) => p.number).join(", ")}.`, page: main[1].number, entityId: articleId });
    } else if (pages.filter((p) => p.template !== "CONTINUATION").length > 1) {
      push({ code: ISSUE_CODES.DUPLICATE_ARTICLE_ON_PAGES, severity: "info", message: `"${article?.headline ?? articleId}" also has a visual companion page (${pages.map((p) => p.number).join(", ")}).`, page: pages[0].number, entityId: articleId });
    }
  }

  // ── Contents & cover ─────────────────────────────────────────────────────
  const expected: string[] = [];
  const seen = new Set<string>();
  for (const page of doc.pages) for (const id of page.articleIds) if (!seen.has(id) && articleById.has(id)) { seen.add(id); expected.push(`${id}@${page.number}`); }
  const actual = doc.toc.map((l) => `${l.articleId}@${l.page}`);
  if (expected.join("|") !== actual.join("|")) {
    push({ code: ISSUE_CODES.TOC_MISMATCH, severity: "error", message: `The contents list (${actual.length} lines) does not match the page plan (${expected.length} articles).` });
  }
  const coverPage = doc.pages.find((p) => p.template === "COVER_A" || p.template === "COVER_B");
  if (!coverPage) push({ code: ISSUE_CODES.COVER_MISSING, severity: "error", message: "The page plan has no cover page." });
  if (!doc.meta.cover.headline) push({ code: ISSUE_CODES.COVER_MISSING, severity: "error", message: "The cover has no headline." });
  if (!doc.meta.cover.mediaId || !mediaById.has(doc.meta.cover.mediaId)) push({ code: ISSUE_CODES.COVER_MISSING, severity: "error", message: "The cover has no photo." });

  for (const section of doc.sections) {
    if (STRUCTURAL_SECTIONS.has(section.slug)) continue;
    const used = plannedArticles.some((a) => a.sectionId === section.id) || doc.pages.some((p) => p.sectionId === section.id && p.articleIds.length);
    if (!used) push({ code: ISSUE_CODES.SECTION_EMPTY, severity: "info", message: `Section "${section.name}" has no article in this issue.`, entityId: section.id });
  }

  const ordered = [...issues].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.page ?? 0) - (b.page ?? 0) || a.code.localeCompare(b.code));
  const stats: Record<string, number> = { errors: 0, warnings: 0, infos: 0, articles: plannedArticles.length, pages: doc.pages.length, media: usedMedia.size };
  for (const i of ordered) stats[i.severity === "error" ? "errors" : i.severity === "warning" ? "warnings" : "infos"] += 1;
  return { ok: stats.errors === 0, issues: ordered, pageCount: doc.pages.length, checkedAt: new Date().toISOString(), stats };
}

function severityRank(s: ValidationIssue["severity"]) {
  return s === "error" ? 0 : s === "warning" ? 1 : 2;
}

/** Whether a report blocks an export of the given kind: RED rights always block; any error blocks final/published exports. */
export function exportBlockers(report: ValidationReport, kind: PublicationKind): ValidationIssue[] {
  const strict = kind === "FINAL_REVIEW" || kind === "PUBLISHED";
  return report.issues.filter((i) => i.code === ISSUE_CODES.RED_RIGHTS || i.code === ISSUE_CODES.MISSING_IMAGE_FILE || (strict && i.severity === "error"));
}

/** Converts the pagination report into the ValidationReport shape stored on publication_versions.layoutReport. */
export function layoutReportAsValidation(report: LayoutReport): ValidationReport {
  const issues: ValidationIssue[] = [];
  for (const o of report.remainingOverflow) issues.push({ code: ISSUE_CODES.TEXT_OVERFLOW, severity: "error", message: `Page ${o.page}: ${o.blocks.length} block(s) still overflow.`, page: o.page, entityId: o.articleId });
  for (const p of report.blankPages) issues.push({ code: ISSUE_CODES.BLANK_PAGE, severity: "error", message: `Page ${p} is blank.`, page: p });
  for (const f of report.imagesFailed) issues.push({ code: ISSUE_CODES.IMAGE_FAILED, severity: "error", message: `Page ${f.page}: an image failed to load.`, page: f.page, entityId: f.mediaId });
  if (report.pageCountMismatch) issues.push({ code: ISSUE_CODES.PAGE_COUNT_MISMATCH, severity: "error", message: `The PDF has ${report.pageCountMismatch.actual} pages but the layout has ${report.pageCountMismatch.expected}.` });
  for (const f of report.fit) {
    if (f.template === "CONTINUATION" && f.ratio < 0.35) issues.push({ code: ISSUE_CODES.CONTINUATION_UNDERFULL, severity: "info", message: `Page ${f.page} is a continuation page that is only ${Math.round(f.ratio * 100)}% full — consider a denser template for the article.`, page: f.page, entityId: f.articleId });
  }
  return {
    ok: issues.every((i) => i.severity !== "error"),
    issues,
    pageCount: report.pages,
    checkedAt: new Date().toISOString(),
    stats: {
      pages: report.pages,
      plannedPages: report.plannedPages,
      continuationPagesAdded: report.continuationPagesAdded,
      blocksMoved: report.blocksMoved,
      paragraphsSplit: report.paragraphsSplit,
      copyfitFlows: report.copyfitFlows,
      rounds: report.rounds,
    },
  };
}

// ── Quality gates ───────────────────────────────────────────────────────────

export type QualityGateStatus = "pass" | "fail" | "warn" | "pending";
export type QualityGate = {
  key: string;
  label: string;
  status: QualityGateStatus;
  blocking: boolean;
  overridable: boolean;
  details: string;
  count?: number;
  href?: string;
  overridden?: boolean;
};

export const QUALITY_GATE_KEYS = [
  "every_selected_article_approved",
  "no_unresolved_factual_conflicts",
  "no_missing_source",
  "no_prohibited_media",
  "image_rights_validated",
  "captions_complete",
  "page_layout_validated",
  "no_text_overflow",
  "toc_consistent",
  "page_numbers_consistent",
  "cover_approved",
  "pdf_generated",
  "docx_generated",
] as const;
export type QualityGateKey = (typeof QUALITY_GATE_KEYS)[number];

export function kindForEditionStatus(status: string): PublicationKind {
  if (status === "PUBLISHED" || status === "ARCHIVED") return "PUBLISHED";
  if (status === "FINAL_REVIEW") return "FINAL_REVIEW";
  if (status === "LAYOUT" || status === "EDITORIAL_REVIEW") return "EDITORIAL_REVIEW";
  return "DRAFT";
}

export async function qualityGates(editionId: string): Promise<QualityGate[]> {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) return [];
  const doc = await buildEditionDocument(editionId, { versionLabel: "qa", includeUnapproved: true });
  const report = validateEditionDocument(doc, { kind: kindForEditionStatus(edition.status) });
  const latest = await db.query.publicationVersions.findFirst({ where: eq(publicationVersions.editionId, editionId), orderBy: [desc(publicationVersions.sequence)] });
  // Export gates look at the most recent *rendered* version: creating a new draft version that has
  // not been rendered yet must not hide the PDF and DOCX this edition already produced.
  const latestReady =
    latest?.status === "READY"
      ? latest
      : ((await db.query.publicationVersions.findFirst({ where: and(eq(publicationVersions.editionId, editionId), eq(publicationVersions.status, "READY")), orderBy: [desc(publicationVersions.sequence)] })) ?? null);
  const assets = latestReady ? await db.select().from(publicationAssets).where(eq(publicationAssets.versionId, latestReady.id)) : [];
  const overrides = await db
    .select({ gateKey: qualityGateOverrides.gateKey, reason: qualityGateOverrides.reason, userName: users.name, createdAt: qualityGateOverrides.createdAt })
    .from(qualityGateOverrides)
    .leftJoin(users, eq(users.id, qualityGateOverrides.userId))
    .where(eq(qualityGateOverrides.editionId, editionId))
    .orderBy(asc(qualityGateOverrides.createdAt));
  const base = `/editions/${editionId}`;
  const count = (code: string) => report.issues.filter((i) => i.code === code).length;
  const gate = (key: QualityGateKey, label: string, status: QualityGateStatus, details: string, opts: { blocking: boolean; overridable: boolean; count?: number; href?: string }): QualityGate => ({ key, label, status, details, ...opts });

  const notApproved = count(ISSUE_CODES.ARTICLE_NOT_APPROVED) + count(ISSUE_CODES.ARTICLE_EXCLUDED);
  const conflicts = count(ISSUE_CODES.UNRESOLVED_CONFLICT);
  const missingSource = count(ISSUE_CODES.MISSING_SOURCE);
  const red = count(ISSUE_CODES.RED_RIGHTS);
  const yellow = count(ISSUE_CODES.YELLOW_RIGHTS);
  const captions = count(ISSUE_CODES.MISSING_CAPTION);
  const emptyPages = count(ISSUE_CODES.PAGE_WITHOUT_CONTENT) + count(ISSUE_CODES.NO_ACTIVE_PLAN);
  const planValidated = doc.meta.planStatus === "VALIDATED" || doc.meta.planStatus === "LOCKED";
  const toc = count(ISSUE_CODES.TOC_MISMATCH);
  const numbers = count(ISSUE_CODES.PAGE_NUMBERS_INCONSISTENT);
  const cover = count(ISSUE_CODES.COVER_MISSING);
  const coverArticle = doc.meta.cover.articleId ? doc.articles.find((a) => a.id === doc.meta.cover.articleId) : undefined;
  const coverApproved = cover === 0 && (!coverArticle || APPROVED.has(coverArticle.status));
  // Same reasoning as the export gates: overflow is measured by a completed render.
  const layout = latestReady?.layoutReport ?? latest?.layoutReport ?? null;
  const overflow = layout ? layout.issues.filter((i) => i.code === ISSUE_CODES.TEXT_OVERFLOW).length : null;
  const pdf = assets.find((a) => a.kind === "PDF");
  const docx = assets.find((a) => a.kind === "DOCX");
  const versionNote = latest ? `Latest version ${latest.label} (${latest.status.toLowerCase()})` : "No version rendered yet";

  const gates: QualityGate[] = [
    gate("every_selected_article_approved", "Every selected article is approved", notApproved ? "fail" : "pass", notApproved ? `${notApproved} article(s) on the plan are not approved.` : `${report.stats?.articles ?? 0} planned articles approved.`, { blocking: true, overridable: true, count: notApproved, href: `${base}/articles` }),
    gate("no_unresolved_factual_conflicts", "No unresolved factual conflicts", conflicts ? "fail" : "pass", conflicts ? `${conflicts} article(s) have disputed facts.` : "No disputed facts on planned stories.", { blocking: true, overridable: true, count: conflicts, href: `${base}/stories?flag=needs_attention` }),
    gate("no_missing_source", "Every article has a source", missingSource ? "warn" : "pass", missingSource ? `${missingSource} article(s) are not linked to a submission.` : "All planned articles cite at least one submission.", { blocking: false, overridable: true, count: missingSource, href: `${base}/articles` }),
    gate("no_prohibited_media", "No prohibited (RED) media", red ? "fail" : "pass", red ? `${red} image(s) marked RED are placed in the issue.` : "No RED-rights media in the issue.", { blocking: true, overridable: false, count: red, href: `${base}/media?rights=RED` }),
    gate("image_rights_validated", "Image rights validated", yellow ? "fail" : "pass", yellow ? `${yellow} image(s) still have unclear (YELLOW) rights.` : "Every image in the issue is GREEN.", { blocking: true, overridable: true, count: yellow, href: `${base}/media?rights=YELLOW` }),
    gate("captions_complete", "Captions complete", captions ? "warn" : "pass", captions ? `${captions} image(s) have no caption.` : "Every image has a caption.", { blocking: false, overridable: true, count: captions, href: `${base}/media` }),
    gate("page_layout_validated", "Page layout validated", emptyPages ? "fail" : planValidated ? "pass" : "fail", emptyPages ? `${emptyPages} page(s) have no content.` : planValidated ? `Flatplan ${doc.meta.planStatus?.toLowerCase()}.` : `The flatplan is still ${doc.meta.planStatus?.toLowerCase() ?? "missing"}; validate it in the layout view.`, { blocking: true, overridable: true, count: emptyPages, href: `${base}/layout` }),
    gate("no_text_overflow", "No text overflow", overflow === null ? "pending" : overflow ? "fail" : "pass", overflow === null ? versionNote : overflow ? `${overflow} text area(s) still overflow after pagination.` : `Pagination clean (${layout?.stats?.continuationPagesAdded ?? 0} continuation page(s)).`, { blocking: true, overridable: true, count: overflow ?? undefined, href: `${base}/exports` }),
    gate("toc_consistent", "Contents match the plan", toc ? "fail" : "pass", toc ? "The contents list differs from the page plan." : "Contents generated from the page plan.", { blocking: true, overridable: false, count: toc, href: `${base}/layout` }),
    gate("page_numbers_consistent", "Page numbers consistent", numbers ? "fail" : "pass", numbers ? `${numbers} page(s) are misnumbered.` : `${doc.pages.length} pages numbered 1–${doc.pages.length}.`, { blocking: true, overridable: false, count: numbers, href: `${base}/layout` }),
    gate("cover_approved", "Cover approved", coverApproved ? "pass" : "fail", coverApproved ? "Cover page, headline and photo are in place." : cover ? report.issues.find((i) => i.code === ISSUE_CODES.COVER_MISSING)?.message ?? "Cover incomplete." : "The cover story is not approved.", { blocking: true, overridable: true, count: cover, href: `${base}/layout` }),
    gate("pdf_generated", "PDF generated", pdf ? "pass" : latest?.status === "FAILED" ? "fail" : "pending", pdf ? `${pdf.fileName} (${pdf.pageCount ?? "?"} pages, version ${latestReady?.label ?? "?"}).` : latest?.status === "FAILED" ? `Version ${latest.label} failed to render.` : versionNote, { blocking: true, overridable: false, href: `${base}/exports` }),
    gate("docx_generated", "DOCX generated", docx ? "pass" : latest?.status === "FAILED" ? "fail" : "pending", docx ? `${docx.fileName} (version ${latestReady?.label ?? "?"}).` : latest?.status === "FAILED" ? `Version ${latest.label} failed to render.` : versionNote, { blocking: true, overridable: false, href: `${base}/exports` }),
  ];

  for (const g of gates) {
    const override = overrides.find((o) => o.gateKey === g.key);
    if (override && g.overridable && (g.status === "fail" || g.status === "warn")) {
      g.status = "pass";
      g.overridden = true;
      g.details = `Overridden by ${override.userName ?? "an editor"}: ${override.reason}`;
    }
  }
  return gates;
}

export async function canPublish(editionId: string): Promise<{ ok: boolean; blocking: QualityGate[]; gates: QualityGate[] }> {
  const gates = await qualityGates(editionId);
  const blocking = gates.filter((g) => g.blocking && g.status !== "pass");
  return { ok: blocking.length === 0, blocking, gates };
}
