import type { Browser, Page } from "playwright";
import { PDFDocument } from "pdf-lib";
import type { EditionDocument } from "@/lib/publication/document";
import type { EditionDesign } from "@/lib/design/model";
import type { ResolvedDirection } from "@/lib/design/identity";
import type { FocalPoint } from "@/lib/design/crop";
import type { BrandSystem } from "@/lib/brand/system";
import type { PersonalityKey } from "@/lib/brand/typography";
import { planPrint, type PrintOptions, type PrintPlan } from "@/lib/design/pages";
import { createLogger } from "@/server/logger";
import { loadDataUriAssets, loadEmbeddedFontCss, withBrowser } from "@/server/publication/pdf";
import { PRINT_MEASURE_SCRIPT, paginateDesign, renderPrintEdition, reportFrom, type PrintMeasurement, type PrintReport } from "./print";
import type { ResolveContext } from "./content";

const log = createLogger("design:pdf");

/**
 * A PDF printed from the design rather than from a page plan.
 *
 * The same two-pass shape as the publication renderer — measure in a browser, act on what it says,
 * print — but what is being measured is an `EditionDesign`, so the result is the design's own
 * decisions on paper instead of eighteen templates filled in. Fonts and photographs travel inside
 * the HTML, so this renders on a host with no network and prints the same on any machine.
 */

export type DesignPdfOptions = {
  design: EditionDesign;
  document: EditionDocument;
  direction: ResolvedDirection;
  brand?: BrandSystem;
  personality?: PersonalityKey;
  focals?: Record<string, FocalPoint>;
  locale?: string;
  print?: PrintOptions;
  browser?: Browser;
  maxRounds?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
  onProgress?: (done: number, total: number, message: string) => void | Promise<void>;
};

export type DesignPdfResult = {
  buffer: Buffer;
  pageCount: number;
  plan: PrintPlan;
  report: PrintReport;
  /** The final print HTML, which is what a screenshot and the layout critic both read. */
  markup: string;
  measures: PrintMeasurement[];
  /** Pictures the storage could not hand over — an empty frame is a defect, not a log line. */
  mediaMissing: string[];
};

export async function measurePrintHtml(page: Page, markup: string): Promise<PrintMeasurement[]> {
  await page.setContent(markup, { waitUntil: "load", timeout: 180_000 });
  await page.evaluate(() => document.fonts.ready);
  return (await page.evaluate(PRINT_MEASURE_SCRIPT)) as PrintMeasurement[];
}

export async function renderDesignPdf(options: DesignPdfOptions): Promise<DesignPdfResult> {
  const say = options.log ?? ((message, meta) => log.info(message, meta));
  const progress = async (done: number, total: number, message: string) => {
    await options.onProgress?.(done, total, message);
  };
  const { design, document: doc } = options;

  await progress(1, 5, "Embedding fonts and pictures");
  const fontCss = await loadEmbeddedFontCss();
  const [measureAssets, printAssets] = await Promise.all([loadDataUriAssets(doc, "measure"), loadDataUriAssets(doc, "print")]);
  if (printAssets.missing.length) say("some pictures could not be read from storage", { missing: printAssets.missing });

  const urlsFor = (source: (media: EditionDocument["media"][number]) => string | null): Record<string, string> => {
    const urls: Record<string, string> = {};
    for (const media of doc.media) {
      const url = source(media);
      if (url) urls[media.id] = url;
    }
    return urls;
  };

  const base = {
    grid: design.grid,
    direction: options.direction,
    brand: options.brand,
    personality: options.personality,
    locale: options.locale ?? "en",
    title: doc.meta.masthead.title,
    issueLabel: doc.meta.issueLabel,
    fontCss,
  };
  const contentFor = (urls: Record<string, string>): ResolveContext => ({ document: doc, medium: "print", urls, focals: options.focals });

  return withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      await progress(2, 5, "Measuring and flowing the pages");
      const measureContent = contentFor(urlsFor(measureAssets.source));
      const { plan, report: loopReport } = await paginateDesign({
        plan: planPrint(design, options.print),
        render: (current) => renderPrintEdition({ ...base, plan: current, content: measureContent }),
        measure: (markup) => measurePrintHtml(page, markup),
        maxRounds: options.maxRounds,
        log: say,
      });

      await progress(3, 5, "Setting the final pages");
      const markup = renderPrintEdition({ ...base, plan, content: contentFor(urlsFor(printAssets.source)) });
      // Measured again on the pages that will actually be printed. The pictures are the print-size
      // files this time, and a report describing the rehearsal rather than the performance is how
      // a renderer comes to believe an issue is clean while a page spills off the sheet.
      const measures = await measurePrintHtml(page, markup);
      const report = reportFrom(plan, measures, { ...loopReport, settled: loopReport.settled });

      await progress(4, 5, "Printing");
      const raw = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      const pdf = await PDFDocument.load(raw, { updateMetadata: false });
      const pageCount = pdf.getPageCount();
      pdf.setTitle(`${doc.meta.masthead.title} — ${doc.meta.issueLabel}, ${doc.meta.label}`);
      pdf.setAuthor(doc.meta.masthead.title);
      pdf.setSubject(doc.meta.issueLabel);
      pdf.setProducer("Briefly editorial design engine");
      pdf.setCreator(`Briefly print renderer (Chromium ${browser.version()})`);
      const generatedAt = new Date(doc.meta.generatedAt);
      if (!Number.isNaN(generatedAt.getTime())) {
        pdf.setCreationDate(generatedAt);
        pdf.setModificationDate(generatedAt);
      }
      const buffer = Buffer.from(await pdf.save({ useObjectStreams: true }));
      await progress(5, 5, "The issue is set");
      say("printed the design", {
        pages: pageCount,
        rounds: report.rounds,
        carried: report.pagesAdded,
        split: report.copySplits,
        tightened: report.tightened,
        overflowing: report.overflowing.length,
      });
      return { buffer, pageCount, plan, report, markup, measures, mediaMissing: printAssets.missing };
    } finally {
      await context.close().catch(() => {});
    }
  }, options.browser);
}
