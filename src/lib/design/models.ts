import { DESIGN_MOODS, MOOD_GENOMES, type DesignMood, type EditorialGenome } from "./genome";
import { PERSONALITIES, type PersonalityKey } from "@/lib/brand/typography";
import type { ResolvedDirection } from "./identity";

/**
 * Briefly's own models, and the numbers a sample page is set with.
 *
 * A model is not a template. Everything Briefly composes comes from the genome — the dials that say
 * how dense, how formal, how much colour a page may carry — so "choosing a model" is choosing a set
 * of dials and a type pairing, not choosing a file that layout is poured into. Six of them, one per
 * mood, plus whatever the workspace's own brand resolves to, which is composed rather than listed.
 *
 * Why a sample page at all: before an edition has a word in it there is nothing to render, and that
 * is exactly when somebody wants to know what their newsletter will look like. A page of sample
 * copy set in the model's real type, on the model's real grid, in the workspace's real colours is
 * an honest answer to that — the same thing a type foundry does, and for the same reason. It is
 * labelled as a sample wherever it is shown, because a page of invented words that did not say so
 * would be a claim about a newsletter that does not exist yet.
 *
 * This module is pure and holds no words. The sample copy lives in the component, so it goes
 * through the interface dictionary like every other string and reads in the reader's language.
 */

export type ModelKey = DesignMood;
export const MODEL_KEYS: readonly ModelKey[] = DESIGN_MOODS;

/**
 * The order they are shown in: the two most publications actually want first, the two strongest
 * statements last. Not alphabetical, because the first card is the one most people take.
 */
export const MODEL_ORDER: readonly ModelKey[] = ["editorial", "modern", "minimal", "classic", "bold", "playful"] as const;

/**
 * The type pairing each model is set in.
 *
 * A mood says how a page behaves; a personality says what it is set in. They are separate on
 * purpose — the same dials read very differently in a serif and a grotesque — and pairing them here
 * is a design decision rather than a derivation, which is why it is a table somebody can argue with
 * rather than a formula.
 */
export const MODEL_PERSONALITY: Record<ModelKey, PersonalityKey> = {
  editorial: "editorial",
  modern: "modern",
  minimal: "modern",
  classic: "editorial",
  bold: "modern",
  playful: "warm",
};

export function modelGenome(key: ModelKey): EditorialGenome {
  return MOOD_GENOMES[key];
}

export function isModelKey(value: string): value is ModelKey {
  return (MODEL_KEYS as readonly string[]).includes(value);
}

/**
 * The measurements a sample page is drawn with, in the sample's own coordinate space.
 *
 * Every number here is derived from the resolved direction rather than chosen per model, so the
 * cards cannot drift away from what the engine would actually do: widen the measure in the genome
 * and the sample's column count follows. Sizes are relative to the card, so a card rendered at any
 * width stays in proportion — the specimen is a proportion, not a pixel size.
 */
export type Specimen = {
  /** Columns the body sets in. A narrow card never sets three, whatever the grid says. */
  columns: number;
  /** Type sizes as a multiple of the sample's body size. */
  scale: { masthead: number; headline: number; standfirst: number; body: number; label: number };
  leading: { headline: number; body: number };
  /** Tracking in em, as the personality sets it. */
  tracking: { masthead: number; headline: number; label: number };
  /** 0–1 of the page the picture takes. Zero means this model leads with type. */
  imageShare: number;
  /** Whether a rule sits under the masthead. Minimal models suppress it. */
  rule: boolean;
  /** Coloured fields the sample may carry, capped at what the direction allows. */
  colourFields: number;
  /** Whether the masthead reverses out of the brand colour. */
  reversedMasthead: boolean;
  /** Space between blocks, as a multiple of the body size. */
  spacing: number;
  /** Whether the label above the headline is set in caps. */
  upperLabel: boolean;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function specimenFor(direction: ResolvedDirection, personality: PersonalityKey): Specimen {
  const p = PERSONALITIES[personality] ?? PERSONALITIES.editorial;
  const g = direction.genome;
  const ratio = direction.scaleRatio;

  // A card is not a page: three columns of sample text at card width is four words a line, which
  // says nothing true about the model. Two is the most a card can honestly show.
  const columns = g.density > 0.5 && direction.grid.columns >= 8 ? 2 : 1;

  return {
    columns,
    scale: {
      // The masthead steps hardest, because it is the one piece of type a reader identifies the
      // publication by before reading a word of it.
      masthead: round2(ratio ** 2.2 * (1 + g.formality * 0.12)),
      headline: round2(ratio ** 1.7),
      standfirst: round2(ratio ** 0.55),
      body: 1,
      label: round2(1 / ratio ** 0.6),
    },
    leading: { headline: p.display.leading, body: p.text.leading },
    tracking: { masthead: p.display.tracking, headline: p.display.tracking, label: p.label.tracking },
    // An image-led model shows a picture; a sparse one shows the type doing the work instead.
    imageShare: round2(clamp(direction.imagery.emphasis * 0.55, 0, 0.45)),
    rule: direction.ornament > 0.12,
    colourFields: clamp(direction.colour.fieldsPerSurface, 0, 3),
    reversedMasthead: direction.colour.allowReversedSurface && g.colourIntensity > 0.6,
    spacing: round2(clamp(direction.spacing, 0.7, 1.8)),
    upperLabel: p.label.case === "upper",
  };
}
