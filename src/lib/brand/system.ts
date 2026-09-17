import { z } from "zod";
import { contrastRatio, darken, ensureContrast, isLight, lighten, mix, readableOn, safeHex } from "./colour";
import { FAMILIES, PERSONALITIES, PERSONALITY_KEYS, typeScale, type PersonalityKey, type RoleStyle } from "./typography";

/**
 * Brand DNA, and the tokens it compiles to.
 *
 * Two shapes, on purpose.
 *
 * `BrandSystem` is what a customer owns and edits: a handful of decisions, most of them discovered
 * from their website and all of them changeable. It is small enough to review on one screen.
 *
 * `BrandTokens` is what a renderer consumes: every surface, every text colour, every type step,
 * already checked. Nothing between the two is a matter of opinion — compiling is pure, so the same
 * brand always produces the same tokens, which is what lets a rendered slide be tested against a
 * golden file and regenerated a year later.
 *
 * The rule that matters: the Art Director chooses from `brandMenu()` — surface names, personality
 * names, treatment names. It never emits a hex, a font, a weight or a pixel value. Those come from
 * here, where they can be guaranteed. A model asked for "a nice dark blue" will eventually give you
 * one that cannot be read; a model asked to pick "ink" or "brand" cannot.
 */

export const SURFACE_KEYS = ["paper", "ink", "brand", "accent", "muted"] as const;
export type SurfaceKey = (typeof SURFACE_KEYS)[number];

export const IMAGERY_TREATMENTS = ["natural", "duotone", "editorial", "mono"] as const;
export type ImageryTreatment = (typeof IMAGERY_TREATMENTS)[number];

export const MOTION_PACES = ["calm", "measured", "energetic"] as const;
export type MotionPace = (typeof MOTION_PACES)[number];

export const TONE_WORDS = ["plain", "warm", "precise", "confident", "playful", "formal"] as const;

export const brandSystemSchema = z.object({
  colours: z.object({
    /** The one colour a reader would name if asked what colour this organisation is. */
    brand: z.string(),
    accent: z.string(),
    ink: z.string(),
    paper: z.string(),
  }),
  personality: z.enum(PERSONALITY_KEYS),
  shape: z.object({
    /** 0 = square, 1 = as round as the system allows. Everything else is derived from it. */
    roundness: z.number().min(0).max(1),
    borderWidth: z.number().min(0).max(4),
    /** The base of the spacing scale, in px at a 1080-wide surface. */
    unit: z.number().min(4).max(16),
  }),
  imagery: z.object({
    treatment: z.enum(IMAGERY_TREATMENTS),
    /** 0–1. Photographic grain, which is the cheapest way to stop a render looking synthetic. */
    grain: z.number().min(0).max(1),
    /** How hard a photo is dimmed when type sits on it. Contrast is enforced regardless. */
    scrim: z.number().min(0).max(1),
  }),
  motion: z.object({ pace: z.enum(MOTION_PACES) }),
  voice: z.object({
    tone: z.array(z.enum(TONE_WORDS)).max(3),
    /** Words this organisation does not use about itself. Enforced on generated copy, not suggested. */
    avoid: z.array(z.string().min(1).max(40)).max(24),
    /** "we" or "the company" — decides whether copy reads as the org speaking or being described. */
    person: z.enum(["first", "third"]),
  }),
  logo: z.object({
    markUrl: z.string().nullable(),
    wordmarkUrl: z.string().nullable(),
    /** Clear space around the mark, as a multiple of its own height. */
    clearSpace: z.number().min(0).max(2),
  }),
});

export type BrandSystem = z.infer<typeof brandSystemSchema>;

export const DEFAULT_BRAND_SYSTEM: BrandSystem = {
  colours: { brand: "#1F3A5F", accent: "#C2603C", ink: "#14161A", paper: "#FCFCFB" },
  personality: "editorial",
  shape: { roundness: 0.25, borderWidth: 1, unit: 8 },
  imagery: { treatment: "editorial", grain: 0.12, scrim: 0.45 },
  motion: { pace: "measured" },
  voice: { tone: ["plain", "confident"], avoid: [], person: "first" },
  logo: { markUrl: null, wordmarkUrl: null, clearSpace: 0.5 },
};

/* ── Compiled tokens ──────────────────────────────────────────────────────────────────────── */

export type SurfaceTokens = {
  key: SurfaceKey;
  /** What the surface is filled with. */
  background: string;
  /** Body text on it. Always ≥ 4.5:1. */
  foreground: string;
  /** Secondary text on it. Always ≥ 4.5:1 — "muted" is a tone, not permission to be unreadable. */
  subdued: string;
  /** A rule or border on it. Visible, but not text. */
  rule: string;
  /** The accent, adjusted until it can be read on this surface. */
  highlight: string;
};

export type BrandTokens = {
  surfaces: Record<SurfaceKey, SurfaceTokens>;
  type: {
    personality: PersonalityKey;
    display: RoleStyle;
    text: RoleStyle;
    label: RoleStyle;
    figure: RoleStyle;
    /** Seven steps, smallest first, for a 1080px-wide surface. */
    scale: number[];
    families: string[];
  };
  shape: { radiusSm: number; radiusMd: number; radiusLg: number; borderWidth: number; unit: number; space: number[] };
  imagery: { treatment: ImageryTreatment; grain: number; scrim: number; duotoneFrom: string; duotoneTo: string };
  motion: { pace: MotionPace; durationMs: number; stagger: number; easing: string };
};

const MIN_TEXT = 4.5;
const MIN_LARGE_TEXT = 3;
const MIN_RULE = 1.35;

function surfaceFor(key: SurfaceKey, background: string, system: BrandSystem): SurfaceTokens {
  const { ink, paper, accent } = system.colours;
  // Body text is whichever of the brand's own two neutrals reads better, then verified. A brand whose
  // "ink" is a mid grey does not get to render mid grey on its mid-grey surface.
  const foreground = ensureContrast(readableOn(background, [ink, paper]), background, MIN_TEXT);
  // Subdued is the same colour walked 38% toward the background — then walked back if that broke it.
  const subdued = ensureContrast(mix(foreground, background, 0.38), background, MIN_TEXT);
  const rule = ensureContrast(mix(foreground, background, 0.82), background, MIN_RULE);
  // A highlight sits behind or beside large type, so it is held to the large-text threshold; below
  // that it stops being the brand's accent and starts being a different colour entirely.
  const highlight = ensureContrast(accent, background, MIN_LARGE_TEXT);
  return { key, background, foreground, subdued, rule, highlight };
}

const PACE: Record<MotionPace, { durationMs: number; stagger: number; easing: string }> = {
  calm: { durationMs: 900, stagger: 140, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
  measured: { durationMs: 650, stagger: 90, easing: "cubic-bezier(0.33, 0, 0.12, 1)" },
  energetic: { durationMs: 420, stagger: 55, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
};

/**
 * Brand DNA → everything a renderer needs, with no decisions left over.
 *
 * Pure and total: any input, including a brand of four identical near-whites, compiles to tokens
 * whose every foreground passes contrast against its own surface. That property is the reason this
 * function exists, and it is the thing the tests fuzz.
 */
export function compileBrandSystem(input: BrandSystem): BrandTokens {
  const colours = {
    brand: safeHex(input.colours.brand, DEFAULT_BRAND_SYSTEM.colours.brand),
    accent: safeHex(input.colours.accent, DEFAULT_BRAND_SYSTEM.colours.accent),
    ink: safeHex(input.colours.ink, DEFAULT_BRAND_SYSTEM.colours.ink),
    paper: safeHex(input.colours.paper, DEFAULT_BRAND_SYSTEM.colours.paper),
  };
  const system: BrandSystem = { ...input, colours };

  // A muted surface is the paper nudged toward the ink, in the direction that is actually visible:
  // tinting a near-black paper toward black produces nothing.
  const muted = isLight(colours.paper) ? darken(colours.paper, 0.05) : lighten(colours.paper, 0.08);

  const personality = PERSONALITIES[input.personality] ?? PERSONALITIES.editorial;
  const { roundness, borderWidth, unit } = input.shape;
  const pace = PACE[input.motion.pace] ?? PACE.measured;

  return {
    surfaces: {
      paper: surfaceFor("paper", colours.paper, system),
      ink: surfaceFor("ink", colours.ink, system),
      brand: surfaceFor("brand", colours.brand, system),
      accent: surfaceFor("accent", colours.accent, system),
      muted: surfaceFor("muted", muted, system),
    },
    type: {
      personality: personality.key,
      display: personality.display,
      text: personality.text,
      label: personality.label,
      figure: personality.figure,
      scale: typeScale(unit * 2, personality.scaleRatio),
      families: [...new Set([personality.display.family, personality.text.family, personality.label.family, personality.figure.family])].map((key) => FAMILIES[key].stack),
    },
    shape: {
      radiusSm: Math.round(roundness * unit * 1.5),
      radiusMd: Math.round(roundness * unit * 3),
      radiusLg: Math.round(roundness * unit * 6),
      borderWidth,
      unit,
      space: [0.5, 1, 1.5, 2, 3, 4, 6, 8].map((n) => Math.round(n * unit)),
    },
    imagery: {
      ...input.imagery,
      // A duotone runs from the darkest thing the brand owns to the lightest, so a photograph lands
      // inside the palette rather than beside it.
      duotoneFrom: isLight(colours.brand) ? colours.ink : colours.brand,
      duotoneTo: isLight(colours.paper) ? colours.paper : lighten(colours.brand, 0.75),
    },
    motion: { pace: input.motion.pace, ...pace },
  };
}

/* ── What the Art Director is allowed to choose ───────────────────────────────────────────── */

export type BrandMenu = {
  surfaces: SurfaceKey[];
  treatments: readonly ImageryTreatment[];
  /** Type steps by name, so a brief can say "display" without naming 64px. */
  emphasis: readonly ["quiet", "normal", "loud"];
  voice: { tone: string[]; person: "first" | "third"; avoid: string[] };
};

/**
 * The menu handed to the model, and the only vocabulary its answer may use.
 *
 * Deliberately small. Every entry here is something the renderer can execute exactly; anything the
 * renderer would have to interpret is absent, because "interpret" is where generic-looking output
 * comes from.
 */
export function brandMenu(system: BrandSystem): BrandMenu {
  return {
    surfaces: [...SURFACE_KEYS],
    treatments: IMAGERY_TREATMENTS,
    emphasis: ["quiet", "normal", "loud"],
    voice: { tone: [...system.voice.tone], person: system.voice.person, avoid: [...system.voice.avoid] },
  };
}

/** Every foreground/background pair a renderer can produce, for tests and for the brand editor. */
export function contrastReport(tokens: BrandTokens): { surface: SurfaceKey; role: string; ratio: number; passes: boolean }[] {
  const rows: { surface: SurfaceKey; role: string; ratio: number; passes: boolean }[] = [];
  for (const surface of Object.values(tokens.surfaces)) {
    for (const [role, minimum] of [
      ["foreground", MIN_TEXT],
      ["subdued", MIN_TEXT],
      ["highlight", MIN_LARGE_TEXT],
      ["rule", MIN_RULE],
    ] as const) {
      const ratio = contrastRatio(surface[role], surface.background);
      rows.push({ surface: surface.key, role, ratio: Math.round(ratio * 100) / 100, passes: ratio >= minimum - 1e-6 });
    }
  }
  return rows;
}
