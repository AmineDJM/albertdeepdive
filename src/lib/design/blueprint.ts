import { z } from "zod";
import { safeHex } from "@/lib/brand/colour";

/**
 * What a file said about itself, before anybody interpreted it.
 *
 * "Here is our newsletter — make ours look like this" is the most natural thing a customer can say
 * about design, and the hardest to answer honestly. The temptation is to hand the file to a model
 * and adopt whatever comes back, which produces a confident description of a layout nobody can
 * check. So the reading happens in two passes, with a line between them.
 *
 * This is the first pass: what the file *states*. A PDF names its page size in points, lists the
 * fonts it embedded, and can be asked for the words it set. A PowerPoint carries its theme — six
 * colours and two type families — as XML. A Word document names its styles. An HTML email is a
 * stylesheet with the answers written down. None of that is inference; it is measurement, and it is
 * worth far more than an opinion about the same thing.
 *
 * The second pass, which happens in `@/server/design/blueprint`, shows the rendered pages to a
 * model and asks for the judgements a file cannot state: two columns or three, the masthead above
 * the rule or beside it, quiet or loud. Where the two disagree, this one wins.
 *
 * One thing is deliberately not kept: the words. A blueprint is a shape to pour next month into,
 * and next month's words are not in last month's file. Headings are the exception, and the whole
 * of "the look *and* the structure" — "Édito", "Les chiffres du mois", "Portrait" are the rhythm a
 * reader recognises between issues. Which of them is a recurring rubric and which is one issue's
 * headline is a judgement, and it is made by reading them, never by a list of French nouns.
 *
 * "Blueprint" rather than "model" because in this codebase a model is the thing that does the
 * reading, and a sentence with both words in it is a sentence nobody can follow. The interface
 * calls it what a customer calls it: *le modèle*.
 */

export const BLUEPRINT_KINDS = ["pdf", "docx", "pptx", "html", "image"] as const;
export type BlueprintKind = (typeof BLUEPRINT_KINDS)[number];

/** A colour the file itself used, with how much of it there was. */
export const blueprintColourSchema = z.object({
  hex: z.string(),
  /** 0–1, the share of the evidence this colour accounts for. Not a promise of pixel area. */
  weight: z.number().min(0).max(1),
  /** Where it was found: "theme", "text", "fill", "stylesheet", "pixels". */
  where: z.string(),
});
export type BlueprintColour = z.infer<typeof blueprintColourSchema>;

/** A type family the file named, and what it was used for when the file says. */
export const blueprintFontSchema = z.object({
  family: z.string(),
  /** As the file classifies it, not as we guess. */
  role: z.enum(["heading", "body", "both", "unknown"]).default("unknown"),
  /** Point size, when the file states one. */
  sizePt: z.number().positive().nullable().default(null),
});
export type BlueprintFont = z.infer<typeof blueprintFontSchema>;

export const blueprintPageSchema = z.object({
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  orientation: z.enum(["portrait", "landscape", "square"]),
  /** Only when the file states them; a margin measured off a picture is a guess, not evidence. */
  margins: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).nullable().default(null),
});
export type BlueprintPage = z.infer<typeof blueprintPageSchema>;

/** One line of the document's running order. The body text is not kept. */
export const blueprintOutlineItemSchema = z.object({
  /** 1 is the biggest thing on the page; 6 the smallest heading. */
  level: z.number().int().min(1).max(6),
  text: z.string().max(200),
  /** How often it appeared across pages or slides, which is what makes a rubric a rubric. */
  occurrences: z.number().int().min(1).default(1),
});
export type BlueprintOutlineItem = z.infer<typeof blueprintOutlineItemSchema>;

export const blueprintEvidenceSchema = z.object({
  kind: z.enum(BLUEPRINT_KINDS),
  colours: z.array(blueprintColourSchema).default([]),
  fonts: z.array(blueprintFontSchema).default([]),
  page: blueprintPageSchema.nullable().default(null),
  outline: z.array(blueprintOutlineItemSchema).default([]),
  counts: z.object({
    pages: z.number().int().min(0).default(0),
    words: z.number().int().min(0).default(0),
    images: z.number().int().min(0).default(0),
    headings: z.number().int().min(0).default(0),
  }),
  /** What was measured and what could not be, in the words the screen shows. */
  notes: z.array(z.string()).default([]),
});
export type BlueprintEvidence = z.infer<typeof blueprintEvidenceSchema>;

export function emptyEvidence(kind: BlueprintKind): BlueprintEvidence {
  return blueprintEvidenceSchema.parse({ kind, counts: { pages: 0, words: 0, images: 0, headings: 0 } });
}

/* ── Tidying what the readers found ───────────────────────────────────────────────────────── */

/** Ink and paper are not brand colours, and a document is mostly ink and paper. */
export function isNearMonochrome(hex: string): boolean {
  const value = safeHex(hex, "#000000").slice(1);
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = max / 255;
  return max - min < 18 || light > 0.96 || light < 0.06;
}

/**
 * The colours worth keeping, in the order they matter.
 *
 * Every document is ninety per cent black on white, so ranking by raw area returns black, white and
 * a grey — three facts about paper and none about a brand. The near-monochromes are therefore set
 * aside rather than dropped: a title genuinely printed in black and white must still be readable as
 * that, so they come back behind the rest, and the notes say what happened.
 */
export function rankColours(found: BlueprintColour[], limit = 8): BlueprintColour[] {
  const merged = new Map<string, BlueprintColour>();
  for (const colour of found) {
    const hex = safeHex(colour.hex, "").toLowerCase();
    if (!hex) continue;
    const seen = merged.get(hex);
    if (seen) seen.weight = Math.min(1, seen.weight + colour.weight);
    else merged.set(hex, { ...colour, hex });
  }
  const all = [...merged.values()].sort((a, b) => b.weight - a.weight);
  const coloured = all.filter((colour) => !isNearMonochrome(colour.hex));
  const neutral = all.filter((colour) => isNearMonochrome(colour.hex));
  return [...coloured, ...neutral].slice(0, limit);
}

/** "ABCDEF+HelveticaNeue-Bold" is how a PDF names a font. A person calls it "Helvetica Neue". */
export function normaliseFamily(raw: string): string {
  const withoutSubset = raw.replace(/^[A-Z]{6}\+/, "");
  const withoutStyle = withoutSubset.replace(/[-_,]?\s*(bold|italic|oblique|light|regular|medium|semibold|black|thin|roman|condensed|extended|psmt|mt|ms|ps)\b/gi, "");
  const spaced = withoutStyle.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.replace(/\s+/g, " ").trim() || raw.trim();
}

export function mergeFonts(found: BlueprintFont[], limit = 6): BlueprintFont[] {
  const merged = new Map<string, BlueprintFont>();
  for (const font of found) {
    const family = normaliseFamily(font.family);
    if (!family || family.length > 60) continue;
    const key = family.toLowerCase();
    const seen = merged.get(key);
    if (!seen) merged.set(key, { ...font, family });
    else if (seen.role === "unknown" && font.role !== "unknown") merged.set(key, { ...seen, role: font.role });
  }
  return [...merged.values()].slice(0, limit);
}

/**
 * The running order, with the repeats counted.
 *
 * A heading that appears on four of six pages is a rubric; one that appears once is a headline.
 * Counting is measurement and belongs here; deciding what the count *means* is judgement and does
 * not.
 */
export function foldOutline(items: BlueprintOutlineItem[], limit = 40): BlueprintOutlineItem[] {
  const merged = new Map<string, BlueprintOutlineItem>();
  for (const item of items) {
    const text = item.text.replace(/\s+/g, " ").trim();
    if (!text || text.length > 200) continue;
    const key = `${item.level}:${text.toLowerCase()}`;
    const seen = merged.get(key);
    if (seen) seen.occurrences += item.occurrences;
    else merged.set(key, { ...item, text });
  }
  return [...merged.values()].slice(0, limit);
}

export function orientationOf(widthPt: number, heightPt: number): BlueprintPage["orientation"] {
  const ratio = widthPt / heightPt;
  if (ratio > 1.05) return "landscape";
  if (ratio < 0.95) return "portrait";
  return "square";
}

const PAPERS: { name: string; w: number; h: number }[] = [
  { name: "A4", w: 595, h: 842 },
  { name: "A3", w: 842, h: 1191 },
  { name: "A5", w: 420, h: 595 },
  { name: "US Letter", w: 612, h: 792 },
  { name: "US Legal", w: 612, h: 1008 },
  { name: "US Tabloid", w: 792, h: 1224 },
  { name: "16:9 slide", w: 960, h: 540 },
  { name: "4:3 slide", w: 720, h: 540 },
];

/** The name a printer would use for these dimensions, within a few points either way. */
export function paperName(widthPt: number, heightPt: number): string | null {
  const matches = (a: number, b: number) => Math.abs(a - b) <= 6;
  for (const paper of PAPERS) {
    if ((matches(widthPt, paper.w) && matches(heightPt, paper.h)) || (matches(widthPt, paper.h) && matches(heightPt, paper.w))) return paper.name;
  }
  return null;
}

/**
 * The evidence as a paragraph, for the pass that has to reason about it.
 *
 * Written rather than serialised: JSON in a prompt reads as data to copy back, and the point of the
 * second pass is that what was measured is weighed against what can be seen. Numbers are rounded to
 * the precision they deserve — a page is "595 × 842 pt (A4, portrait)", not 595.2755905511812.
 */
export function describeEvidence(evidence: BlueprintEvidence): string {
  const lines: string[] = [];
  lines.push(`Format: ${evidence.kind.toUpperCase()}.`);
  if (evidence.page) {
    const { widthPt, heightPt, orientation } = evidence.page;
    lines.push(`Page: ${Math.round(widthPt)} × ${Math.round(heightPt)} pt (${paperName(widthPt, heightPt) ?? "custom"}, ${orientation}).`);
    if (evidence.page.margins) {
      const m = evidence.page.margins;
      lines.push(`Margins the file states: ${[m.top, m.right, m.bottom, m.left].map((n) => Math.round(n)).join(" / ")} pt (top/right/bottom/left).`);
    }
  }
  lines.push(`Extent: ${evidence.counts.pages} page(s), ${evidence.counts.words} words, ${evidence.counts.images} image(s), ${evidence.counts.headings} heading(s).`);
  lines.push(evidence.colours.length ? `Colours it used, most prominent first: ${evidence.colours.map((colour) => `${colour.hex} (${colour.where})`).join(", ")}.` : "Colours: none could be measured.");
  lines.push(evidence.fonts.length ? `Type it named: ${evidence.fonts.map((font) => (font.role === "unknown" ? font.family : `${font.family} — ${font.role}`)).join(", ")}.` : "Type: the file named no families.");
  if (evidence.outline.length) {
    lines.push("Its running order, with how many times each line appeared:");
    for (const item of evidence.outline) lines.push(`  ${"  ".repeat(item.level - 1)}- ${item.text}${item.occurrences > 1 ? ` (x${item.occurrences})` : ""}`);
  } else lines.push("Running order: no headings were found.");
  if (evidence.notes.length) lines.push(`Notes from reading it: ${evidence.notes.join(" ")}`);
  return lines.join("\n");
}

/**
 * What the upload control offers, as an `accept` attribute.
 *
 * It lives here rather than beside the readers because a browser needs it: importing it from the
 * server module dragged `node:child_process` into the client bundle through the PDF reader, and
 * the build said so in the only way webpack knows how.
 */
export const BLUEPRINT_ACCEPT =
  ".pdf,.docx,.doc,.pptx,.ppt,.html,.htm,.mjml,.png,.jpg,.jpeg,.webp,.avif,application/pdf,image/*";
