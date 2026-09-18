/**
 * The craft rules, written down.
 *
 * Every number in the design engine used to be a constant somebody chose. These are the ones that
 * are not arbitrary — they come from typography, from the accessibility standard, from the
 * platforms' own documented behaviour, or from long convention — and writing them here with their
 * source means the next person can tell the difference between a rule and a preference, and knows
 * what they are overruling when they change one.
 *
 * Two kinds, kept apart:
 *
 *   ENFORCED rules are arithmetic. The composer applies them and there is no way to produce output
 *   that breaks one, because the code cannot express it. Contrast, measure, minimum size.
 *
 *   CHECKED rules are judgement. The QA pass reports them and a person decides. A carousel that
 *   opens on a label instead of a claim is usually a mistake and is occasionally the point.
 *
 * Nothing here is cited to "best practice". If a rule has no source better than taste, it says so.
 */

export type LawKind = "enforced" | "checked";

export type Law = {
  id: string;
  name: string;
  /** Where it comes from. "Convention" is an honest answer; "best practice" is not. */
  source: string;
  rule: string;
  /** Why, so somebody can decide when it is worth breaking. */
  because: string;
  kind: LawKind;
};

/* ── Typography ───────────────────────────────────────────────────────────────────────────── */

/**
 * Measure — the length of a line, in characters.
 *
 * Bringhurst gives 45–75 for a single-column page and calls 66 ideal. The reason is the return
 * sweep: past about 75 characters the eye loses the start of the next line and has to hunt for it,
 * and below about 45 it sweeps so often that the rhythm breaks.
 *
 * Display type is read differently — it is scanned in one or two fixations rather than swept — so it
 * wants a shorter measure, and a headline running 60 characters wide reads as body copy set large.
 */
export const MEASURE = { min: 45, ideal: 66, max: 75, displayMax: 38 } as const;

/**
 * Leading, as a multiple of size, for a given measure.
 *
 * The longer the line, the more leading it needs: the return sweep has further to travel and a tight
 * line-height makes it land on the wrong line. Short measures need less, and too much leading on a
 * short measure breaks the column into stripes.
 *
 * The brand's own leading is the starting point; this adjusts it for what the measure turned out to
 * be, which the brand cannot know in advance.
 */
export function leadingFor(baseLeading: number, measureChars: number): number {
  if (measureChars <= 0) return baseLeading;
  // ±8% across the usable range, which is about as much as can be applied before it reads as a
  // different typographic decision rather than as the same one fitted.
  const t = Math.max(-1, Math.min(1, (measureChars - MEASURE.ideal) / (MEASURE.max - MEASURE.min)));
  return Math.round(baseLeading * (1 + t * 0.08) * 1000) / 1000;
}

/**
 * The widest a text box may be before its lines get too long.
 *
 * Derived from the measured advance width of the actual typeface at the actual size, so it is a real
 * character count rather than an assumption about how wide a character is.
 */
export function maxMeasureWidth(fontSize: number, advancePerChar: number, maxChars: number): number {
  return fontSize * advancePerChar * maxChars;
}

/**
 * Apparent size: how big this type will actually be on a phone.
 *
 * The canvas is 1080 wide; a phone renders it at about 390. Type set at 24px in the image is under
 * 9px on screen, and every rule expressed in CSS pixels — the accessibility standard's large-text
 * threshold, the practical floor for legibility — is about the screen, not about the file.
 *
 * Getting this wrong is invisible in code and obvious in the hand, which is why it is a function
 * rather than a constant somebody remembers to apply.
 */
export const PHONE_WIDTH = 390;

export function apparentPx(fontSize: number, canvasWidth: number): number {
  return (fontSize * PHONE_WIDTH) / canvasWidth;
}

/**
 * The smallest type worth setting.
 *
 * Convention rather than standard: 11px on a phone is where a label stops being read and starts
 * being decoration. On a 1080 canvas that is about 30px.
 */
export const MIN_APPARENT_PX = 11;

export function minFontSize(canvasWidth: number): number {
  return Math.ceil((MIN_APPARENT_PX * canvasWidth) / PHONE_WIDTH);
}

/**
 * WCAG's large-text threshold, expressed in canvas pixels.
 *
 * The standard says 18pt (24px) regular or 14pt (18.66px) bold may use 3:1 instead of 4.5:1. Those
 * are screen pixels. At a 1080 canvas on a 390 phone the equivalent is about 66px regular — which is
 * a great deal larger than the 48px this engine used before the rule was written down, and that gap
 * is exactly the kind of thing a plausible-looking constant hides.
 */
export function largeTextThreshold(canvasWidth: number, bold: boolean): number {
  return ((bold ? 18.66 : 24) * canvasWidth) / PHONE_WIDTH;
}

/**
 * A widow: a last line carrying one word, or a stub of the measure.
 *
 * It is not a rendering fault — the words are all there — but it reads as a mistake, and on a
 * headline it is the difference between set and typed.
 */
export function isWidow(lines: string[], measureChars: number): boolean {
  if (lines.length < 2) return false;
  const last = lines[lines.length - 1];
  if (!last.includes(" ")) return true;
  return last.length < Math.max(8, measureChars * 0.22);
}

/**
 * Re-break a wrap so the last line is not a stub.
 *
 * Narrows the measure a little and re-wraps, which pulls a word down rather than pushing one up.
 * Returns null when no narrowing fixes it, so the caller can leave the text alone instead of
 * mangling it — a widow is worse than nothing, and a bad fix is worse than a widow.
 */
export function debalance(wrap: (width: number) => string[], width: number, measureChars: number): string[] | null {
  for (const factor of [0.94, 0.88, 0.82]) {
    const lines = wrap(width * factor);
    if (lines.length && !isWidow(lines, measureChars) && lines.length <= Math.ceil(measureChars / 8)) return lines;
  }
  return null;
}

/* ── Colour ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The 60/30/10 proportion.
 *
 * An interior-design convention that transferred to screen because it describes something real: a
 * composition needs one colour to hold it, one to give it structure and one to point. Three colours
 * in equal measure have no hierarchy, and the eye cannot tell what it is being shown.
 *
 * Across a carousel it is about how many frames sit on each surface, not about area within a frame.
 */
export const SURFACE_PROPORTION = { dominant: 0.6, secondary: 0.3, accent: 0.1 } as const;

/**
 * Whether two colours will vibrate against each other.
 *
 * Complementary hues at high chroma, placed adjacent, make an edge the eye cannot settle on — the
 * receptors for the two hues fire at the same boundary. Real, well documented, and easy to produce
 * by accident from two brand colours that were never meant to touch.
 *
 * Hue distance near 180° with both colours saturated is the condition. Either colour being
 * desaturated dissolves it, which is why a tinted version of the same pair is safe.
 *
 * Saturation is HSL, 0–1, because that is what the colour module can give for any hex. The floor is
 * set where a colour stops being a tint: below it the pair reads as two washes and the boundary
 * between them is quiet whatever the hues are.
 */
export const VIBRATION_SATURATION_FLOOR = 0.45;

export function vibrates(hueA: number, saturationA: number, hueB: number, saturationB: number): boolean {
  // The shortest way round the wheel: 0° is the same hue, 180° is the opposite one.
  const separation = 180 - Math.abs(Math.abs(hueA - hueB) - 180);
  return separation > 150 && saturationA > VIBRATION_SATURATION_FLOOR && saturationB > VIBRATION_SATURATION_FLOOR;
}

/** The same question asked of two hexes, which is how every caller actually has them. */
export function coloursVibrate(a: { hue: number; saturation: number }, b: { hue: number; saturation: number }): boolean {
  return vibrates(a.hue, a.saturation, b.hue, b.saturation);
}

/* ── Composition ──────────────────────────────────────────────────────────────────────────── */

/**
 * Optical alignment.
 *
 * Large type set flush left does not look flush left: the round left side of an "O" and the stem of
 * a "T" meet the margin differently, and quotation marks hang off it entirely. The correction is a
 * small negative inset proportional to size, applied only to display type — at body size it is
 * smaller than a pixel and applying it produces a misalignment rather than fixing one.
 */
export function opticalInset(fontSize: number, firstCharacter: string): number {
  if (fontSize < 48) return 0;
  if ('"“”'.includes(firstCharacter)) return Math.round(fontSize * 0.28);
  if ("OQCGoce".includes(firstCharacter)) return Math.round(fontSize * 0.018);
  if ("TVWYAJ".includes(firstCharacter)) return Math.round(fontSize * 0.012);
  return 0;
}

/* ── Conversion ───────────────────────────────────────────────────────────────────────────── */

/**
 * What the platforms actually do, which is not a matter of opinion.
 *
 * Instagram truncates a caption at roughly 125 characters behind a "more"; the first line is the
 * only one most people read. Hashtags past about five stopped helping years ago and now read as a
 * tell. A carousel's first frame decides whether the second is ever seen.
 */
export const CAPTION_VISIBLE_CHARS = 125;
export const MAX_HASHTAGS = 5;
export const CAROUSEL_SWEET_SPOT = { min: 5, max: 8 } as const;

/** Openers that describe the post instead of making a claim. A reader does not swipe for a label. */
export const WEAK_OPENERS = ["what happened", "introduction", "overview", "our news", "this month", "update", "newsletter", "recap"];

export function isWeakOpener(headline: string): boolean {
  const normalised = headline.trim().toLowerCase().replace(/[.:!?]+$/, "");
  return WEAK_OPENERS.some((weak) => normalised === weak || normalised.startsWith(`${weak} `));
}

/* ── The catalogue ────────────────────────────────────────────────────────────────────────── */

/**
 * Every rule, for the interface to show and for a person to argue with.
 *
 * Shown in the studio so the output is explicable: when Briefly quietens a headline or reports a
 * weak opener, somebody can see which rule said so and why.
 */
export const LAWS: Law[] = [
  {
    id: "measure",
    name: "Line length",
    source: "Bringhurst, The Elements of Typographic Style",
    rule: `Body lines run ${MEASURE.min}–${MEASURE.max} characters; ${MEASURE.ideal} is the mark. Display runs shorter, up to ${MEASURE.displayMax}.`,
    because: "Past about 75 characters the eye loses the start of the next line on the return sweep and has to hunt for it.",
    kind: "enforced",
  },
  {
    id: "leading",
    name: "Leading follows measure",
    source: "Bringhurst; standard practice",
    rule: "A longer line gets more leading, a shorter line less, within ±8% of the brand's own.",
    because: "The return sweep has further to travel on a long line, and tight leading makes it land on the wrong one.",
    kind: "enforced",
  },
  {
    id: "contrast",
    name: "Contrast",
    source: "WCAG 2.1 AA",
    rule: "4.5:1 for text, 3:1 for large text — where 'large' is judged by how big the type is on a phone, not in the file.",
    because: "A 1080px canvas is rendered at about 390px in a feed, so 24px in the file is under 9px in the hand.",
    kind: "enforced",
  },
  {
    id: "min-size",
    name: "Minimum size",
    source: "Convention",
    rule: `Nothing smaller than ${MIN_APPARENT_PX}px as it appears on a phone.`,
    because: "Below that a label is decoration: it is seen and not read, which is worse than leaving it out.",
    kind: "enforced",
  },
  {
    id: "safe-area",
    name: "Safe areas",
    source: "Instagram and TikTok interface documentation",
    rule: "No type under the platform's own interface — its header, its caption block, its button column.",
    because: "No amount of good design survives somebody else's UI sitting on top of it.",
    kind: "enforced",
  },
  {
    id: "spacing",
    name: "One spacing unit",
    source: "Convention",
    rule: "Every gap is a multiple of the brand's unit. There are no in-between values.",
    because: "Arbitrary gaps are the difference between a layout that was set and one that was nudged.",
    kind: "enforced",
  },
  {
    id: "optical-alignment",
    name: "Optical alignment",
    source: "Typographic practice",
    rule: "Display type is inset by a hair so round letters and quotation marks align optically rather than mathematically.",
    because: "An O set flush left looks indented; a quotation mark set flush left looks like a mistake.",
    kind: "enforced",
  },
  {
    id: "widows",
    name: "No widows",
    source: "Typographic practice",
    rule: "A headline's last line never carries a single word or a stub.",
    because: "The words are all there and it still reads as an accident.",
    kind: "enforced",
  },
  {
    id: "proportion",
    name: "60/30/10",
    source: "Interior and graphic design convention",
    rule: "One surface dominates a set, one gives it structure, one points.",
    because: "Three colours in equal measure have no hierarchy and the eye cannot tell what it is being shown.",
    kind: "checked",
  },
  {
    id: "vibration",
    name: "No vibrating pairs",
    source: "Colour theory — simultaneous contrast",
    rule: "Two saturated complementary colours are never placed edge to edge.",
    because: "The boundary between them is an edge the eye cannot settle on.",
    kind: "checked",
  },
  {
    id: "hook",
    name: "Open with a claim",
    source: "Editorial and social practice",
    rule: "The first frame says something, rather than announcing that something is about to be said.",
    because: "The first frame is the only one guaranteed to be seen; a label gives nobody a reason to swipe.",
    kind: "checked",
  },
  {
    id: "one-cta",
    name: "One thing to do",
    source: "Conversion practice",
    rule: "One call to action, at the end.",
    because: "Two asks is no ask: a reader given a choice of next steps takes neither.",
    kind: "checked",
  },
  {
    id: "caption-first-line",
    name: "The visible line",
    source: "Instagram caption truncation",
    rule: `The point is in the first ${CAPTION_VISIBLE_CHARS} characters.`,
    because: "Everything after that is behind a 'more' that most readers never press.",
    kind: "checked",
  },
  {
    id: "attribution",
    name: "Quotes are attributed",
    source: "Journalistic practice",
    rule: "Nothing in quotation marks appears without a name against it.",
    because: "An unattributed quotation is not a quotation, it is a claim in costume.",
    kind: "enforced",
  },
  {
    id: "verbatim-numbers",
    name: "Numbers verbatim",
    source: "Journalistic practice",
    rule: "A figure is shown exactly as the newsroom wrote it, never reformatted or rounded.",
    because: "A number rewritten is a number nobody has checked.",
    kind: "enforced",
  },
];

export function lawsOfKind(kind: LawKind): Law[] {
  return LAWS.filter((law) => law.kind === kind);
}

export function lawById(id: string): Law | undefined {
  return LAWS.find((law) => law.id === id);
}
