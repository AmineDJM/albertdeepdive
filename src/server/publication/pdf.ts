import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { connectBrowserbase } from "@/server/integrations/browserbase";
import { PDFDocument } from "pdf-lib";
import type { DocumentMedia, EditionDocument } from "@/lib/publication/document";
import { env } from "@/server/env";
import { getStorage } from "@/server/storage";
import { createLogger } from "@/server/logger";
import { MEASURE_SCRIPT, buildLayoutReport, paginateDocument, type LayoutReport, type PageMeasurement } from "./paginate";
import { renderDocumentHtml, type AssetSource } from "./templates";

const log = createLogger("publication:pdf");

/**
 * PDF rendering: builds a self-contained HTML document (fonts and images embedded as data URIs,
 * read through the storage adapter — never over the network), runs the pagination pass in
 * Chromium, prints to PDF and stamps metadata with pdf-lib.
 */

const FONT_FILES: { family: string; style: "normal" | "italic"; weight: string; file: string; range: "latin" | "latin-ext" }[] = [
  { family: "Fraunces", style: "italic", weight: "300 900", file: "fraunces-italic-latin-ext.woff2", range: "latin-ext" },
  { family: "Fraunces", style: "italic", weight: "300 900", file: "fraunces-italic-latin.woff2", range: "latin" },
  { family: "Fraunces", style: "normal", weight: "300 900", file: "fraunces-normal-latin-ext.woff2", range: "latin-ext" },
  { family: "Fraunces", style: "normal", weight: "300 900", file: "fraunces-normal-latin.woff2", range: "latin" },
  { family: "Newsreader", style: "italic", weight: "300 800", file: "newsreader-italic-latin-ext.woff2", range: "latin-ext" },
  { family: "Newsreader", style: "italic", weight: "300 800", file: "newsreader-italic-latin.woff2", range: "latin" },
  { family: "Newsreader", style: "normal", weight: "300 800", file: "newsreader-normal-latin-ext.woff2", range: "latin-ext" },
  { family: "Newsreader", style: "normal", weight: "300 800", file: "newsreader-normal-latin.woff2", range: "latin" },
  { family: "Inter", style: "normal", weight: "300 800", file: "inter-normal-latin-ext.woff2", range: "latin-ext" },
  { family: "Inter", style: "normal", weight: "300 800", file: "inter-normal-latin.woff2", range: "latin" },
  { family: "IBM Plex Mono", style: "normal", weight: "400 600", file: "ibm-plex-mono-normal-latin-ext.woff2", range: "latin-ext" },
  { family: "IBM Plex Mono", style: "normal", weight: "400 600", file: "ibm-plex-mono-normal-latin.woff2", range: "latin" },
];

const UNICODE_RANGES = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext":
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
};

let embeddedFontCss: Promise<string> | null = null;

/** @font-face rules with the woff2 files embedded as base64 (cached per process). */
export function loadEmbeddedFontCss(): Promise<string> {
  if (!embeddedFontCss) {
    embeddedFontCss = (async () => {
      const dir = path.join(process.cwd(), "public", "fonts");
      const rules: string[] = [];
      for (const font of FONT_FILES) {
        const data = await fs.readFile(path.join(dir, font.file));
        rules.push(
          `@font-face{font-family:'${font.family}';font-style:${font.style};font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${data.toString("base64")}) format('woff2');unicode-range:${UNICODE_RANGES[font.range]};}`,
        );
      }
      return rules.join("\n");
    })();
  }
  return embeddedFontCss;
}

/** @font-face rules pointing at /fonts/… (used by the on-screen preview served by Next.js). */
export function fontCssForUrls(base = ""): string {
  return FONT_FILES.map(
    (font) =>
      `@font-face{font-family:'${font.family}';font-style:${font.style};font-weight:${font.weight};font-display:swap;src:url('${base}/fonts/${font.file}') format('woff2');unicode-range:${UNICODE_RANGES[font.range]};}`,
  ).join("\n");
}

function mimeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

export type AssetQuality = "print" | "measure";

/**
 * Reads every media file referenced by the document through the storage adapter and returns a
 * resolver producing data URIs. "print" uses the PRINT variant (fallback WEB, then the original);
 * "measure" uses the small THUMBNAIL variant so the layout rounds stay fast (figure slots have
 * explicit sizes, so the image resolution never changes the layout).
 */
export async function loadDataUriAssets(doc: EditionDocument, quality: AssetQuality): Promise<{ source: AssetSource; missing: string[] }> {
  const storage = getStorage();
  const map = new Map<string, string>();
  const missing: string[] = [];
  for (const media of doc.media) {
    const candidates =
      quality === "print"
        ? [media.src.print?.key, media.src.web?.key, media.src.thumb?.key]
        : [media.src.thumb?.key, media.src.web?.key, media.src.print?.key];
    let done = false;
    for (const key of candidates) {
      if (!key) continue;
      const buffer = await storage.get(key);
      if (!buffer) continue;
      map.set(media.id, `data:${mimeForKey(key)};base64,${buffer.toString("base64")}`);
      done = true;
      break;
    }
    if (!done) missing.push(media.id);
  }
  return { source: (media: DocumentMedia) => map.get(media.id) ?? null, missing };
}

/** Signed http URLs (already in the document) — for the on-screen preview. */
export function signedUrlAssets(): AssetSource {
  return (media) => media.src.print?.url ?? media.src.web?.url ?? media.src.thumb?.url ?? null;
}

export async function launchBrowser(): Promise<Browser> {
  // A connected Browserbase renders instead of the Chromium on this machine. The page is the same —
  // fonts and pictures travel inside the HTML — so a host too small for a browser still prints.
  // When Browserbase cannot be reached, the local browser is the fallback, not a failed job.
  try {
    const remote = await connectBrowserbase();
    if (remote) return remote;
  } catch (err) {
    log.warn("Browserbase unavailable; rendering with the local browser", { err });
  }
  const executablePath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  return chromium.launch({
    executablePath,
    args: ["--font-render-hinting=none", "--disable-gpu", "--disable-dev-shm-usage"],
  });
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>, browser?: Browser): Promise<T> {
  if (browser) return fn(browser);
  const own = await launchBrowser();
  try {
    return await fn(own);
  } finally {
    await own.close().catch(() => {});
  }
}

async function loadHtml(page: Page, html: string) {
  await page.setContent(html, { waitUntil: "load", timeout: 180_000 });
  await page.evaluate(() => document.fonts.ready);
}

export async function measureHtml(page: Page, html: string): Promise<PageMeasurement[]> {
  await loadHtml(page, html);
  return (await page.evaluate(MEASURE_SCRIPT)) as PageMeasurement[];
}

export type RenderPdfOptions = {
  log?: (message: string, level?: "info" | "warn" | "error", meta?: Record<string, unknown>) => void;
  onProgress?: (done: number, total: number, message: string) => void | Promise<void>;
  browser?: Browser;
  maxRounds?: number;
};

export type RenderPdfResult = {
  buffer: Buffer;
  pageCount: number;
  layoutReport: LayoutReport;
  finalDocument: EditionDocument;
  /** The final, fully embedded print HTML (useful for debugging / screenshots). */
  html: string;
};

/**
 * Two-pass rendering: pass 1 measures and flows text (several rounds in the same browser page),
 * pass 2 renders the final HTML with print-quality assets and prints the PDF.
 */
export async function renderPdf(doc: EditionDocument, options: RenderPdfOptions = {}): Promise<RenderPdfResult> {
  const say = options.log ?? ((message, level = "info", meta) => log[level](message, meta));
  const progress = async (done: number, total: number, message: string) => {
    await options.onProgress?.(done, total, message);
  };
  await progress(1, 6, "Embedding fonts and images");
  const fontCss = await loadEmbeddedFontCss();
  const [measureAssets, printAssets] = await Promise.all([loadDataUriAssets(doc, "measure"), loadDataUriAssets(doc, "print")]);
  if (printAssets.missing.length) say(`${printAssets.missing.length} media file(s) could not be read from storage`, "warn", { missing: printAssets.missing });

  return withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      await progress(2, 6, "Measuring and flowing text");
      const { document: finalDocument, report } = await paginateDocument(doc, {
        render: (d) => renderDocumentHtml(d, { mode: "print", assetSource: measureAssets.source, fontCss }),
        measure: (html) => measureHtml(page, html),
        maxRounds: options.maxRounds,
        log: (message, meta) => say(message, "info", meta),
        engine: `chromium ${browser.version()}`,
      });
      await progress(3, 6, "Rendering final pages");
      const html = renderDocumentHtml(finalDocument, { mode: "print", assetSource: printAssets.source, fontCss });
      const finalMeasures = await measureHtml(page, html);
      await progress(4, 6, "Printing PDF");
      const raw = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      await progress(5, 6, "Stamping metadata");
      const pdf = await PDFDocument.load(raw, { updateMetadata: false });
      const pageCount = pdf.getPageCount();
      const generatedAt = new Date(finalDocument.meta.generatedAt);
      pdf.setTitle(`${finalDocument.meta.masthead.title} — ${finalDocument.meta.issueLabel}, ${finalDocument.meta.label}`);
      pdf.setAuthor(finalDocument.meta.masthead.title);
      pdf.setSubject(finalDocument.meta.issueLabel);
      pdf.setKeywords([finalDocument.meta.versionLabel, finalDocument.meta.generatedAt, finalDocument.meta.label, "Albert School"]);
      pdf.setProducer("Briefly publication pipeline");
      pdf.setCreator(`Briefly print renderer (Chromium ${browser.version()})`);
      pdf.setLanguage("en-GB");
      if (!Number.isNaN(generatedAt.getTime())) {
        pdf.setCreationDate(generatedAt);
        pdf.setModificationDate(generatedAt);
      }
      const buffer = Buffer.from(await pdf.save({ useObjectStreams: true }));
      const mismatch = pageCount !== finalDocument.pages.length ? { expected: finalDocument.pages.length, actual: pageCount } : undefined;
      if (mismatch) say("PDF page count differs from the paginated page count", "warn", mismatch);
      const layoutReport = buildLayoutReport(finalDocument, finalMeasures, {
        plannedPages: report.plannedPages,
        stats: { moved: report.blocksMoved, split: report.paragraphsSplit, added: report.continuationPagesAdded, copyfit: report.copyfitFlows },
        rounds: report.rounds,
        engine: report.engine,
        pageCountMismatch: mismatch,
      });
      await progress(6, 6, "PDF ready");
      say("pdf rendered", "info", { pages: pageCount, bytes: buffer.length, rounds: report.rounds, continuation: report.continuationPagesAdded });
      return { buffer, pageCount, layoutReport, finalDocument, html };
    } finally {
      await context.close().catch(() => {});
    }
  }, options.browser);
}

/**
 * Same HTML as the PDF pass, but with signed http URLs instead of data URIs and a preview
 * stylesheet (grey desk, centred pages, overflow markers). Used by the /print routes.
 */
export function renderPreviewHtml(doc: EditionDocument, options: { baseUrl?: string } = {}): string {
  const base = (options.baseUrl ?? env.NEXT_PUBLIC_APP_URL).replace(/\/$/, "");
  return renderDocumentHtml(doc, { mode: "preview", assetSource: signedUrlAssets(), fontCss: fontCssForUrls(base), preview: true });
}

/** Renders one page of the print HTML to a PNG (used for visual checks in development and tests). */
export async function screenshotPage(html: string, pageNumber: number, options: { browser?: Browser; scale?: number } = {}): Promise<Buffer> {
  return withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: options.scale ?? 1.5 });
    const page = await context.newPage();
    try {
      await loadHtml(page, html);
      const target = page.locator(`.page[data-number="${pageNumber}"]`);
      await target.scrollIntoViewIfNeeded();
      return await target.screenshot({ type: "png" });
    } finally {
      await context.close().catch(() => {});
    }
  }, options.browser);
}
