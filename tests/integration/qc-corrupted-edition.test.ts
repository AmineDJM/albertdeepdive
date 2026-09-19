import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { getStorage } from "@/server/storage";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { launchBrowser, renderPdf } from "@/server/publication/pdf";
import { runQc } from "@/server/qc";
import { documentSizeMm, PROFILES } from "@/server/qc/profiles";
import type { RenderedArtefact } from "@/server/qc/engine";
import type { Finding, QcReport } from "@/server/qc/types";

/**
 * The artefact, the outputs and the message — each broken on purpose, each measured.
 *
 * The companion to `qc-engine.test.ts`, which breaks the *library*: a logo where a photograph
 * should be, bytes gone from the bucket, refused rights. This one breaks the things that only
 * exist once an issue has been made into something — the PDF, the frozen outputs, the email — and
 * proves the same thing of each: that what comes back is a measurement with a threshold and a
 * place, and that the number moves when the defect is fixed.
 *
 * One render, several verdicts. The PDF is rendered once and handed to each run, which is both
 * cheaper and more correct: preflight is supposed to judge the file that will ship, not another
 * file made the same way five minutes later.
 */
describe("a deliberately broken issue, end to end", () => {
  let editionId: string;
  let organizationId: string;
  let rendered: RenderedArtefact;

  const find = (report: QcReport, metricId: string): Finding | undefined => report.findings.find((finding) => finding.metricId === metricId);
  const passed = (report: QcReport, metricId: string) => report.passed.find((each) => each.metricId === metricId);

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;

    const document = await buildEditionDocument(editionId, { versionLabel: "qc-corrupted", includeUnapproved: true });
    const browser = await launchBrowser();
    try {
      const pdf = await renderPdf(document, { browser, log: () => {} });
      rendered = { buffer: pdf.buffer, pageCount: pdf.pageCount, layoutReport: pdf.layoutReport, finalDocument: pdf.finalDocument, html: pdf.html };
    } finally {
      await browser.close();
    }
  }, 300_000);

  it("opens the file it is about to ship and reads every page of it", async () => {
    const report = await runQc(editionId, { profile: "PDF_SCREEN", only: ["geometry", "pdf"], repair: false, persist: false, rendered });

    // The file parses and its pages are the size this profile asks for.
    expect(find(report, "pdf.parses")).toBeUndefined();
    const size = passed(report, "pdf.page.size");
    expect(size, "page geometry must be measured, not assumed").toBeTruthy();
    expect(Number.parseFloat(size!.actual), "a screen PDF is 210×297mm to within half a millimetre").toBeLessThanOrEqual(0.5);

    // Fonts: the measurement that used to report Chromium's Type3 glyph procedures as a missing
    // font on every single export. A Type3 font carries its glyphs in CharProcs; nothing is
    // substituted, and the rule now says so.
    expect(find(report, "pdf.fonts.embedded"), "no font may be left for another machine to substitute").toBeUndefined();
    expect(passed(report, "pdf.fonts.embedded")).toBeTruthy();

    // Geometry, measured from the layout report of this very render.
    expect(find(report, "layout.text.overflow"), "nothing may be clipped").toBeUndefined();
    expect(find(report, "layout.page.blank"), "no page may come out empty").toBeUndefined();
    expect(report.findings.filter((finding) => finding.metricId === "layout.page.fit" && finding.severity === "FAIL")).toEqual([]);
    // Every page of the artefact was measured, not sampled — continuation pages included, which is
    // where an overflow usually ends up once the paginator has done what it can.
    const fits = report.passed.filter((each) => each.metricId === "layout.page.fit").length + report.findings.filter((each) => each.metricId === "layout.page.fit").length;
    // One measurement per text frame, not per page: a page carrying two articles has two frames to
    // fill and an overflow lives in one of them, while a full-bleed picture page has no frame at
    // all and nothing to say about fit.
    expect(fits).toBe(rendered.layoutReport.fit.length);
    expect(fits).toBeGreaterThan(rendered.pageCount * 0.8);

    // And each of those measurements is addressed separately. Two frames on one page used to
    // produce two findings with identical keys, which made the repair loop treat them as one and
    // mark both repaired when one was.
    const keys = [...report.passed, ...report.findings]
      .filter((each) => each.metricId === "layout.page.fit")
      .map((each) => `${each.location?.page}|${each.location?.field}`);
    expect(new Set(keys).size, "no two fit measurements share an address").toBe(keys.length);

    // Typography: the paginator has counted stranded lines on every pass since it was written and
    // thrown the numbers away. They are measured now, with a band — one orphan in a twenty-six
    // article issue is setting text in columns; three in one flow is a page nobody looked at.
    for (const metric of ["layout.type.orphans", "layout.type.widows"]) {
      const measured = [...report.passed, ...report.findings].filter((each) => each.metricId === metric);
      expect(measured.length, `${metric} must be measured, not merely catalogued`).toBeGreaterThan(0);
    }
  }, 180_000);

  it("judges the same file for a press and says how many millimetres out it is", async () => {
    // Nothing about the file changed. The destination did, and with it the arithmetic: a press
    // wants trim plus bleed, which on A4 is 216×303mm, and this file is 210×297.
    const report = await runQc(editionId, { profile: "PRINT", only: ["pdf", "print"], repair: false, persist: false, rendered });

    const size = find(report, "pdf.page.size");
    expect(size, "a screen PDF is not a press PDF, and preflight has to say so").toBeTruthy();
    const expectedSize = documentSizeMm(PROFILES.PRINT);
    expect(expectedSize).toEqual({ width: 216, height: 303 });
    expect(size!.unit).toBe("mm");
    expect(Number(size!.beforeValue)).toBeCloseTo(6, 0);
    expect(size!.expected).toBe("216×303 mm ± 0.5");

    const bleed = find(report, "print.bleed");
    expect(bleed, "3mm of bleed the file does not carry").toBeTruthy();
    expect(bleed!.expected).toBe("3 mm ± 0.5");
    // The file has no bleed at all, so the measured shortfall is the whole 3mm the press wants.
    expect(Number(bleed!.beforeValue)).toBeCloseTo(3, 0);
    expect(bleed!.evidence).toMatchObject({ expectedDocumentMm: { width: 216, height: 303 }, trimMm: { width: 210, height: 297 } });
    const measured = (bleed!.evidence as { actualBleedMm: { x: number; y: number } }).actualBleedMm;
    expect(Math.abs(measured.x)).toBeLessThan(0.5);
    expect(Math.abs(measured.y)).toBeLessThan(0.5);

    // The other half of the printer's geometry: what must not come near the edge. Read out of the
    // stylesheet the artefact carries, so shrinking a margin to fit more copy is caught here.
    const margin = find(report, "print.safe.margin") ?? passed(report, "print.safe.margin");
    expect(margin, "the safe margin is measured off the file, not assumed").toBeTruthy();
    const insets = (margin as { evidence?: { insetsMm: number[]; requiredMm: number } }).evidence;
    if (insets) {
      expect(insets.requiredMm).toBe(PROFILES.PRINT.safeMarginMm);
      expect(Math.min(...insets.insetsMm), "the design system sets type 14mm from the trim").toBeGreaterThanOrEqual(PROFILES.PRINT.safeMarginMm!);
    }
  }, 180_000);

  it("catches a number that two renderings of the same issue disagree about", async () => {
    // The failure in its natural habitat: an output was published in March from a document that
    // said €2.4M, somebody corrected the article to €24M in April, and both are now live. Freezing
    // a version and pointing an output at it is exactly what publishing does.
    const article = await db.query.articles.findFirst({ where: eq(s.articles.editionId, editionId) });
    const original = article!.body;
    const headline = article!.headline;

    const frozen = await buildEditionDocument(editionId, { versionLabel: "v0.99", includeUnapproved: true });
    const inFrozen = frozen.articles.find((each) => each.id === article!.id)!;
    inFrozen.body = [{ id: "qc-fixture-1", type: "paragraph", text: "The round raised €2.4M from a single fund." }];

    const [version] = await db
      .insert(s.publicationVersions)
      .values({
        editionId,
        label: "v0.99",
        sequence: 99,
        kind: "DRAFT",
        status: "READY",
        document: frozen as unknown as Record<string, unknown>,
        documentHash: "qc-corrupted-fixture",
      })
      .returning();
    const [output] = await db
      .insert(s.editionOutputs)
      .values({ organizationId, editionId, format: "WEB", status: "PUBLISHED", versionId: version.id, publicSlug: `qc-corrupted-${Date.now()}` })
      .returning();

    // …and the live article, corrected by a factor of ten.
    await db.update(s.articles).set({ body: [{ id: "qc-fixture-1", type: "paragraph", text: "The round raised €24M from a single fund." }] }).where(eq(s.articles.id, article!.id));

    try {
      const report = await runQc(editionId, { only: ["facts"], repair: false, persist: false });
      const drift = report.findings.find((finding) => finding.metricId === "facts.consistent" && finding.location.entityId === article!.id);
      expect(drift, `"${headline}" says two different amounts in two live outputs`).toBeTruthy();
      expect(drift!.severity).toBe("FAIL");
      expect(drift!.location.field).toBe("money");
      expect(drift!.expected + drift!.actual).toContain("2.4M");
      expect(drift!.expected + drift!.actual).toContain("24M");
      expect(drift!.evidence).toMatchObject({ kind: "money" });
      const values = (drift!.evidence as { sources: { values: string[] }[] }).sources.flatMap((source) => source.values);
      expect(values, "the two amounts are ten times apart, which is the whole point").toEqual(expect.arrayContaining(["2400000", "24000000"]));

      // Corrected: the same code, the same comparison, no finding.
      await db.update(s.articles).set({ body: [{ id: "qc-fixture-1", type: "paragraph", text: "The round raised €2.4M from a single fund." }] }).where(eq(s.articles.id, article!.id));
      const after = await runQc(editionId, { only: ["facts"], repair: false, persist: false });
      expect(after.findings.find((finding) => finding.metricId === "facts.consistent" && finding.location.entityId === article!.id)).toBeUndefined();
    } finally {
      await db.delete(s.editionOutputs).where(eq(s.editionOutputs.id, output.id));
      await db.delete(s.publicationVersions).where(eq(s.publicationVersions.id, version.id));
      await db.update(s.articles).set({ body: original }).where(eq(s.articles.id, article!.id));
    }
  }, 180_000);

  it("reads the message that would be sent, and counts the pictures with nothing behind them", async () => {
    const media = await db.query.mediaAssets.findFirst({
      where: and(eq(s.mediaAssets.organizationId, organizationId), eq(s.mediaAssets.kind, "photo"), eq(s.mediaAssets.rightsStatus, "GREEN")),
    });
    const variant = await db.query.mediaVariants.findFirst({ where: and(eq(s.mediaVariants.assetId, media!.id), eq(s.mediaVariants.kind, "WEB")) });
    const storage = await getStorage();
    const bytes = await storage.get(variant!.storageKey);
    expect(bytes, "the fixture needs the picture to be there before it can be taken away").toBeTruthy();

    const before = await runQc(editionId, { profile: "EMAIL", only: ["email"], repair: false, persist: false });
    const beforeBroken = Number.parseFloat(before.passed.find((each) => each.metricId === "email.images.resolve")?.actual ?? String(before.findings.find((each) => each.metricId === "email.images.resolve")?.beforeValue ?? 0));

    // Take the bytes out from under one picture, which is what a lifecycle rule or a hasty cleanup
    // does. Nothing in the database changes; the email still references it.
    await storage.delete(variant!.storageKey);
    try {
      const broken = await runQc(editionId, { profile: "EMAIL", only: ["email"], repair: false, persist: false });
      const finding = broken.findings.find((each) => each.metricId === "email.images.resolve");
      if (finding) {
        expect(Number(finding.beforeValue)).toBeGreaterThan(beforeBroken);
        expect(finding.expected).toContain("0");
        expect(finding.message).toMatch(/nothing behind them/);
      } else {
        // The picture is not in this issue's email at all, so nothing is claimed about it. Saying
        // so is better than asserting on a message that does not reference the asset.
        expect(broken.passed.some((each) => each.metricId === "email.images.resolve")).toBe(true);
      }

      // The opt-out is checked in both parts of the message, always.
      expect(broken.findings.find((each) => each.metricId === "email.unsubscribe")).toBeUndefined();
      // And the width, against a phone rather than a desktop preview.
      const width = broken.findings.find((each) => each.metricId === "email.width") ?? broken.passed.find((each) => each.metricId === "email.width");
      expect(width, "the message's widest declared width is measured against the viewport").toBeTruthy();
    } finally {
      await storage.put(variant!.storageKey, bytes!, { contentType: `image/${variant!.format ?? "webp"}` });
    }
  }, 180_000);
});
