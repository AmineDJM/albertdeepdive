/**
 * The editorial rules of the page — shared by the engine that composes pages and the analysis that
 * grades them, so the layout pass can never aim at a target the quality gate does not recognise.
 *
 * Two bounded levers move a page's density. They are applied in the order a magazine art director
 * would: change what is on the page, then resize the pictures, and only then touch the type — body
 * copy has to stay readable, so the type band is deliberately the narrowest of the three.
 */

/** Copyfit: 2.5 % of type and leading per step. Positive shrinks, negative grows. */
export const FIT_LEVEL_RANGE = { min: -2, max: 4 } as const;

/** Figure height: 8 % per step. Positive shrinks the pictures, negative grows them. */
export const IMAGE_LEVEL_RANGE = { min: -2, max: 4 } as const;

export const DENSITY = {
  /** Editorial pages should sit in this band of the usable editorial area. */
  targetOccupancy: { min: 0.8, max: 0.95 },
  /** Below this — with a real gap at the foot — a normal page is accidentally empty. */
  hardOccupancyFloor: 0.72,
  /** A continuation page below this does not earn its paper. */
  continuationFloor: 0.55,
  /** Unused height under the last element, as a share of the sheet. */
  softTailGap: 0.12,
  hardTailGap: 0.25,
  /** Text-flow fill (columns actually set). */
  softFlowFill: 0.9,
  hardFlowFill: 0.75,
  /** Identical template repeated this many times in a row reads as machine-made. */
  repeatedTemplateRun: 3,
} as const;

/** Whitespace on these pages is a decision, not a defect. */
export const SPARSE_BY_DESIGN = new Set(["COVER_A", "COVER_B", "SECTION_OPENER", "QUOTE_PAGE"]);

/** These may run loose without failing the issue, but are still reported. */
export const LOOSE_ALLOWED = new Set(["CONTENTS", "BACK_PAGE", "PHOTO_STORY", "BDD_VISUAL", "EVENT"]);

/**
 * Layout variants an article page may be recomposed into, ordered by increasing text capacity.
 *
 * The engine does not decide up front that a story is "a hero page"; when a composition spills onto
 * a jump page that cannot earn its paper, it re-sets the story in a denser variant of the same
 * family and measures again. Structured pages (a Business Deep Dive case, an event, a cover) have
 * no alternative: their shape carries meaning.
 */
export const TEMPLATE_ALTERNATIVES: Record<string, readonly string[]> = {
  ARTICLE_HERO: ["ARTICLE_TWO_COLUMN", "ARTICLE_THREE_COLUMN"],
  ARTICLE_TWO_COLUMN: ["ARTICLE_THREE_COLUMN"],
  PROFILE: ["ARTICLE_TWO_COLUMN", "ARTICLE_THREE_COLUMN"],
  INTERVIEW: ["ARTICLE_TWO_COLUMN", "ARTICLE_THREE_COLUMN"],
  PHOTO_STORY: ["ARTICLE_TWO_COLUMN"],
  SHORTS: ["NEWS_GRID"],
};

export function fitFactor(level: number): string {
  return (1 - 0.025 * Math.max(FIT_LEVEL_RANGE.min, Math.min(FIT_LEVEL_RANGE.max, level))).toFixed(3);
}

export function imageScaleFactor(level: number): number {
  return 1 - 0.08 * Math.max(IMAGE_LEVEL_RANGE.min, Math.min(IMAGE_LEVEL_RANGE.max, level));
}
