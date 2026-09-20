/**
 * The vocabulary an edition is composed in.
 *
 * Not a template list. A role says what something *is* — a lead story, a pull quote, a stat, a
 * section opener — and a composition says one legitimate way to draw it. The same role has several
 * compositions and the design director chooses between them from context, which is the difference
 * between "a magazine has a visual system" and "a magazine has four templates".
 *
 * Everything here is a closed set on purpose. A role that does not exist is a compile error rather
 * than a string nobody renders, and a model that invents `"fancy-hero-2"` is refused at the schema
 * boundary instead of producing a blank page.
 */

/**
 * How much this piece of the edition matters, which is the first thing design must know and the
 * thing Briefly has never recorded.
 *
 * Without it every article is an article, every article gets the same card, and the edition has no
 * editorial character — which is the failure §5 of the design brief names.
 */
export const IMPORTANCE = ["COVER", "LEAD", "MAJOR", "STANDARD", "BRIEF", "SUPPORTING"] as const;
export type Importance = (typeof IMPORTANCE)[number];

/** Where an importance sits on a 0–1 scale, for the arithmetic that has to rank things. */
export const IMPORTANCE_WEIGHT: Record<Importance, number> = {
  COVER: 1,
  LEAD: 0.85,
  MAJOR: 0.65,
  STANDARD: 0.45,
  BRIEF: 0.25,
  SUPPORTING: 0.15,
};

/** The media an edition is made for. Each has a renderer; none is the master. */
export const OUTPUT_MEDIA = ["print", "web", "email", "docx", "social"] as const;
export type OutputMedium = (typeof OUTPUT_MEDIA)[number];

/**
 * The design grammar's primitives.
 *
 * A block is one of these. The list is deliberately editorial rather than technical: there is no
 * "card", no "container" and no "section wrapper", because naming the box instead of the thing is
 * how a publication turns into a stack of rounded rectangles.
 */
export const BLOCK_ROLES = [
  // Front matter and furniture
  "masthead",
  "cover",
  "contents",
  "section-opener",
  "editorial-note",
  "credits",
  "colophon",
  "sponsor",
  // Stories, by the weight they carry
  "hero",
  "lead",
  "feature",
  "secondary",
  "brief",
  "brief-group",
  // Editorial punctuation
  "quote",
  "pull-quote",
  "stat",
  "stat-group",
  "timeline",
  "table",
  "chart",
  "callout",
  "sidebar",
  "divider",
  // People and pictures
  "portrait",
  "contributor",
  "photo",
  "photo-pair",
  "photo-grid",
  "photo-spread",
  // Ways out
  "cta",
  "events",
  "footer",
] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

/**
 * The pieces inside a block.
 *
 * An element is the smallest addressable thing in the design, which matters because "make this
 * bigger" has to be able to mean this headline rather than this story.
 */
export const ELEMENT_ROLES = [
  "kicker",
  "headline",
  "subheadline",
  "deck",
  "byline",
  "dateline",
  "body",
  "excerpt",
  "quote",
  "attribution",
  "image",
  "caption",
  "credit",
  "stat-value",
  "stat-label",
  "label",
  "rule",
  "logo",
  "page-number",
  "link",
  "list",
  "table",
  "chart",
] as const;
export type ElementRole = (typeof ELEMENT_ROLES)[number];

/**
 * A surface is a place where blocks sit together, and the only thing the design says about pages.
 *
 * Print turns a surface into one page or a spread; the web turns it into a section of the scroll;
 * email turns it into a group of tables. Putting *pages* in the design would make print the master
 * and every other medium a translation of it, which is the architecture this engine exists to
 * replace.
 */
export const SURFACE_KINDS = ["cover", "opener", "spread", "flow", "close"] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

/**
 * The compositions each role may be drawn in.
 *
 * This is the map the director chooses from and the list "Change layout" offers, so a role with one
 * composition is a role with no choice — which is fine for a divider and wrong for a lead story.
 * The drawing lives in the renderers; this says only what exists.
 */
export const COMPOSITIONS: Record<BlockRole, readonly string[]> = {
  masthead: ["classic", "stacked", "rule-under", "minimal"],
  cover: ["image-led", "typographic", "portrait-led", "data-led", "minimal", "collage"],
  contents: ["list", "numbered", "sectioned", "visual"],
  "section-opener": ["full-title", "rule-and-number", "image-band", "quote-led", "colour-field"],
  "editorial-note": ["signed", "portrait", "plain"],
  credits: ["columns", "run-on"],
  colophon: ["plain"],
  sponsor: ["band", "footer-mark"],

  hero: ["full-bleed", "split", "headline-first", "image-first"],
  lead: ["image-left-text-right", "full-width-image-text-below", "large-headline-small-image", "editorial-split"],
  feature: ["two-column", "three-column", "image-opener", "sidebar-right"],
  secondary: ["compact-image-top", "image-side", "text-only"],
  brief: ["one-line", "headline-and-line", "numbered"],
  "brief-group": ["stack", "two-up", "three-up", "rail"],

  quote: ["large", "side", "portrait-and-quote", "rule-framed"],
  "pull-quote": ["inset", "full-measure", "margin"],
  stat: ["oversized", "label-under", "inline"],
  "stat-group": ["row", "grid", "stacked"],
  timeline: ["vertical", "horizontal", "milestones"],
  table: ["plain", "ruled", "zebra"],
  chart: ["bar", "line", "share", "comparison"],
  callout: ["boxed", "ruled", "tinted"],
  sidebar: ["column", "boxed", "footnote"],
  divider: ["rule", "space", "mark"],

  portrait: ["single", "with-caption", "cut-out"],
  contributor: ["portrait-and-role", "row", "credits-line"],
  photo: ["inline", "wide", "full-bleed"],
  "photo-pair": ["diptych", "unequal"],
  "photo-grid": ["two-by-two", "three-up", "mosaic"],
  "photo-spread": ["full-spread", "lead-and-three", "strip"],

  cta: ["button", "rule-and-line", "band"],
  events: ["list", "cards", "calendar"],
  footer: ["plain", "columns"],
};

/** Whether a composition is one this role may actually be drawn in. */
export function isComposition(role: BlockRole, composition: string): boolean {
  return COMPOSITIONS[role].includes(composition);
}

/** The composition used when nothing has chosen yet: always the first, always a real one. */
export function defaultComposition(role: BlockRole): string {
  return COMPOSITIONS[role][0];
}

/**
 * The roles that carry a story, as opposed to the ones that punctuate or frame it.
 *
 * Used wherever "how many stories are on this surface" is the question — a page of four briefs and
 * a page of four pull quotes are not the same page.
 */
export const STORY_ROLES: readonly BlockRole[] = ["hero", "lead", "feature", "secondary", "brief", "brief-group"];

/** The roles whose whole point is a photograph. */
export const PICTURE_ROLES: readonly BlockRole[] = ["photo", "photo-pair", "photo-grid", "photo-spread", "portrait", "cover", "hero"];

export function isStoryRole(role: BlockRole): boolean {
  return STORY_ROLES.includes(role);
}

export function isPictureRole(role: BlockRole): boolean {
  return PICTURE_ROLES.includes(role);
}
