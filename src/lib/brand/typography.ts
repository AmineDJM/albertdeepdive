/**
 * Type, as a fixed set of decisions.
 *
 * Briefly ships four typefaces and hosts them itself. That is a constraint and it is on purpose:
 * a renderer that fetches a font at render time is a renderer that produces a different image when
 * the network is slow, and a "pick any font" system produces the specific ugliness of software that
 * has opinions about nothing.
 *
 * Four faces is not four looks. A personality here is a *pairing* — which face carries the headline,
 * at what weight, in what case, with how much tracking, against which face carries the body. Fraunces
 * set tight in heavy weight and Fraunces set airy at 300 are not the same voice, and the difference
 * between an editorial brand and a technical one is mostly in those numbers.
 *
 * The Art Director may choose a personality by name. It may not choose a font, a weight or a
 * tracking value: those are the design system's job, and letting a model invent them is exactly how
 * output starts to look generated.
 */

export const FAMILY_KEYS = ["fraunces", "newsreader", "inter", "plexMono"] as const;
export type FamilyKey = (typeof FAMILY_KEYS)[number];

export type FamilyDefinition = {
  key: FamilyKey;
  /** What a human calls it. */
  name: string;
  /** The CSS stack, with fallbacks that exist on a rendering host. */
  stack: string;
  /** Where the woff2 files live, for renderers that embed rather than link. */
  files: string[];
  weights: [number, number];
  hasItalic: boolean;
  /** Roughly, cap height over em — used to optically align type with rules and edges. */
  capHeight: number;
};

export const FAMILIES: Record<FamilyKey, FamilyDefinition> = {
  fraunces: {
    key: "fraunces",
    name: "Fraunces",
    stack: '"Fraunces", "Georgia", "Times New Roman", serif',
    files: ["fraunces-normal-latin.woff2", "fraunces-normal-latin-ext.woff2", "fraunces-italic-latin.woff2", "fraunces-italic-latin-ext.woff2"],
    weights: [300, 900],
    hasItalic: true,
    capHeight: 0.72,
  },
  newsreader: {
    key: "newsreader",
    name: "Newsreader",
    stack: '"Newsreader", "Georgia", "Times New Roman", serif',
    files: ["newsreader-normal-latin.woff2", "newsreader-normal-latin-ext.woff2", "newsreader-italic-latin.woff2", "newsreader-italic-latin-ext.woff2"],
    weights: [300, 800],
    hasItalic: true,
    capHeight: 0.7,
  },
  inter: {
    key: "inter",
    name: "Inter",
    stack: '"Inter", "Helvetica Neue", Arial, sans-serif',
    files: ["inter-normal-latin.woff2", "inter-normal-latin-ext.woff2"],
    weights: [300, 800],
    hasItalic: false,
    capHeight: 0.73,
  },
  plexMono: {
    key: "plexMono",
    name: "IBM Plex Mono",
    stack: '"IBM Plex Mono", "Menlo", "Consolas", monospace',
    files: ["ibm-plex-mono-normal-latin.woff2", "ibm-plex-mono-normal-latin-ext.woff2"],
    weights: [400, 600],
    hasItalic: false,
    capHeight: 0.7,
  },
};

export type Case = "none" | "upper";

export type RoleStyle = {
  family: FamilyKey;
  weight: number;
  /** Em, so it scales with size. Display type wants negative, small caps want positive. */
  tracking: number;
  /** Multiple of the font size. */
  leading: number;
  case: Case;
};

export type Personality = {
  key: PersonalityKey;
  name: string;
  /** One line a human can choose by. Shown in the brand editor, never sent to a model as style advice. */
  description: string;
  display: RoleStyle;
  text: RoleStyle;
  label: RoleStyle;
  figure: RoleStyle;
  /** How much bigger each step of the scale is. Editorial wants drama; technical wants evenness. */
  scaleRatio: number;
};

export const PERSONALITY_KEYS = ["editorial", "modern", "technical", "warm"] as const;
export type PersonalityKey = (typeof PERSONALITY_KEYS)[number];

export const PERSONALITIES: Record<PersonalityKey, Personality> = {
  editorial: {
    key: "editorial",
    name: "Editorial",
    description: "A magazine voice. Serif headlines with tight, confident spacing over a reading serif.",
    display: { family: "fraunces", weight: 700, tracking: -0.022, leading: 1.02, case: "none" },
    text: { family: "newsreader", weight: 400, tracking: 0, leading: 1.5, case: "none" },
    label: { family: "inter", weight: 600, tracking: 0.08, leading: 1.2, case: "upper" },
    figure: { family: "plexMono", weight: 500, tracking: 0, leading: 1.1, case: "none" },
    scaleRatio: 1.32,
  },
  modern: {
    key: "modern",
    name: "Modern",
    description: "Swiss and quiet. One grotesque doing everything, separated by weight rather than by face.",
    display: { family: "inter", weight: 700, tracking: -0.032, leading: 1.04, case: "none" },
    text: { family: "inter", weight: 400, tracking: -0.006, leading: 1.55, case: "none" },
    label: { family: "inter", weight: 600, tracking: 0.07, leading: 1.2, case: "upper" },
    figure: { family: "inter", weight: 600, tracking: -0.02, leading: 1.1, case: "none" },
    scaleRatio: 1.25,
  },
  technical: {
    key: "technical",
    name: "Technical",
    description: "Monospaced labels and precise figures. Reads like something measured rather than written.",
    display: { family: "plexMono", weight: 600, tracking: -0.01, leading: 1.12, case: "none" },
    text: { family: "inter", weight: 400, tracking: 0, leading: 1.55, case: "none" },
    label: { family: "plexMono", weight: 500, tracking: 0.1, leading: 1.2, case: "upper" },
    figure: { family: "plexMono", weight: 600, tracking: -0.01, leading: 1.05, case: "none" },
    scaleRatio: 1.22,
  },
  warm: {
    key: "warm",
    name: "Warm",
    description: "Soft serif headlines over a humanist sans. Approachable without being informal.",
    display: { family: "fraunces", weight: 500, tracking: -0.012, leading: 1.1, case: "none" },
    text: { family: "inter", weight: 400, tracking: 0, leading: 1.6, case: "none" },
    label: { family: "inter", weight: 500, tracking: 0.06, leading: 1.25, case: "upper" },
    figure: { family: "fraunces", weight: 600, tracking: -0.01, leading: 1.1, case: "none" },
    scaleRatio: 1.28,
  },
};

/**
 * A modular scale, in pixels, anchored on the body size.
 *
 * Steps rather than free numbers: a layout engine choosing 41px because the headline nearly fitted is
 * how a page stops looking set and starts looking fitted. Copyfitting happens by picking a smaller
 * step, not by inventing one between.
 */
export function typeScale(base: number, ratio: number, steps = 7): number[] {
  return Array.from({ length: steps }, (_, i) => Math.round(base * ratio ** (i - 1) * 100) / 100);
}

/** The CSS a rendered surface needs for one role. */
export function roleCss(style: RoleStyle, sizePx: number): Record<string, string> {
  return {
    "font-family": FAMILIES[style.family].stack,
    "font-weight": String(style.weight),
    "font-size": `${sizePx}px`,
    "letter-spacing": `${(style.tracking * sizePx).toFixed(3)}px`,
    "line-height": String(style.leading),
    "text-transform": style.case === "upper" ? "uppercase" : "none",
  };
}
