import type { EditionDocument } from "@/lib/publication/document";
import { loadDataUriAssets, loadEmbeddedFontCss, measureHtml, withBrowser } from "./pdf";
import { paginateDocument, type LayoutReport, type PageMeasurement } from "./paginate";
import { renderDocumentHtml } from "./templates";
import { analyzePages, type IssueQualityReport } from "./page-quality";
import { createLogger } from "@/server/logger";

const log = createLogger("publication:layout-audit");

export type LayoutAudit = {
  document: EditionDocument;
  layout: LayoutReport;
  quality: IssueQualityReport;
  measures: PageMeasurement[];
  durationMs: number;
};

/**
 * Runs the real print pipeline on a document — the same render, the same headless Chromium
 * measurement and the same pagination the PDF uses — then grades every page.
 *
 * This is the single source of truth for "is this issue printable?": the CLI audit, the export
 * preflight and the layout tests all go through it, so a page can never pass in one place and fail
 * in another.
 */
export async function auditDocumentLayout(doc: EditionDocument): Promise<LayoutAudit> {
  const started = Date.now();
  const [fontCss, assets] = await Promise.all([loadEmbeddedFontCss(), loadDataUriAssets(doc, "measure")]);
  const result = await withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      return await paginateDocument(doc, {
        render: (d) => renderDocumentHtml(d, { mode: "print", assetSource: assets.source, fontCss }),
        measure: (html) => measureHtml(page, html),
        engine: `Chromium ${browser.version()}`,
        log: (message, meta) => log.debug(message, meta),
      });
    } finally {
      await context.close().catch(() => {});
    }
  });
  const quality = analyzePages(result.document, result.measures);
  const durationMs = Date.now() - started;
  log.info("layout audited", {
    editionId: doc.meta.editionId,
    pages: result.report.pages,
    rounds: result.report.rounds,
    hardFailures: quality.hardFailures,
    averageOccupancy: quality.averageOccupancy,
    ms: durationMs,
  });
  return { document: result.document, layout: result.report, quality, measures: result.measures, durationMs };
}
