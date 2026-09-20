import sharp from "sharp";
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
 * An email export, and a picture of a page.
 *
 * These are the two ends of the range. An HTML newsletter — the thing Mailchimp or Brevo hands back
 * when somebody exports their last campaign — states its colours and its type in a stylesheet and
 * its structure in headings: it is the most *legible* format of the five. A screenshot states
 * nothing at all beyond its own pixels, and everything about it has to be seen rather than read.
 *
 * Both are worth accepting. Somebody who has only ever had a designer send them a JPEG of the
 * newsletter should still be able to say "like this", and the honest answer is a reading with
 * fewer certainties in it, not a refusal.
 */

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g;
/*
 * The declaration up to its terminator, quotes and all.
 *
 * Excluding quotes from the run looked tidier and matched nothing at all: `font-family: "Source
 * Sans Pro", Helvetica` stops dead at the opening quote, so every carefully-quoted family — which
 * is to say every family with a space in its name — came back empty and the reading reported that
 * the email named no type.
 */
const FAMILY = /font-family\s*:\s*([^;}]+)/gi;

function expand(hex: string): string | null {
  const value = hex.slice(1);
  if (value.length === 3) return `#${value.split("").map((c) => c + c).join("").toLowerCase()}`;
  if (value.length === 6 || value.length === 8) return `#${value.slice(0, 6).toLowerCase()}`;
  return null;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
}

export async function readHtml(bytes: Buffer): Promise<{ evidence: BlueprintEvidence; shots: Buffer[] }> {
  const evidence = emptyEvidence("html");
  const html = bytes.toString("utf8");

  const colours: BlueprintColour[] = [];
  // Counted rather than collected: a colour named forty times is the one the email is built on,
  // and one named once is a link somebody styled by hand.
  const tally = new Map<string, number>();
  for (const match of html.matchAll(HEX)) {
    const value = expand(match[0]);
    if (value) tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  for (const match of html.matchAll(RGB)) {
    const value = toHex(Number(match[1]), Number(match[2]), Number(match[3]));
    tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  const most = Math.max(1, ...tally.values());
  for (const [value, count] of tally) colours.push({ hex: value, weight: count / most, where: "stylesheet" });

  const fonts: BlueprintFont[] = [];
  for (const match of html.matchAll(FAMILY)) {
    // The first family in a stack is the intention; the rest are what happens when it is missing.
    const first = match[1].split(",")[0]?.replace(/["'>]/g, "").trim();
    if (first && !/^(inherit|initial|unset|sans-serif|serif|monospace|cursive|fantasy)$/i.test(first)) fonts.push({ family: first, role: "unknown", sizePt: null });
  }

  const outline: BlueprintOutlineItem[] = [];
  for (const match of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const body = match[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (body && body.length <= 120) outline.push({ level: Number(match[1]), text: body, occurrences: 1 });
  }

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ");
  const width = Number(/(?:max-)?width\s*:\s*(\d{3,4})px/i.exec(html)?.[1] ?? 0);
  if (width) {
    // An email's column width is its page: 600px is the one number every template agrees on.
    evidence.page = { widthPt: width * 0.75, heightPt: width * 0.75 * 1.6, orientation: "portrait", margins: null };
    evidence.notes.push(`The email is built on a ${width}px column, which is the width the blueprint keeps.`);
  }

  evidence.colours = rankColours(colours);
  evidence.fonts = mergeFonts(fonts);
  evidence.outline = foldOutline(outline);
  evidence.counts = {
    pages: 1,
    words: stripped.split(/\s+/).filter(Boolean).length,
    images: (html.match(/<img\b/gi) ?? []).length,
    headings: evidence.outline.length,
  };
  evidence.notes.push("Read from the stylesheet: the colours and the type are the ones the email declares.");
  return { evidence, shots: [] };
}

/**
 * A picture, quantised.
 *
 * The image is shrunk to a thumbnail and its pixels bucketed into a coarse cube, which is a blunt
 * instrument and the right one: the question is "what are the four or five colours this page is
 * made of", not "what is the exact value of pixel 12,880". Nothing else about a screenshot can be
 * measured, so everything else is left to the pass that looks at it.
 */
export async function readImage(bytes: Buffer): Promise<{ evidence: BlueprintEvidence; shots: Buffer[] }> {
  const evidence = emptyEvidence("image");
  let shot = bytes;
  try {
    const image = sharp(bytes, { failOn: "none" });
    const meta = await image.metadata();
    if (meta.width && meta.height) {
      evidence.page = { widthPt: meta.width * 0.75, heightPt: meta.height * 0.75, orientation: orientationOf(meta.width, meta.height), margins: null };
    }
    const { data, info } = await sharp(bytes, { failOn: "none" }).resize(64, 64, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
    for (let at = 0; at + 2 < data.length; at += info.channels) {
      const [r, g, b] = [data[at], data[at + 1], data[at + 2]];
      const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
      const seen = buckets.get(key);
      if (seen) {
        seen.count += 1;
        seen.r += r;
        seen.g += g;
        seen.b += b;
      } else buckets.set(key, { count: 1, r, g, b });
    }
    const pixels = Math.max(1, [...buckets.values()].reduce((n, bucket) => n + bucket.count, 0));
    const colours: BlueprintColour[] = [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((bucket) => ({ hex: toHex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count), weight: bucket.count / pixels, where: "pixels" }));
    evidence.colours = rankColours(colours);
    evidence.counts = { pages: 1, words: 0, images: 1, headings: 0 };
    evidence.notes.push("A picture states nothing but its pixels, so the colours were measured and everything else was read by looking at it.");
    // Big screenshots cost tokens and add nothing: the layout is legible at a sane width.
    shot = await sharp(bytes, { failOn: "none" }).resize(1400, 1400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    evidence.notes.push("The picture could not be read.");
  }
  return { evidence, shots: [shot] };
}
