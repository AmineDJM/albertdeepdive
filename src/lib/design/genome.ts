import { z } from "zod";
import { DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { PERSONALITY_KEYS, type PersonalityKey } from "@/lib/brand/typography";

/**
 * What an organisation looks like, past the logo and the hex codes.
 *
 * `BrandSystem` already holds the things a brand can be asked for — two neutrals, an accent, a type
 * personality, a corner radius. None of that says whether this organisation's publications breathe
 * or crowd, whether colour is a field or an accent, whether a photograph leads or supports. Those
 * are the decisions that make a page look considered, and Briefly has been guessing at them one
 * renderer at a time.
 *
 * So: a genome of editorial dials, every one of them 0–1 or a small closed set, every one of them
 * something a design decision can actually be derived from. They are inferred — from the website,
 * from a brand book, from previous editions, from what the editor keeps changing — and every one
 * can be corrected, because a brand nobody can argue with is a brand nobody trusts.
 *
 * They are not style. A dial is an input to composition: `density` decides the spacing scale and
 * how many blocks a surface will carry, not a margin value.
 */

/** Where a dial's value came from, so a guess is never shown as a decision. */
export const GENOME_SOURCES = ["default", "inferred", "imported", "user", "learned"] as const;
export type GenomeSource = (typeof GENOME_SOURCES)[number];

export const TYPOGRAPHIC_VOICES = ["quiet", "confident", "expressive"] as const;
export type TypographicVoice = (typeof TYPOGRAPHIC_VOICES)[number];

export const IMAGE_USAGE = ["sparse", "balanced", "led"] as const;
export type ImageUsage = (typeof IMAGE_USAGE)[number];

export const ILLUSTRATION_STYLES = ["none", "line", "flat", "editorial"] as const;
export type IllustrationStyle = (typeof ILLUSTRATION_STYLES)[number];

export const ICONOGRAPHY_STYLES = ["none", "line", "solid"] as const;
export type IconographyStyle = (typeof ICONOGRAPHY_STYLES)[number];

const unit = () => z.number().min(0).max(1);

/**
 * The dials themselves, with no defaults attached.
 *
 * Two schemas are built from this and the difference between them is load-bearing. A *patch* — what
 * a title changes about its organisation, what an issue changes about its title — must be able to
 * say nothing about a dial. `editorialGenomeSchema.partial()` cannot express that: zod fills a
 * defaulted field even when the key is absent, so every patch silently became a complete statement
 * and the override chain collapsed into "whoever was parsed last wins".
 */
const GENOME_SHAPE = {
  /** Airy (0) to dense (1). Decides the spacing scale and how much goes on one surface. */
  density: unit(),
  /** Informal (0) to formal (1). Decides case, ornament, how much the design announces itself. */
  formality: unit(),
  /** How much the design is allowed to enjoy itself. High playfulness with high formality is rare. */
  playfulness: unit(),
  /** Editorial seriousness: how much the design defers to the reading rather than to the look. */
  seriousness: unit(),
  /** How much is removed. High minimalism suppresses rules, boxes and ornament before type. */
  minimalism: unit(),
  /** Restrained (0) to rich (1). A budget, not a permission: it caps the colour a surface may carry. */
  colourIntensity: unit(),
  typographicVoice: z.enum(TYPOGRAPHIC_VOICES),
  imageUsage: z.enum(IMAGE_USAGE),
  illustration: z.enum(ILLUSTRATION_STYLES),
  iconography: z.enum(ICONOGRAPHY_STYLES),
  /** Rules, marks, numbers, dingbats. The half of editorial design that is neither type nor picture. */
  ornament: unit(),
  /** Consistent (0) to dynamic (1). How much one surface may differ from the last. */
  variation: unit(),
} as const;

export const GENOME_DEFAULTS = {
  density: 0.4,
  formality: 0.55,
  playfulness: 0.25,
  seriousness: 0.6,
  minimalism: 0.5,
  colourIntensity: 0.35,
  typographicVoice: "confident",
  imageUsage: "balanced",
  illustration: "none",
  iconography: "none",
  ornament: 0.3,
  variation: 0.45,
} as const;

export const editorialGenomeSchema = z.object({
  density: GENOME_SHAPE.density.default(GENOME_DEFAULTS.density),
  formality: GENOME_SHAPE.formality.default(GENOME_DEFAULTS.formality),
  playfulness: GENOME_SHAPE.playfulness.default(GENOME_DEFAULTS.playfulness),
  seriousness: GENOME_SHAPE.seriousness.default(GENOME_DEFAULTS.seriousness),
  minimalism: GENOME_SHAPE.minimalism.default(GENOME_DEFAULTS.minimalism),
  colourIntensity: GENOME_SHAPE.colourIntensity.default(GENOME_DEFAULTS.colourIntensity),
  typographicVoice: GENOME_SHAPE.typographicVoice.default(GENOME_DEFAULTS.typographicVoice),
  imageUsage: GENOME_SHAPE.imageUsage.default(GENOME_DEFAULTS.imageUsage),
  illustration: GENOME_SHAPE.illustration.default(GENOME_DEFAULTS.illustration),
  iconography: GENOME_SHAPE.iconography.default(GENOME_DEFAULTS.iconography),
  ornament: GENOME_SHAPE.ornament.default(GENOME_DEFAULTS.ornament),
  variation: GENOME_SHAPE.variation.default(GENOME_DEFAULTS.variation),
});
export type EditorialGenome = z.infer<typeof editorialGenomeSchema>;

/** What a title or an issue *changes*. Silence about a dial stays silence. */
export const genomePatchSchema = z.object(GENOME_SHAPE).partial();
export type GenomePatch = z.infer<typeof genomePatchSchema>;

export const DEFAULT_GENOME: EditorialGenome = editorialGenomeSchema.parse({});

/** A dial, with where it came from and how sure we are — shown to the person who may correct it. */
export const genomeEvidenceSchema = z.record(
  z.string(),
  z.object({ source: z.enum(GENOME_SOURCES), confidence: z.number().min(0).max(1), note: z.string().max(200).optional() }),
);
export type GenomeEvidence = z.infer<typeof genomeEvidenceSchema>;

export const brandGenomeSchema = z.object({
  editorial: editorialGenomeSchema,
  evidence: genomeEvidenceSchema.default({}),
});
export type BrandGenome = z.infer<typeof brandGenomeSchema>;

/* ── The moods, which are what a person actually chooses ──────────────────────────────────── */

/**
 * Six words, each a set of dials.
 *
 * §29 of the design brief: the controls a person sees must be meaningful, not two hundred CSS
 * settings. A mood is the whole genome in one word; the sliders beside it move individual dials
 * afterwards. Choosing a mood is therefore not "applying a template" — it is stating an intent that
 * the director composes from.
 */
export const DESIGN_MOODS = ["minimal", "editorial", "bold", "classic", "modern", "playful"] as const;
export type DesignMood = (typeof DESIGN_MOODS)[number];

export const MOOD_GENOMES: Record<DesignMood, EditorialGenome> = {
  minimal: editorialGenomeSchema.parse({ density: 0.2, formality: 0.6, playfulness: 0.1, seriousness: 0.7, minimalism: 0.9, colourIntensity: 0.15, typographicVoice: "quiet", imageUsage: "sparse", ornament: 0.08, variation: 0.25 }),
  editorial: editorialGenomeSchema.parse({ density: 0.5, formality: 0.55, playfulness: 0.25, seriousness: 0.8, minimalism: 0.45, colourIntensity: 0.3, typographicVoice: "confident", imageUsage: "balanced", ornament: 0.4, variation: 0.6 }),
  bold: editorialGenomeSchema.parse({ density: 0.45, formality: 0.35, playfulness: 0.5, seriousness: 0.5, minimalism: 0.3, colourIntensity: 0.75, typographicVoice: "expressive", imageUsage: "led", ornament: 0.5, variation: 0.75 }),
  classic: editorialGenomeSchema.parse({ density: 0.6, formality: 0.85, playfulness: 0.08, seriousness: 0.9, minimalism: 0.35, colourIntensity: 0.18, typographicVoice: "quiet", imageUsage: "balanced", ornament: 0.55, variation: 0.3 }),
  modern: editorialGenomeSchema.parse({ density: 0.35, formality: 0.5, playfulness: 0.3, seriousness: 0.6, minimalism: 0.7, colourIntensity: 0.4, typographicVoice: "confident", imageUsage: "led", ornament: 0.15, variation: 0.5 }),
  playful: editorialGenomeSchema.parse({ density: 0.4, formality: 0.2, playfulness: 0.85, seriousness: 0.35, minimalism: 0.3, colourIntensity: 0.8, typographicVoice: "expressive", imageUsage: "led", illustration: "flat", iconography: "solid", ornament: 0.6, variation: 0.8 }),
};

/**
 * The mood a genome is nearest to, for the screen that has to show one word.
 *
 * Nearest by the dials that carry the most meaning rather than by all of them equally: two brands
 * that differ only in iconography are the same mood, and two that differ in density and colour are
 * not.
 */
export function nearestMood(genome: EditorialGenome): DesignMood {
  const weights: Record<keyof EditorialGenome, number> = {
    density: 1,
    formality: 1,
    playfulness: 1.2,
    seriousness: 0.8,
    minimalism: 1.2,
    colourIntensity: 1.2,
    typographicVoice: 0.8,
    imageUsage: 0.6,
    illustration: 0.2,
    iconography: 0.2,
    ornament: 0.6,
    variation: 0.6,
  };
  const value = (g: EditorialGenome, key: keyof EditorialGenome): number => {
    const raw = g[key];
    if (typeof raw === "number") return raw;
    if (key === "typographicVoice") return TYPOGRAPHIC_VOICES.indexOf(raw as TypographicVoice) / 2;
    if (key === "imageUsage") return IMAGE_USAGE.indexOf(raw as ImageUsage) / 2;
    if (key === "illustration") return ILLUSTRATION_STYLES.indexOf(raw as IllustrationStyle) / 3;
    return ICONOGRAPHY_STYLES.indexOf(raw as IconographyStyle) / 2;
  };
  let best: DesignMood = "editorial";
  let bestDistance = Infinity;
  for (const mood of DESIGN_MOODS) {
    const reference = MOOD_GENOMES[mood];
    let distance = 0;
    for (const key of Object.keys(weights) as (keyof EditorialGenome)[]) {
      distance += weights[key] * (value(genome, key) - value(reference, key)) ** 2;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = mood;
    }
  }
  return best;
}

/* ── Inference, which is how a genome exists without anybody filling in a form ─────────────── */

/**
 * What can be read off a brand without asking anybody.
 *
 * Deliberately modest: these are the inferences the existing `BrandSystem` genuinely supports, not
 * a pretence that four fields describe an organisation. Everything here is marked `inferred` with a
 * confidence below one, so the console can show it as a reading rather than a fact, and a person
 * can disagree with it in one click.
 */
export function genomeFromBrand(system: BrandSystem = DEFAULT_BRAND_SYSTEM): BrandGenome {
  const tone = new Set(system.voice.tone);
  const playful = tone.has("playful") ? 0.75 : tone.has("warm") ? 0.4 : 0.2;
  const formal = tone.has("formal") ? 0.9 : tone.has("precise") ? 0.7 : tone.has("plain") ? 0.5 : 0.45;
  const serious = tone.has("precise") || tone.has("formal") ? 0.85 : tone.has("playful") ? 0.35 : 0.65;

  // Round corners and thick borders are a brand telling you how much furniture it wants on screen.
  const minimalism = clamp(0.85 - system.shape.borderWidth * 0.18 - system.shape.roundness * 0.25);
  // A big spacing unit is an airy brand; a small one is a brand that packs.
  const density = clamp(1 - (system.shape.unit - 4) / 12);
  // Mono and duotone treatments are restraint; natural photography with a strong accent is not.
  const colourIntensity = clamp(system.imagery.treatment === "mono" ? 0.12 : system.imagery.treatment === "duotone" ? 0.45 : 0.35 + playful * 0.3);

  const editorial = editorialGenomeSchema.parse({
    density,
    formality: formal,
    playfulness: playful,
    seriousness: serious,
    minimalism,
    colourIntensity,
    typographicVoice: personalityVoice(system.personality),
    imageUsage: system.imagery.treatment === "mono" ? "sparse" : "balanced",
    iconography: minimalism > 0.7 ? "none" : "line",
    ornament: clamp(0.45 - minimalism * 0.3 + (formal - 0.5) * 0.3),
    variation: clamp(0.35 + playful * 0.35),
  });

  const evidence: GenomeEvidence = {};
  for (const key of Object.keys(editorial) as (keyof EditorialGenome)[]) {
    evidence[key] = { source: "inferred", confidence: 0.4, note: "read from the brand" };
  }
  return { editorial, evidence };
}

function personalityVoice(personality: PersonalityKey): TypographicVoice {
  switch (personality) {
    case "editorial":
      return "confident";
    case "modern":
      return "quiet";
    case "technical":
      return "quiet";
    case "warm":
      return "expressive";
    default:
      return "confident";
  }
}

/** A correction from a person, which outranks anything inferred and says so. */
export function correctGenome(genome: BrandGenome, patch: Partial<EditorialGenome>, source: GenomeSource = "user"): BrandGenome {
  const editorial = editorialGenomeSchema.parse({ ...genome.editorial, ...patch });
  const evidence: GenomeEvidence = { ...genome.evidence };
  for (const key of Object.keys(patch) as (keyof EditorialGenome)[]) {
    if (patch[key] === undefined) continue;
    evidence[key] = { source, confidence: source === "user" ? 1 : 0.7 };
  }
  return { editorial, evidence };
}

/** Whether a dial is a reading or a decision, for the screen that shows them. */
export function isStated(genome: BrandGenome, key: keyof EditorialGenome): boolean {
  const source = genome.evidence[key]?.source;
  return source === "user" || source === "imported";
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export { PERSONALITY_KEYS };
export type { PersonalityKey };
