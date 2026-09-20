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
 * The design on paper, in a real browser.
 *
 * The same two-pass shape as the publication renderer — measure, act on what it says, print — but
 * what is being measured is an `EditionDesign`, so the result is the design's own decisions rather
 * than eighteen templates filled in. Fonts and photographs travel inside the HTML, so this renders
 * on a host with no network and prints the same on any machine.
 *
 * Laying out and printing are separate on purpose. The refinement loop (§80) lays an issue out
 * several times and only prints once, and a PDF nobody will read is the most expensive part of the
 * round.
 */

export type DesignLayoutOptions = {
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

export type DesignLayoutResult = {
  plan: PrintPlan;
  report: PrintReport;
  /** The print HTML, which is what a screenshot and the layout critic both read. */
  markup: string;
  measures: PrintMeasurement[];
};

export type DesignPdfResult = DesignLayoutResult & {
  buffer: Buffer;
  pageCount: number;
  /** Pictures the storage could not hand over — an empty frame is a defect, not a log line. */
  mediaMissing: string[];
};

export async function measurePrintHtml(page: Page, markup: string): Promise<PrintMeasurement[]> {
  await page.setContent(markup, { waitUntil: "load", timeout: 180_000 });
  await page.evaluate(() => document.fonts.ready);
  return (await page.evaluate(PRINT_MEASURE_SCRIPT)) as PrintMeasurement[];
}

type Prepared = {
  base: { grid: EditionDesign["grid"]; direction: ResolvedDirection; brand?: BrandSystem; personality?: PersonalityKey; locale: string; title: string; issueLabel: string | null; fontCss: string };
  contentFor: (quality: "measure" | "print") => ResolveContext;
  missing: string[];
};

async function prepare(options: DesignLayoutOptions, qualities: ("measure" | "print")[]): Promise<Prepared> {
  const { design, document: doc } = options;
  const fontCss = await loadEmbeddedFontCss();
  const loaded = await Promise.all(qualities.map((quality) => loadDataUriAssets(doc, quality)));
  const urls = new Map<string, Record<string, string>>();
  for (const [index, quality] of qualities.entries()) {
    const map: Record<string, string> = {};
    for (const media of doc.media) {
      const url = loaded[index].source(media);
      if (url) map[media.id] = url;
    }
    urls.set(quality, map);
  }
  return {
    base: {
      grid: design.grid,
      direction: options.direction,
      brand: options.brand,
      personality: options.personality,
      locale: options.locale ?? "en",
      title: doc.meta.masthead.title,
      issueLabel: doc.meta.issueLabel,
      fontCss,
    },
    contentFor: (quality) => ({ document: doc, medium: "print", urls: urls.get(quality) ?? {}, focals: options.focals }),
    missing: loaded[qualities.indexOf("print")]?.missing ?? [],
  };
}

/** Pages, measured and settled, with no PDF printed. */
export async function layoutDesign(options: DesignLayoutOptions): Promise<DesignLayoutResult> {
  const say = options.log ?? ((message, meta) => log.info(message, meta));
  const prepared = await prepare(options, ["measure"]);
  return withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      const content = prepared.contentFor("measure");
      return await paginateDesign({
        plan: planPrint(options.design, options.print),
        render: (current) => renderPrintEdition({ ...prepared.base, plan: current, content }),
        measure: (markup) => measurePrintHtml(page, markup),
        maxRounds: options.maxRounds,
        log: say,
      });
    } finally {
      await context.close().catch(() => {});
    }
  }, options.browser);
}

export async function renderDesignPdf(options: DesignLayoutOptions): Promise<DesignPdfResult> {
  const say = options.log ?? ((message, meta) => log.info(message, meta));
  const progress = async (done: number, total: number, message: string) => {
    await options.onProgress?.(done, total, message);
  };
  const doc = options.document;

  await progress(1, 5, "Embedding fonts and pictures");
  const prepared = await prepare(options, ["measure", "print"]);
  if (prepared.missing.length) say("some pictures could not be read from storage", { missing: prepared.missing });

  return withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      await progress(2, 5, "Measuring and flowing the pages");
      const measureContent = prepared.contentFor("measure");
      const { plan, report: loopReport } = await paginateDesign({
        plan: planPrint(options.design, options.print),
        render: (current) => renderPrintEdition({ ...prepared.base, plan: current, content: measureContent }),
        measure: (markup) => measurePrintHtml(page, markup),
        maxRounds: options.maxRounds,
        log: say,
      });

      await progress(3, 5, "Setting the final pages");
      const markup = renderPrintEdition({ ...prepared.base, plan, content: prepared.contentFor("print") });
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
      return { buffer, pageCount, plan, report, markup, measures, mediaMissing: prepared.missing };
    } finally {
      await context.close().catch(() => {});
    }
  }, options.browser);
}
