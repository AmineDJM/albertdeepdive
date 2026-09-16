import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { ensureSeeded } from "../helpers/db";
import { db } from "@/server/db/client";
import { editions, notifications, pagePlanPages, pagePlans, publicationAssets, publicationVersions, users } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import type { EditionDocument } from "@/lib/publication/document";
import { buildEditionDocument, documentHash } from "@/server/publication/document-builder";
import { renderDocx, verifyDocx } from "@/server/publication/docx";
import { launchBrowser, renderPdf, renderPreviewHtml } from "@/server/publication/pdf";
import { ISSUE_CODES, canPublish, qualityGates, validateEditionDocument } from "@/server/publication/validate";
import { compareVersions, createPublicationVersion, downloadUrl, getVersion, listVersions, overrideQualityGate, renderVersion } from "@/server/publication/versions";
import { readZipEntries } from "@/server/publication/zip";

/**
 * End-to-end publication pipeline on the seeded May 2025 issue. The seed runs once (beforeAll);
 * the PDF is rendered once and shared by the assertions to keep the runtime reasonable.
 */

let editionId: string;
let doc: EditionDocument;
let plannedPageCount = 0;

beforeAll(async () => {
  const seeded = await ensureSeeded();
  editionId = seeded.editionId;
  doc = await buildEditionDocument(editionId, { versionLabel: "v0.1", includeUnapproved: true });
  const plan = await db.query.pagePlans.findFirst({ where: eq(pagePlans.editionId, editionId) });
  plannedPageCount = plan ? (await db.select().from(pagePlanPages).where(eq(pagePlanPages.planId, plan.id))).length : 0;
}, 180_000);

describe("buildEditionDocument (seeded edition)", () => {
  it("assembles 26 articles, the planned pages, a contents list and print media", () => {
    expect(doc.articles).toHaveLength(26);
    expect(plannedPageCount).toBeGreaterThanOrEqual(24);
    expect(doc.pages).toHaveLength(plannedPageCount);
    expect(doc.pages.map((p) => p.number)).toEqual(doc.pages.map((_, i) => i + 1));
    expect(doc.meta.issueLabel).toBe("Special issue N°1");
    expect(doc.meta.masthead.title).toBe("Albert's Deep Dive");
    expect(doc.meta.credits).toEqual([
      { role: "Editor in chief", name: "Milan Viallet" },
      { role: "Translator", name: "Khadidja Addi" },
    ]);
    expect(doc.meta.contactEmail).toBe("albertsdeepdive@albertschool.com");
    expect(doc.meta.cover.headline).toContain("Business Deep Dives");
    expect(doc.meta.cover.mediaId).toBeTruthy();
    expect(doc.meta.cover.teasers.length).toBeGreaterThan(0);
    expect(doc.meta.cover.teasers.every((t) => typeof t.page === "number")).toBe(true);
    expect(doc.toc).toHaveLength(26);
    expect(doc.toc[0]).toMatchObject({ page: 3, sectionName: "Spotlight" });
    expect(doc.toc.every((l) => l.page >= 1 && l.text.length > 0)).toBe(true);
    expect(doc.media.length).toBeGreaterThanOrEqual(58);
    expect(doc.media.every((m) => m.src.print?.url.startsWith("http") && m.src.web && m.src.thumb)).toBe(true);
    expect(doc.media.every((m) => m.src.print?.path)).toBe(true);
    const bdd = doc.articles.find((a) => a.storySlug === "bdd-carrefour-b2");
    expect(bdd?.bdd?.companyName).toBe("Carrefour");
    expect(bdd?.bdd?.winningTeam.map((m) => m.name)).toContain("Sacha Nardoux");
    expect(bdd?.pullQuotes.length).toBeGreaterThan(0);
    expect(bdd?.facts?.some((f) => f.status === "DISPUTED")).toBe(true);
    expect(bdd?.media[0].role).toBe("hero");
    const event = doc.articles.find((a) => a.storySlug === "event-admitted-party");
    expect(event?.event?.location).toContain("Rue de Paradis");
    expect(doc.references.some((r) => r.url.includes("kaern.fr"))).toBe(true);
    expect(doc.warnings.filter((w) => w.code === "ARTICLE_NOT_APPROVED")).toHaveLength(4);
  });

  it("produces a stable hash independent of generation time and signed URLs", async () => {
    const again = await buildEditionDocument(editionId, { versionLabel: "v0.1", includeUnapproved: true });
    expect(again.meta.generatedAt).not.toBe(doc.meta.generatedAt);
    expect(documentHash(again)).toBe(documentHash(doc));
    const excluded = await buildEditionDocument(editionId, { versionLabel: "v0.1", includeUnapproved: false });
    expect(excluded.articles).toHaveLength(22);
    expect(excluded.warnings.filter((w) => w.code === "ARTICLE_EXCLUDED")).toHaveLength(4);
    expect(documentHash(excluded)).not.toBe(documentHash(doc));
  });
});

describe("validateEditionDocument (seeded edition)", () => {
  it("reports YELLOW rights warnings and no errors for a draft", () => {
    const report = validateEditionDocument(doc, { kind: "DRAFT" });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain(ISSUE_CODES.YELLOW_RIGHTS);
    expect(codes).not.toContain(ISSUE_CODES.RED_RIGHTS);
    expect(codes).toContain(ISSUE_CODES.ARTICLE_NOT_APPROVED);
    expect(codes).toContain(ISSUE_CODES.LOW_RES_HERO);
    const errors = report.issues.filter((i) => i.severity === "error" && i.code !== ISSUE_CODES.UNRESOLVED_CONFLICT);
    expect(errors).toEqual([]);
    expect(report.issues.filter((i) => i.code === ISSUE_CODES.UNRESOLVED_CONFLICT).length).toBeGreaterThan(0);
    expect(codes).not.toContain(ISSUE_CODES.TOC_MISMATCH);
    expect(codes).not.toContain(ISSUE_CODES.COVER_MISSING);
    expect(codes).not.toContain(ISSUE_CODES.PAGE_WITHOUT_CONTENT);
  });

  it("computes quality gates with stable keys", async () => {
    const gates = await qualityGates(editionId);
    expect(gates.map((g) => g.key)).toEqual([
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
    ]);
    const byKey = Object.fromEntries(gates.map((g) => [g.key, g]));
    expect(byKey.every_selected_article_approved.status).toBe("fail");
    expect(byKey.no_unresolved_factual_conflicts.status).toBe("fail");
    expect(byKey.no_prohibited_media.status).toBe("pass");
    expect(byKey.image_rights_validated.status).toBe("fail");
    expect(byKey.toc_consistent.status).toBe("pass");
    expect(byKey.page_numbers_consistent.status).toBe("pass");
    expect(byKey.cover_approved.status).toBe("pass");
    expect(byKey.pdf_generated.status).toBe("pending");
    const verdict = await canPublish(editionId);
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking.map((g) => g.key)).toContain("every_selected_article_approved");
  });
});

describe("rendering (one shared browser)", () => {
  let pdfResult: Awaited<ReturnType<typeof renderPdf>>;

  beforeAll(async () => {
    const browser = await launchBrowser();
    try {
      pdfResult = await renderPdf(doc, { browser });
    } finally {
      await browser.close();
    }
  }, 300_000);

  it("renders a PDF with at least 24 pages, metadata and a clean layout report", async () => {
    expect(pdfResult.pageCount).toBeGreaterThanOrEqual(24);
    expect(pdfResult.pageCount).toBe(pdfResult.finalDocument.pages.length);
    expect(pdfResult.layoutReport.remainingOverflow).toEqual([]);
    expect(pdfResult.layoutReport.blankPages).toEqual([]);
    expect(pdfResult.layoutReport.imagesFailed).toEqual([]);
    expect(pdfResult.layoutReport.pageCountMismatch).toBeUndefined();
    expect(pdfResult.layoutReport.ok).toBe(true);
    expect(pdfResult.layoutReport.fit.every((f) => f.ratio > 0 && f.ratio <= 1)).toBe(true);
    const parsed = await PDFDocument.load(pdfResult.buffer, { updateMetadata: false });
    expect(parsed.getPageCount()).toBe(pdfResult.pageCount);
    expect(parsed.getTitle()).toBe("Albert's Deep Dive — Special issue N°1, May 2025");
    expect(parsed.getAuthor()).toBe("Albert's Deep Dive");
    expect(parsed.getSubject()).toBe("Special issue N°1");
    expect(parsed.getKeywords()).toContain("v0.1");
    const { width, height } = parsed.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    // Continuation pages keep the contents and cover teasers in sync.
    const final = pdfResult.finalDocument;
    const continuation = final.pages.filter((p) => p.template === "CONTINUATION");
    expect(continuation.length).toBe(pdfResult.layoutReport.continuationPagesAdded);
    for (const c of continuation) {
      expect(c.continuationOf).toBe(final.pages.find((p) => p.id === c.continuationOfPageId)?.number);
      expect(c.slices?.length).toBeGreaterThan(0);
    }
    expect(final.toc).toHaveLength(26);
    for (const line of final.toc) expect(final.pages[line.page - 1].articleIds).toContain(line.articleId);
    expect(final.meta.layout?.continuationPages).toBe(continuation.length);
    // Same input → same layout.
    expect(final.pages.map((p) => p.template)).toMatchSnapshot();
  });

  it("builds the print HTML with embedded fonts and data-URI images, and a preview with signed URLs", () => {
    expect(pdfResult.html).toContain("data:font/woff2;base64,");
    expect(pdfResult.html).toContain('src="data:image/');
    expect(pdfResult.html).not.toContain("http://127.0.0.1:3100/api/storage");
    expect(pdfResult.html).toContain("Article : Khadidja Addi");
    expect(pdfResult.html).toContain("Continued on page");
    const preview = renderPreviewHtml(pdfResult.finalDocument);
    expect(preview).toContain("/fonts/fraunces-normal-latin.woff2");
    expect(preview).toContain("/api/storage/media/");
    expect(preview).toContain("preview-flag");
    expect(preview).not.toContain("data:image/");
  });

  it("renders a DOCX that is a valid ZIP whose document.xml contains the cover story", async () => {
    const buffer = await renderDocx(doc);
    const entries = readZipEntries(buffer).map((e) => e.name);
    expect(entries).toContain("word/document.xml");
    expect(entries).toContain("[Content_Types].xml");
    expect(entries.some((e) => e.startsWith("word/media/"))).toBe(true);
    const verified = verifyDocx(buffer, "Pet food");
    expect(verified.ok).toBe(true);
    expect(verified.documentXml).toContain("Pet food");
    expect(verified.documentXml).toContain("Article : Khadidja Addi");
    expect(verified.documentXml).toContain("Contents");
    expect(verified.documentXml).toContain("Colophon");
    // Long articles flow in two columns (the docx library writes w:space before w:num).
    expect(verified.documentXml).toMatch(/<w:cols [^>]*w:num="2"/);
    expect(readZipEntries(buffer).find((e) => e.name === "word/styles.xml")!.read().toString("utf8")).toContain('w:styleId="PullQuote"');
  }, 120_000);
});

describe("publication versions", () => {
  it("creates, renders and stores a draft version with two assets, then publishes nothing without gates", async () => {
    const admin = await db.query.users.findFirst({ where: eq(users.role, "SUPER_ADMIN") });
    const created = await createPublicationVersion(editionId, { kind: "DRAFT", userId: admin!.id, notes: "integration" });
    expect(created.label).toBe("v0.1");
    expect(created.status).toBe("PENDING");
    expect(created.documentHash).toHaveLength(64);
    const browser = await launchBrowser();
    let rendered: Awaited<ReturnType<typeof renderVersion>>;
    try {
      rendered = await renderVersion(created.id, { browser });
    } finally {
      await browser.close();
    }
    expect(rendered.status).toBe("READY");
    expect(rendered.pdfAssetId).toBeTruthy();
    expect(rendered.docxAssetId).toBeTruthy();
    expect(rendered.layoutReport?.ok).toBe(true);
    expect(rendered.validationReport?.issues.some((i) => i.code === ISSUE_CODES.YELLOW_RIGHTS)).toBe(true);
    expect(rendered.renderLog.some((l) => l.message.includes("PDF"))).toBe(true);
    const assets = await db.select().from(publicationAssets).where(eq(publicationAssets.versionId, created.id));
    expect(assets.map((a) => a.kind).sort()).toEqual(["DOCX", "PDF"]);
    const storage = getStorage();
    for (const asset of assets) {
      expect(asset.storageKey).toBe(`publications/${editionId}/${created.id}/${asset.fileName}`);
      expect(asset.fileName).toMatch(/^albert-deep-dive-special-issue-1-may-2025-v0\.1\.(pdf|docx)$/);
      expect(await storage.exists(asset.storageKey)).toBe(true);
      expect(asset.checksum).toHaveLength(64);
      const link = await downloadUrl(asset.id);
      expect(link.url).toContain("download=");
      expect(link.fileName).toBe(asset.fileName);
    }
    expect(assets.find((a) => a.kind === "PDF")?.pageCount).toBeGreaterThanOrEqual(24);
    const versions = await listVersions(editionId);
    expect(versions[0].id).toBe(created.id);
    expect(versions[0].assets).toHaveLength(2);
    const stored = await getVersion(created.id);
    expect((stored?.document as EditionDocument).pages.length).toBe(assets.find((a) => a.kind === "PDF")?.pageCount);
    const notes = await db.select().from(notifications).where(eq(notifications.userId, admin!.id));
    expect(notes.some((n) => n.type === "EXPORT_COMPLETED" && n.entityId === created.id)).toBe(true);

    // Second version: labels sequence, comparison works.
    const second = await createPublicationVersion(editionId, { kind: "EDITORIAL_REVIEW", userId: admin!.id });
    expect(second.label).toBe("v0.2");
    const diff = await compareVersions(created.id, second.id);
    expect(diff.articlesAdded).toEqual([]);
    expect(diff.articlesRemoved).toEqual([]);
    expect(diff.headlineChanges).toEqual([]);
    expect(diff.wordCountChange).toBe(0);
    expect(diff.pageCountChange).toBeLessThan(0); // stored v0.1 document is paginated (continuation pages), v0.2 is not yet

    // Gates now see the rendered assets; overrides need the right role.
    const gates = await qualityGates(editionId);
    const byKey = Object.fromEntries(gates.map((g) => [g.key, g]));
    expect(byKey.pdf_generated.status).toBe("pass");
    expect(byKey.docx_generated.status).toBe("pass");
    expect(byKey.no_text_overflow.status).toBe("pass");
    await expect(overrideQualityGate(editionId, "image_rights_validated", "Photographers confirmed by email", { id: admin!.id, role: "EDITOR" })).rejects.toThrow(/editor in chief/i);
    await overrideQualityGate(editionId, "image_rights_validated", "Photographers confirmed by email", { id: admin!.id, role: "SUPER_ADMIN" });
    const after = Object.fromEntries((await qualityGates(editionId)).map((g) => [g.key, g]));
    expect(after.image_rights_validated.status).toBe("pass");
    expect(after.image_rights_validated.overridden).toBe(true);
    expect(after.image_rights_validated.details).toContain("Overridden by");

    // A PUBLISHED version cannot be created outside final review, and publishing is blocked by gates.
    await expect(createPublicationVersion(editionId, { kind: "PUBLISHED", userId: admin!.id })).rejects.toThrow(/final review/i);
    const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
    expect(edition?.status).toBe("EDITORIAL_REVIEW");
    const pending = await db.query.publicationVersions.findFirst({ where: eq(publicationVersions.id, second.id) });
    expect(pending?.status).toBe("PENDING");
  }, 300_000);
});
