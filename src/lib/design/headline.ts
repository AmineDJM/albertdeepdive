import type { FamilyKey } from "@/lib/brand/typography";
import type { TypeStyle } from "./type-scale";

/**
 * Composing a headline, rather than letting it wrap.
 *
 * §8 of the design brief, and the clearest single difference between a designed page and a
 * generated one:
 *
 *     THE FUTURE OF
 *     HEALTHCARE IS
 *     HERE
 *
 * Nobody chose that. It is what a container produces when the text is poured into it. A person
 * setting the same words tries the alternatives — two lines instead of three, a slightly smaller
 * size, a hair more tracking — and takes the one that balances, that breaks where the sense breaks,
 * and that does not leave one short word stranded on the last line.
 *
 * So this does the same thing: it enumerates the legitimate ways the words can be broken, scores
 * them, and adjusts size, tracking and leading inside bounds the design system allows. What it
 * never does is change the words. A headline is editorial copy, and shortening it to fit is a
 * copy-edit — a decision with a byline attached, not a layout tactic.
 */

/**
 * Character widths, in ems, as classes rather than a full metrics table.
 *
 * A real font file would be exact. It would also mean parsing four woff2 files at composition time
 * and keeping them in step with the design system — and the number needed here is not "the exact
 * width" but "does this line fit, and which of these breaks is the most balanced", which survives a
 * few percent of error. The browser measures for real during pagination; this is what lets the
 * composer decide *before* anything is rendered.
 */
const CLASSES: [RegExp, number][] = [
  [/[ilj|!.,;:'`’]/, 0.28],
  [/[ft(){}\[\]/\\-]/, 0.36],
  [/[rI]/, 0.4],
  [/[a-z]/, 0.52],
  [/[0-9]/, 0.56],
  [/[A-Z]/, 0.66],
  [/[mwMW@%]/, 0.88],
  [/\s/, 0.27],
];

/** Per-family correction: a grotesque sets narrower than a high-contrast serif at the same size. */
const FAMILY_WIDTH: Record<FamilyKey, number> = { fraunces: 1.02, newsreader: 0.97, inter: 1, plexMono: 1.2 };

/** Heavier weights are wider. Not linear, but close enough over the range the brand offers. */
function weightWidth(weight: number): number {
  return 1 + (weight - 400) * 0.00035;
}

/** Width of a string in ems, at the given style. Deterministic and cheap. */
export function widthInEms(text: string, style: Pick<TypeStyle, "family" | "weight" | "tracking" | "case">): number {
  const value = style.case === "upper" ? text.toUpperCase() : text;
  let width = 0;
  for (const character of value) {
    const match = CLASSES.find(([pattern]) => pattern.test(character));
    width += match ? match[1] : 0.55;
  }
  return width * FAMILY_WIDTH[style.family] * weightWidth(style.weight) + value.length * style.tracking;
}

export function widthOf(text: string, style: TypeStyle, size = style.size): number {
  return widthInEms(text, style) * size;
}

/* ── Where a line may not end ─────────────────────────────────────────────────────────────── */

/**
 * Words a line should not end on.
 *
 * Breaking after "of" or "the" separates a phrase from the thing it introduces, and the reader's
 * eye has to carry it across the line for no reason. Every language in the publication needs its
 * own list: French and Italian break differently, and a French line must never end on an
 * apostrophised article.
 */
const DANGLING: Record<string, Set<string>> = {
  en: new Set(["a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "but", "with", "as", "by", "from", "into", "than", "that", "is", "are", "was", "were", "its", "it", "their", "his", "her"]),
  fr: new Set(["le", "la", "les", "un", "une", "des", "du", "de", "au", "aux", "en", "et", "ou", "à", "dans", "par", "pour", "sur", "sous", "avec", "sans", "que", "qui", "ne", "se", "son", "sa", "ses", "leur", "leurs", "ce", "cet", "cette"]),
  it: new Set(["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "del", "della", "dei", "a", "al", "alla", "da", "in", "nel", "con", "su", "per", "tra", "fra", "e", "o", "che", "non", "si", "suo", "sua", "loro"]),
};

/** French keeps its article attached: "l'année" never breaks after the apostrophe. */
const ELIDED = /[’']$/;

function dangles(word: string, locale: string): boolean {
  const language = locale.slice(0, 2).toLowerCase();
  const set = DANGLING[language] ?? DANGLING.en;
  const clean = word.replace(/[^\p{L}\p{N}’']/gu, "").toLowerCase();
  return set.has(clean) || ELIDED.test(word) || clean.length === 1;
}

/* ── Composition ─────────────────────────────────────────────────────────────────────────── */

export type HeadlineOptions = {
  /** The width available, in the same unit as the style's size. */
  maxWidth: number;
  maxLines: number;
  locale?: string;
  /** How far the size may be reduced to find a better composition, as a fraction. */
  sizeFloor?: number;
  /** How far tracking may move, in ems. */
  trackingRange?: number;
};

export type HeadlineComposition = {
  lines: string[];
  size: number;
  tracking: number;
  leading: number;
  /** 0–1: how good this composition is. Balance, breaks, fill, line count. */
  score: number;
  problems: HeadlineProblem[];
  /** Whether the words fit at all, even after every allowed adjustment. */
  fits: boolean;
};

export type HeadlineProblem = "too-many-lines" | "overflows" | "dangling-break" | "stranded-word" | "unbalanced" | "single-word-line";

/** Every way these words can be broken into at most `maxLines` lines that each fit. */
function breaksFor(words: string[], maxLines: number, fits: (line: string[]) => boolean): string[][][] {
  const results: string[][][] = [];
  const walk = (index: number, current: string[][], line: string[]) => {
    if (results.length > 400) return; // A headline of thirty words does not need every permutation.
    if (index === words.length) {
      if (line.length) results.push([...current, line]);
      return;
    }
    const withWord = [...line, words[index]];
    if (fits(withWord)) walk(index + 1, current, withWord);
    if (line.length && current.length + 1 < maxLines) walk(index + 1, [...current, line], [words[index]]);
  };
  walk(0, [], []);
  return results;
}

/**
 * The best of the legitimate compositions.
 *
 * Scored on four things a typesetter would look at: how full the lines are, how even they are with
 * each other, whether any line ends where the sense does not, and whether the last line is a single
 * stranded word. Fewer lines wins ties, because a headline that reads in two lines is a better
 * headline than the same words in three.
 */
export function composeHeadline(text: string, style: TypeStyle, options: HeadlineOptions): HeadlineComposition {
  const locale = options.locale ?? "en";
  const words = text.trim().split(/\s+/).filter(Boolean);
  const floor = options.sizeFloor ?? 0.78;
  const trackingRange = options.trackingRange ?? 0.012;

  // Size and tracking are tried from the design's own values downward: the first setting that
  // composes well wins, so a headline is only shrunk when shrinking is what makes it work.
  const sizes = [1, 0.96, 0.92, 0.88, 0.84, floor].map((factor) => Math.round(style.size * factor * 100) / 100).filter((size, i, all) => all.indexOf(size) === i && size >= style.size * floor);
  const trackings = [style.tracking, style.tracking - trackingRange / 2, style.tracking + trackingRange / 2, style.tracking - trackingRange];

  let best: HeadlineComposition | null = null;

  for (const size of sizes) {
    for (const tracking of trackings) {
      const measured = { ...style, tracking };
      const fits = (line: string[]) => widthOf(line.join(" "), measured, size) <= options.maxWidth;
      // A single word longer than the measure can never fit; the composition is reported rather
      // than silently overflowing, because the answer is a copy-edit and only a person may make it.
      if (words.some((word) => !fits([word]))) continue;

      for (const candidate of breaksFor(words, options.maxLines, fits)) {
        const lines = candidate.map((line) => line.join(" "));
        const widths = lines.map((line) => widthOf(line, measured, size) / options.maxWidth);
        const scored = scoreLines(lines, widths, locale);
        const composition: HeadlineComposition = {
          lines,
          size,
          tracking: Math.round(tracking * 1000) / 1000,
          leading: style.leading,
          // A smaller setting is a compromise: it competes, but it starts behind.
          score: Math.round((scored.score - (1 - size / style.size) * 0.5) * 1000) / 1000,
          problems: scored.problems,
          fits: true,
        };
        if (!best || composition.score > best.score) best = composition;
      }
    }
  }

  if (best) return best;

  // Nothing composed. Say so with the greedy break, which is what would have happened anyway, and
  // name the problem so the repair pass and the editor both know what they are looking at.
  const greedy = greedyLines(words, style, options.maxWidth, style.size);
  const widths = greedy.map((line) => widthOf(line, style, style.size) / options.maxWidth);
  const scored = scoreLines(greedy, widths, locale);
  return {
    lines: greedy,
    size: style.size,
    tracking: style.tracking,
    leading: style.leading,
    score: 0,
    problems: [...new Set<HeadlineProblem>([...scored.problems, greedy.length > options.maxLines ? "too-many-lines" : "overflows"])],
    fits: false,
  };
}

function greedyLines(words: string[], style: TypeStyle, maxWidth: number, size: number): string[] {
  const lines: string[] = [];
  let line: string[] = [];
  for (const word of words) {
    const next = [...line, word];
    if (line.length && widthOf(next.join(" "), style, size) > maxWidth) {
      lines.push(line.join(" "));
      line = [word];
    } else {
      line = next;
    }
  }
  if (line.length) lines.push(line.join(" "));
  return lines;
}

function scoreLines(lines: string[], widths: number[], locale: string): { score: number; problems: HeadlineProblem[] } {
  const problems: HeadlineProblem[] = [];
  const last = lines[lines.length - 1];

  // Fill: lines that use the measure look deliberate; lines at 40% look like an accident.
  const fill = widths.reduce((n, w) => n + w, 0) / widths.length;
  // Balance: how even the lines are. A ragged headline is fine; a headline of 95% then 20% is not.
  const spread = Math.max(...widths) - Math.min(...widths);
  const balance = 1 - Math.min(1, spread);

  let penalty = 0;
  for (const [index, line] of lines.entries()) {
    if (index === lines.length - 1) continue;
    const words = line.split(/\s+/);
    if (dangles(words[words.length - 1], locale)) {
      problems.push("dangling-break");
      penalty += 0.22;
    }
  }
  if (lines.length > 1 && last.split(/\s+/).length === 1) {
    // One word alone on the last line is the classic stranded headline word.
    problems.push("stranded-word");
    penalty += 0.3;
  }
  if (lines.length > 1 && widths[widths.length - 1] < 0.25) {
    problems.push("single-word-line");
    penalty += 0.12;
  }
  if (spread > 0.55) problems.push("unbalanced");

  // Fewer lines is better, and the last line being shortest is how headlines are supposed to fall.
  const lineBonus = 1 / lines.length;
  const score = Math.max(0, 0.42 * fill + 0.28 * balance + 0.3 * lineBonus - penalty);
  return { score, problems: [...new Set(problems)] };
}

/* ── Body copy ───────────────────────────────────────────────────────────────────────────── */

export type CopyProblem = { code: "widow" | "orphan" | "short-last-line" | "too-narrow" | "too-wide"; where: number; detail: string };

/**
 * The defects §43 asks to detect in running text.
 *
 * A widow is a last line left alone at the top of a column; an orphan is a first line left alone at
 * the bottom. Both are measured here from line counts rather than guessed, because the pagination
 * pass already knows where every column breaks — this names what it found.
 */
export function copyProblems(input: { linesPerParagraph: number[]; linesInColumn: number; measureChars: number; min: number; max: number }): CopyProblem[] {
  const problems: CopyProblem[] = [];
  if (input.measureChars < input.min) problems.push({ code: "too-narrow", where: -1, detail: `${input.measureChars} characters a line is below this publication's ${input.min}` });
  if (input.measureChars > input.max) problems.push({ code: "too-wide", where: -1, detail: `${input.measureChars} characters a line is above this publication's ${input.max}` });

  let line = 0;
  for (const [index, lines] of input.linesPerParagraph.entries()) {
    const start = line % input.linesInColumn;
    const remaining = input.linesInColumn - start;
    if (lines > 1 && remaining === 1) problems.push({ code: "orphan", where: index, detail: "a paragraph starts on the last line of a column" });
    const spill = (start + lines) % input.linesInColumn;
    if (lines > 1 && start + lines > input.linesInColumn && spill === 1) problems.push({ code: "widow", where: index, detail: "a paragraph ends alone at the top of a column" });
    line += lines;
  }
  return problems;
}

/**
 * French and Italian punctuation, set the way those languages set it.
 *
 * French puts a thin non-breaking space before its high punctuation and inside its quotation marks.
 * Getting this wrong is the first thing a French reader notices and the last thing an English
 * renderer thinks about — and it is a *typographic* fix, not a translation one, so it belongs here
 * rather than in the copy.
 */
export function applyLocaleSpacing(text: string, locale: string): string {
  if (!locale.toLowerCase().startsWith("fr")) return text;
  const narrow = " "; // narrow no-break space
  return text
    .replace(/\s*([;:!?])/g, `${narrow}$1`)
    .replace(/«\s*/g, `«${narrow}`)
    .replace(/\s*»/g, `${narrow}»`)
    .replace(/(\d)\s+(\d{3})/g, `$1${narrow}$2`);
}
