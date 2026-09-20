import { z } from "zod";
import { gridSchema, type DesignGrid } from "./model";
import { COMPOSITIONS } from "./roles";
import { DESIGN_MOODS, MOOD_GENOMES, clamp, editorialGenomeSchema, genomePatchSchema, nearestMood, type BrandGenome, type DesignMood, type EditorialGenome } from "./genome";
import { PERSONALITY_KEYS } from "@/lib/brand/typography";

/**
 * What one title looks like, inside the organisation it belongs to.
 *
 * Albert School is a brand. *The Albert Alumni Review* is a publication, and it has a masthead, a
 * type pairing, a grid and a rhythm of its own — which are not a second brand and must not require
 * creating one. An identity is therefore a set of *overrides on the organisation's genome*, plus
 * the few decisions that belong to a title rather than to a company.
 *
 * The property that makes it a publication rather than a template: it is stable across editions and
 * it does not decide any single edition's composition. A magazine is recognisable between issues
 * and composed differently in every one; that is the whole target, and it only works if identity
 * and art direction are separate objects.
 */

export const RECURRING_COMPONENTS = ["editors-note", "upcoming-events", "numbers", "people", "quick-reads", "closing-quote", "contributors", "sponsor"] as const;
export type RecurringComponent = (typeof RECURRING_COMPONENTS)[number];

export const publicationIdentitySchema = z.object({
  id: z.string(),
  publicationId: z.string(),
  /** Bumped whenever the identity changes, so an edition records which one it was composed under. */
  version: z.number().int().min(1).default(1),
  name: z.string().max(160),
  /** What this title changes about its organisation's genome. Everything unstated is inherited. */
  genome: genomePatchSchema.default({}),
  /** The type pairing. A title may read differently from its parent without owning a brand. */
  personality: z.enum(PERSONALITY_KEYS).nullable().default(null),
  masthead: z.object({
    composition: z.string().default("classic"),
    /** Words rather than the logo, when the title is not the organisation. */
    wordmark: z.enum(["logo", "type", "both"]).default("both"),
    rule: z.boolean().default(true),
  }).default({ composition: "classic", wordmark: "both", rule: true }),
  /** The grid this title is composed on, which print and web both read. */
  grid: gridSchema.partial().default({}),
  /** What the cover usually is. A preference the director may depart from, with a reason. */
  coverStyle: z.enum(["image-led", "typographic", "portrait-led", "data-led", "minimal", "collage"]).nullable().default(null),
  /** The pieces this title always has, so readers recognise them between issues. */
  recurring: z.array(z.enum(RECURRING_COMPONENTS)).default([]),
  /** How sections open, when this title opens them at all. */
  sectionOpener: z.enum(["full-title", "rule-and-number", "image-band", "quote-led", "colour-field"]).nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicationIdentity = z.infer<typeof publicationIdentitySchema>;

export function newIdentity(publicationId: string, name: string, patch: Partial<PublicationIdentity> = {}): PublicationIdentity {
  const now = new Date().toISOString();
  return publicationIdentitySchema.parse({ id: `pi_${publicationId}`, publicationId, name, createdAt: now, updatedAt: now, ...patch });
}

/* ── One edition's art direction ──────────────────────────────────────────────────────────── */

/**
 * What *this* issue is, as opposed to what the title is.
 *
 * A summer edition may be lighter and more photographic; an annual report is formal and
 * data-heavy. §28 of the design brief asks for this to be optional and inferred — the editor should
 * not have to name it — which is why `source` matters: a direction the software decided and a
 * direction a person stated are not the same thing, and a redesign is allowed to overrule only one
 * of them.
 */
export const artDirectionSchema = z.object({
  id: z.string(),
  editionId: z.string(),
  identityId: z.string().nullable().default(null),
  mood: z.enum(DESIGN_MOODS).nullable().default(null),
  /** This edition's departures from the title's genome. */
  genome: genomePatchSchema.default({}),
  /**
   * The sentence the whole composition follows from.
   *
   * "People-heavy and photography-rich: lead with portraits and let the pictures break the page."
   * Written by the director, read by everything downstream, and shown to the editor as the reason a
   * cover looks the way it does.
   */
  narrative: z.string().max(400).default(""),
  /** What the director must honour on this issue, in the design's own vocabulary. */
  rules: z.array(z.object({ rule: z.string().max(200), because: z.string().max(200).optional() })).default([]),
  /** The cover approach chosen for this issue, which may depart from the title's habit. */
  cover: z.enum(["image-led", "typographic", "portrait-led", "data-led", "minimal", "collage"]).nullable().default(null),
  source: z.enum(["inferred", "user", "mixed"]).default("inferred"),
  createdAt: z.string(),
});
export type EditionArtDirection = z.infer<typeof artDirectionSchema>;

export function newArtDirection(editionId: string, patch: Partial<EditionArtDirection> = {}): EditionArtDirection {
  return artDirectionSchema.parse({ id: `ad_${editionId}`, editionId, createdAt: new Date().toISOString(), ...patch });
}

/* ── Resolution: dials in, numbers out ────────────────────────────────────────────────────── */

/**
 * Everything a composer needs, resolved from brand → title → issue, in that order of precedence.
 *
 * This is where intent stops being adjectives. "Airy" becomes a spacing multiplier and a cap on how
 * many blocks a surface carries; "restrained colour" becomes a budget of coloured fields per
 * surface; "dynamic" becomes how many surfaces may share a composition before it reads as
 * repetition. If these numbers did not exist, the intent controls would be decoration and the
 * layout would come from whatever the renderer happened to do — which is the situation this engine
 * replaces.
 *
 * Pure and total: the same three inputs always resolve to the same numbers, which is what lets a
 * published edition be reproduced and a golden test mean anything.
 */
export type ResolvedDirection = {
  genome: EditorialGenome;
  mood: DesignMood;
  grid: DesignGrid;
  /** Characters per line. The single most consequential typographic number on a page. */
  measure: { min: number; ideal: number; max: number };
  /** The ratio the type scale is built on. Expressive voices step harder between roles. */
  scaleRatio: number;
  /** Multiplier on the brand's spacing unit. Airy pages are not pages with bigger margins only. */
  spacing: number;
  /** How much stronger a lead is than a standard story, as a multiplier on emphasis. */
  emphasisSpread: number;
  colour: {
    /** Coloured fields allowed per surface. Zero means colour is type and rules only. */
    fieldsPerSurface: number;
    /** Whether a whole surface may be reversed out of a dark or brand field. */
    allowReversedSurface: boolean;
  };
  imagery: {
    /** 0–1: how much of a surface pictures may occupy before the page is a photo essay. */
    emphasis: number;
    maxPerSurface: number;
    allowFullBleed: boolean;
  };
  rhythm: {
    /** How many surfaces in a row may use the same composition before it reads as a stack. */
    repeatLimit: number;
    /** 0–1: how far consecutive surfaces should differ. */
    variation: number;
  };
  /** Rules, numbers and marks: 0 suppresses them entirely. */
  ornament: number;
  /** The cover approach to try first. */
  cover: (typeof COMPOSITIONS)["cover"][number];
};

export function resolveDirection(brand: BrandGenome, identity: PublicationIdentity | null, direction: EditionArtDirection | null): ResolvedDirection {
  // Precedence: the organisation's genome, then the title's departures, then this issue's. A mood
  // named on the issue is a whole genome, so it applies before that issue's individual dials.
  const moodBase = direction?.mood ? MOOD_GENOMES[direction.mood] : null;
  const genome = editorialGenomeSchema.parse({
    ...brand.editorial,
    ...(identity?.genome ?? {}),
    ...(moodBase ?? {}),
    ...(direction?.genome ?? {}),
  });

  const grid = gridSchema.parse({ ...(identity?.grid ?? {}) });
  const expressive = genome.typographicVoice === "expressive" ? 1 : genome.typographicVoice === "confident" ? 0.5 : 0;

  // A dense publication sets a longer measure and a shorter one when it breathes; the range is the
  // one typography actually tolerates, so no dial can produce an unreadable line.
  const ideal = Math.round(58 + genome.density * 18 - genome.minimalism * 4);
  const measure = { min: Math.max(34, ideal - 14), ideal, max: Math.min(96, ideal + 16) };

  const imageEmphasis = genome.imageUsage === "led" ? 0.75 : genome.imageUsage === "sparse" ? 0.25 : 0.5;

  return {
    genome,
    mood: direction?.mood ?? nearestMood(genome),
    grid,
    measure,
    // 1.2 is quiet, 1.5 shouts. Serious publications step less; expressive ones step more.
    scaleRatio: round2(1.18 + expressive * 0.22 + genome.playfulness * 0.1 - genome.seriousness * 0.06),
    spacing: round2(1.35 - genome.density * 0.6 + genome.minimalism * 0.15),
    emphasisSpread: round2(1 + (1 - genome.seriousness) * 0.5 + expressive * 0.35),
    colour: {
      fieldsPerSurface: Math.round(genome.colourIntensity * 3),
      allowReversedSurface: genome.colourIntensity > 0.45,
    },
    imagery: {
      emphasis: unit2(imageEmphasis),
      // A page of nine photographs is a contact sheet. The cap rises with emphasis and density.
      maxPerSurface: Math.max(1, Math.round(1 + imageEmphasis * 3 + genome.density * 2)),
      allowFullBleed: imageEmphasis >= 0.5 && genome.minimalism < 0.85,
    },
    rhythm: {
      repeatLimit: genome.variation > 0.7 ? 1 : genome.variation > 0.4 ? 2 : 3,
      variation: genome.variation,
    },
    ornament: unit2(genome.ornament * (1 - genome.minimalism * 0.5)),
    cover: direction?.cover ?? identity?.coverStyle ?? defaultCover(genome),
  };
}

function defaultCover(genome: EditorialGenome): ResolvedDirection["cover"] {
  if (genome.imageUsage === "sparse") return genome.minimalism > 0.6 ? "minimal" : "typographic";
  if (genome.imageUsage === "led") return "image-led";
  return genome.typographicVoice === "expressive" ? "typographic" : "image-led";
}

/**
 * The sentence a person reads instead of the numbers.
 *
 * §90: the status line says "balancing pages", never "constraint solver". This is the same rule for
 * the art direction — an editor is owed an explanation of why their issue looks as it does, in the
 * words they would use.
 */
export function describeDirection(resolved: ResolvedDirection): string {
  const parts: string[] = [];
  parts.push(resolved.genome.density > 0.6 ? "dense" : resolved.genome.density < 0.3 ? "airy" : "measured");
  parts.push(resolved.imagery.emphasis > 0.6 ? "photography-led" : resolved.imagery.emphasis < 0.35 ? "typographic" : "balanced");
  if (resolved.colour.fieldsPerSurface === 0) parts.push("colour held back to the accent");
  else if (resolved.colour.fieldsPerSurface >= 2) parts.push("colour used as fields");
  if (resolved.genome.formality > 0.75) parts.push("formal");
  if (resolved.genome.playfulness > 0.6) parts.push("playful");
  return parts.join(", ");
}

/** For the ratios and multipliers, which have a floor below which they stop being ratios. */
function round2(value: number): number {
  return Math.round(clamp(value, 0.5, 3) * 100) / 100;
}

/** For the 0–1 fractions, which have no floor — sparse photography really is 0.25. */
function unit2(value: number): number {
  return Math.round(clamp(value) * 100) / 100;
}
