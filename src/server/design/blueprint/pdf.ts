import { PDFDocument } from "pdf-lib";
import {
  emptyEvidence,
  foldOutline,
  mergeFonts,
  orientationOf,
  rankColours,
  type BlueprintColour,
  type BlueprintEvidence,
  type BlueprintFont,
  type BlueprintOutlineItem,
} from "@/lib/design/blueprint";
import { harvest, inScratch, tool } from "./shell";

/**
 * A PDF, read for its design rather than its contents.
 *
 * This is the file a customer is most likely to have — "here is last month's" — and the one that
 * states the most about itself. `pdftohtml -xml` returns every run of type with the family it was
 * set in, its size in points and its colour, which between them answer nearly everything a
 * blueprint needs: what the headline face is, how big a headline is relative to body copy, and
 * which colours were actually used rather than which appear in the brand book.
 *
 * Headings are found by size, not by wording. The largest sizes on a page are its headings whatever
 * language they are in, and a rule that looked for "Édito" would read a German newsletter as having
 * no structure at all.
 */

type Run = { text: string; size: number; font: number; top: number };
type Spec = { id: number; size: number; family: string; colour: string };

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

/** `pdftohtml -xml` output, which is small, flat and predictable — a parser is not warranted. */
function parseXml(xml: string): { runs: Run[]; specs: Map<number, Spec>; pages: { width: number; height: number }[] } {
  const specs = new Map<number, Spec>();
  for (const tag of xml.match(/<fontspec[^>]*\/?>/g) ?? []) {
    const id = Number(attr(tag, "id"));
    if (!Number.isFinite(id)) continue;
    specs.set(id, { id, size: Number(attr(tag, "size")) || 0, family: attr(tag, "family") ?? "", colour: attr(tag, "color") ?? "" });
  }
  const pages: { width: number; height: number }[] = [];
  for (const tag of xml.match(/<page[^>]*>/g) ?? []) {
    pages.push({ width: Number(attr(tag, "width")) || 0, height: Number(attr(tag, "height")) || 0 });
  }
  const runs: Run[] = [];
  for (const match of xml.matchAll(/<text[^>]*top="(\d+)"[^>]*font="(\d+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = match[3]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const font = Number(match[2]);
    runs.push({ text, size: specs.get(font)?.size ?? 0, font, top: Number(match[1]) });
  }
  return { runs, specs, pages };
}

/**
 * Which runs are headings, from the sizes actually present.
 *
 * The body size is the one most of the type is set in — the mode, not the mean, because a single
 * enormous cover line would drag a mean upwards and leave a document with no headings at all.
 * Anything meaningfully larger is a heading, and the levels follow the distinct sizes downwards, so
 * a title with three heading sizes gets three levels and one with one gets one.
 */
export function outlineFromRuns(runs: Run[]): { outline: BlueprintOutlineItem[]; bodySize: number } {
  const byLength = new Map<number, number>();
  for (const run of runs) byLength.set(run.size, (byLength.get(run.size) ?? 0) + run.text.length);
  const bodySize = [...byLength.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  if (!bodySize) return { outline: [], bodySize: 0 };
  const headingSizes = [...new Set(runs.map((run) => run.size))].filter((size) => size >= bodySize * 1.15).sort((a, b) => b - a);
  const level = new Map(headingSizes.slice(0, 6).map((size, index) => [size, index + 1]));
  const outline: BlueprintOutlineItem[] = [];
  for (const run of runs) {
    const at = level.get(run.size);
    // A "heading" of two hundred characters is a paragraph in a large face, not a rubric.
    if (!at || run.text.length > 120) continue;
    outline.push({ level: at, text: run.text, occurrences: 1 });
  }
  return { outline: foldOutline(outline), bodySize };
}

export async function readPdf(bytes: Buffer, fileName: string): Promise<{ evidence: BlueprintEvidence; shots: Buffer[] }> {
  const evidence = emptyEvidence("pdf");
  const shots: Buffer[] = [];

  /*
   * The page in points comes from the file, always.
   *
   * `pdftohtml` reports its own canvas rather than the page — an A4 comes back as 892 × 1262,
   * which is the page at a zoom poppler chose — and a reader that took those numbers at face value
   * would report every A4 newsletter as an unknown paper size half again too big. So the geometry
   * is read from the PDF itself, and poppler's numbers are divided by the ratio between the two.
   * That way the type sizes are in real points whatever zoom a future poppler picks.
   */
  let pagePt: { width: number; height: number } | null = null;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    evidence.counts.pages = doc.getPageCount();
    if (doc.getPageCount()) {
      const size = doc.getPage(0).getSize();
      pagePt = { width: size.width, height: size.height };
      evidence.page = { widthPt: size.width, heightPt: size.height, orientation: orientationOf(size.width, size.height), margins: null };
    }
  } catch {
    evidence.notes.push("The file could not be opened as a PDF.");
  }

  await inScratch(bytes, fileName, async (filePath, dir) => {
    const xml = await tool("pdftohtml", ["-xml", "-i", "-nodrm", "-q", "-stdout", filePath], { timeoutMs: 45_000 });
    if (xml) {
      const { runs, specs, pages } = parseXml(xml);
      const scale = pagePt && pages[0]?.width ? pages[0].width / pagePt.width : 1;
      const { outline, bodySize } = outlineFromRuns(runs);
      evidence.outline = outline;
      evidence.counts.headings = outline.length;
      evidence.counts.words = runs.reduce((n, run) => n + run.text.split(/\s+/).filter(Boolean).length, 0);
      evidence.counts.pages = evidence.counts.pages || pages.length;
      if (!evidence.page && pages[0]?.width && pages[0]?.height) {
        // No geometry from the file itself: poppler's canvas at its own zoom is better than none,
        // and the note says the number is approximate.
        const widthPt = pages[0].width / 1.5;
        const heightPt = pages[0].height / 1.5;
        evidence.page = { widthPt, heightPt, orientation: orientationOf(widthPt, heightPt), margins: null };
        evidence.notes.push("The page size is approximate: it was taken from the rendering rather than from the file.");
      }

      // A family used for the biggest type is the heading face; the one carrying the body is the
      // body face. Both come from the file, which is why they are worth more than a guess.
      const inkByFont = new Map<number, number>();
      for (const run of runs) inkByFont.set(run.font, (inkByFont.get(run.font) ?? 0) + run.text.length);
      const fonts: BlueprintFont[] = [];
      const colours: BlueprintColour[] = [];
      const totalInk = [...inkByFont.values()].reduce((a, b) => a + b, 0) || 1;
      for (const spec of specs.values()) {
        if (!spec.family) continue;
        const ink = inkByFont.get(spec.id) ?? 0;
        if (!ink) continue;
        const role: BlueprintFont["role"] = bodySize && spec.size >= bodySize * 1.15 ? "heading" : bodySize && Math.abs(spec.size - bodySize) < 0.6 ? "body" : "unknown";
        fonts.push({ family: spec.family, role, sizePt: spec.size ? Math.round((spec.size / scale) * 10) / 10 : null });
        if (spec.colour) colours.push({ hex: spec.colour, weight: Math.min(1, ink / totalInk), where: "text" });
      }
      evidence.fonts = mergeFonts(fonts);
      evidence.colours = rankColours(colours);
      evidence.notes.push("Read with poppler: page size, embedded type and the colour of every run of text come from the file itself.");
    }

    if (!xml) evidence.notes.push("The PDF tools are not installed on this machine, so the type and the colours were read by looking at the pages rather than from the file.");

    const images = await tool("pdfimages", ["-list", filePath], { timeoutMs: 20_000 });
    if (images) evidence.counts.images = Math.max(0, images.trim().split("\n").length - 2);

    // Three pages is enough to see a title's rhythm: a cover, a spread and whatever follows.
    const drawn = await tool("pdftoppm", ["-jpeg", "-r", "100", "-f", "1", "-l", "3", filePath, "page"], { cwd: dir, timeoutMs: 60_000 });
    if (drawn !== null) shots.push(...(await harvest(dir, /^page.*\.jpg$/i, 3)));
  });

  if (!shots.length) evidence.notes.push("The pages could not be drawn, so the layout was read from what the file states rather than from looking at it.");
  return { evidence, shots };
}
