import JSZip from "jszip";
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

/**
 * Word and PowerPoint, which say more about themselves than any other format.
 *
 * Both are zips of XML, and both carry a *theme*: a named set of six accent colours and two type
 * families, one for headings and one for body. That is a brand palette, written down by the person
 * who made the file, with no inference of any kind. A deck made from a corporate template is very
 * nearly a completed blueprint before anybody looks at a single slide.
 *
 * Word also names its own headings — `Heading1`, `Titre 2`, whatever the locale calls them — as a
 * style rather than as a font size, so the running order comes out exactly as the author meant it.
 */

const EMU_PER_POINT = 12700;
const TWIPS_PER_POINT = 20;

function text(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
}

function attrs(xml: string, tag: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`, "g"))].map((m) => m[1]);
}

function hex(value: string): string | null {
  const clean = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean.toLowerCase()}` : null;
}

async function unzip(bytes: Buffer): Promise<JSZip | null> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    return null;
  }
}

async function readFile(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  return entry ? entry.async("string") : null;
}

/**
 * The theme, which is the best evidence either format offers.
 *
 * `dk1`/`lt1` are the document's ink and paper; `accent1`…`accent6` are the brand. They are read in
 * that order and weighted accordingly, so the ranking that follows puts the accents first without
 * having to guess which of six colours somebody considers "theirs".
 */
function readTheme(theme: string): { colours: BlueprintColour[]; fonts: BlueprintFont[] } {
  const colours: BlueprintColour[] = [];
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(theme)?.[0] ?? "";
  const named = [...scheme.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g)];
  for (const [, name, body] of named) {
    const srgb = /<a:srgbClr val="([^"]+)"/.exec(body)?.[1];
    const value = srgb ? hex(srgb) : null;
    if (!value) continue;
    const weight = name.startsWith("accent") ? 0.9 - Number(name.slice(-1)) * 0.1 : 0.15;
    colours.push({ hex: value, weight: Math.max(0.05, weight), where: "theme" });
  }
  const fonts: BlueprintFont[] = [];
  const major = /<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(theme)?.[1];
  const minor = /<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(theme)?.[1];
  if (major) fonts.push({ family: major, role: "heading", sizePt: null });
  if (minor) fonts.push({ family: minor, role: "body", sizePt: null });
  return { colours, fonts };
}

export async function readDocx(bytes: Buffer): Promise<{ evidence: BlueprintEvidence; shots: Buffer[] }> {
  const evidence = emptyEvidence("docx");
  const zip = await unzip(bytes);
  if (!zip) {
    evidence.notes.push("The file could not be opened as a Word document.");
    return { evidence, shots: [] };
  }

  const document = (await readFile(zip, "word/document.xml")) ?? "";
  const styles = (await readFile(zip, "word/styles.xml")) ?? "";
  const theme = (await readFile(zip, "word/theme/theme1.xml")) ?? "";
  const app = (await readFile(zip, "docProps/app.xml")) ?? "";

  const colours: BlueprintColour[] = [];
  const fonts: BlueprintFont[] = [];
  if (theme) {
    const read = readTheme(theme);
    colours.push(...read.colours);
    fonts.push(...read.fonts);
    evidence.notes.push("The document carries a theme, so its palette and its two type families are the ones its author set.");
  }
  for (const family of attrs(styles + document, "w:rFonts", "w:ascii")) fonts.push({ family, role: "unknown", sizePt: null });
  for (const value of attrs(styles + document, "w:color", "w:val")) {
    const found = hex(value);
    if (found) colours.push({ hex: found, weight: 0.2, where: "text" });
  }

  /*
   * The running order, from the styles the author applied.
   *
   * A paragraph that says it is `Heading2` is a heading in any language, which is the whole reason
   * to read the style rather than the size: "Titre 2", "Überschrift 2" and "Heading 2" are one
   * thing, and a reader that matched on the words would find structure only in English documents.
   */
  const outline: BlueprintOutlineItem[] = [];
  let words = 0;
  for (const paragraph of text(document, "w:p")) {
    const body = text(paragraph, "w:t").join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!body) continue;
    words += body.split(/\s+/).filter(Boolean).length;
    const style = /<w:pStyle[^>]*w:val="([^"]*)"/.exec(paragraph)?.[1] ?? "";
    const level = /^(heading|titre|titel|berschrift|t[ií]tulo)\s*(\d)/i.exec(style.replace(/^Ü/, ""))?.[2] ?? (/^(heading|title)$/i.test(style) ? "1" : null);
    if (!level || body.length > 120) continue;
    outline.push({ level: Math.min(6, Math.max(1, Number(level))), text: body, occurrences: 1 });
  }

  const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(document)?.[0] ?? "";
  const size = /<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"/.exec(sectPr);
  if (size) {
    const widthPt = Number(size[1]) / TWIPS_PER_POINT;
    const heightPt = Number(size[2]) / TWIPS_PER_POINT;
    const margin = /<w:pgMar[^>]*w:top="(-?\d+)"[^>]*w:right="(\d+)"[^>]*w:bottom="(-?\d+)"[^>]*w:left="(\d+)"/.exec(sectPr);
    evidence.page = {
      widthPt,
      heightPt,
      orientation: orientationOf(widthPt, heightPt),
      margins: margin
        ? { top: Number(margin[1]) / TWIPS_PER_POINT, right: Number(margin[2]) / TWIPS_PER_POINT, bottom: Number(margin[3]) / TWIPS_PER_POINT, left: Number(margin[4]) / TWIPS_PER_POINT }
        : null,
    };
  }

  evidence.colours = rankColours(colours);
  evidence.fonts = mergeFonts(fonts);
  evidence.outline = foldOutline(outline);
  evidence.counts = {
    pages: Number(/<Pages>(\d+)<\/Pages>/.exec(app)?.[1] ?? 0),
    words: Number(/<Words>(\d+)<\/Words>/.exec(app)?.[1] ?? words),
    images: Object.values(zip.files).filter((entry) => !entry.dir && entry.name.startsWith("word/media/")).length,
    headings: evidence.outline.length,
  };
  return { evidence, shots: [] };
}

export async function readPptx(bytes: Buffer): Promise<{ evidence: BlueprintEvidence; shots: Buffer[] }> {
  const evidence = emptyEvidence("pptx");
  const zip = await unzip(bytes);
  if (!zip) {
    evidence.notes.push("The file could not be opened as a PowerPoint deck.");
    return { evidence, shots: [] };
  }

  const presentation = (await readFile(zip, "ppt/presentation.xml")) ?? "";
  const theme = (await readFile(zip, "ppt/theme/theme1.xml")) ?? "";
  const colours: BlueprintColour[] = [];
  const fonts: BlueprintFont[] = [];
  if (theme) {
    const read = readTheme(theme);
    colours.push(...read.colours);
    fonts.push(...read.fonts);
    evidence.notes.push("The deck carries a theme, so its palette and its two type families are the ones its author set.");
  }

  const size = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presentation);
  if (size) {
    const widthPt = Number(size[1]) / EMU_PER_POINT;
    const heightPt = Number(size[2]) / EMU_PER_POINT;
    evidence.page = { widthPt, heightPt, orientation: orientationOf(widthPt, heightPt), margins: null };
  }

  /*
   * A slide's title is the one shape that says it is the title.
   *
   * PowerPoint marks it with a placeholder type, so the running order of a deck is exact — which
   * makes a deck the most reliable structure of any format here, and the reason a customer whose
   * "newsletter" is really a monthly deck gets the best reading of all.
   */
  const outline: BlueprintOutlineItem[] = [];
  let words = 0;
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));
  for (const name of slideNames) {
    const slide = (await readFile(zip, name)) ?? "";
    for (const shape of text(slide, "p:sp")) {
      const body = text(shape, "a:t").join(" ").replace(/\s+/g, " ").trim();
      if (!body) continue;
      words += body.split(/\s+/).filter(Boolean).length;
      const placeholder = /<p:ph[^>]*type="([^"]*)"/.exec(shape)?.[1] ?? "";
      if (body.length > 120) continue;
      if (placeholder === "title" || placeholder === "ctrTitle") outline.push({ level: 1, text: body, occurrences: 1 });
      else if (placeholder === "subTitle") outline.push({ level: 2, text: body, occurrences: 1 });
    }
    for (const value of attrs(slide, "a:srgbClr", "val")) {
      const found = hex(value);
      if (found) colours.push({ hex: found, weight: 0.25, where: "fill" });
    }
  }

  evidence.colours = rankColours(colours);
  evidence.fonts = mergeFonts(fonts);
  evidence.outline = foldOutline(outline);
  evidence.counts = {
    pages: slideNames.length,
    words,
    images: Object.values(zip.files).filter((entry) => !entry.dir && entry.name.startsWith("ppt/media/")).length,
    headings: evidence.outline.length,
  };
  return { evidence, shots: [] };
}
