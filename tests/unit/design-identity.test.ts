import { describe, expect, it } from "vitest";
import {
  DESIGN_MOODS,
  MOOD_GENOMES,
  correctGenome,
  editorialGenomeSchema,
  genomeFromBrand,
  isStated,
  nearestMood,
  type BrandGenome,
} from "@/lib/design/genome";
import { describeDirection, newArtDirection, newIdentity, resolveDirection } from "@/lib/design/identity";
import { DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";

/**
 * Brand → title → issue, and what that resolves to.
 *
 * The thing worth testing is not the shape of the objects. It is that the dials *mean* something:
 * that "airy" and "dense" produce different spacing and a different measure, that restrained colour
 * actually withholds colour, and that no combination anybody can set — including the ones a model
 * will eventually emit — resolves to a line length nobody can read. Intent controls that do not
 * change numbers are decoration, and decoration is what this engine exists to replace.
 */

const playfulBrand: BrandSystem = {
  ...DEFAULT_BRAND_SYSTEM,
  voice: { tone: ["playful", "warm"], avoid: [], person: "first" },
  shape: { roundness: 0.9, borderWidth: 2, unit: 6 },
  imagery: { treatment: "natural", grain: 0.1, scrim: 0.4 },
};

const formalBrand: BrandSystem = {
  ...DEFAULT_BRAND_SYSTEM,
  voice: { tone: ["formal", "precise"], avoid: [], person: "third" },
  shape: { roundness: 0, borderWidth: 0, unit: 12 },
  imagery: { treatment: "mono", grain: 0, scrim: 0.5 },
};

describe("the brand genome", () => {
  it("reads a brand rather than asking for one, and says so", () => {
    const genome = genomeFromBrand(playfulBrand);
    for (const key of Object.keys(genome.editorial)) {
      expect(genome.evidence[key]?.source, key).toBe("inferred");
      // A reading is never shown as a decision.
      expect(genome.evidence[key]!.confidence).toBeLessThan(1);
      expect(isStated(genome, key as keyof typeof genome.editorial)).toBe(false);
    }
  });

  it("hears the difference between a playful brand and a formal one", () => {
    const playful = genomeFromBrand(playfulBrand).editorial;
    const formal = genomeFromBrand(formalBrand).editorial;
    expect(playful.playfulness).toBeGreaterThan(formal.playfulness);
    expect(formal.formality).toBeGreaterThan(playful.formality);
    expect(formal.seriousness).toBeGreaterThan(playful.seriousness);
    // A mono treatment is restraint; natural photography with a warm voice is not.
    expect(formal.colourIntensity).toBeLessThan(playful.colourIntensity);
    // Thick borders and round corners are furniture, which is the opposite of minimal.
    expect(formal.minimalism).toBeGreaterThan(playful.minimalism);
    // A 12px spacing unit breathes; a 6px one packs.
    expect(formal.density).toBeLessThan(playful.density);
  });

  it("lets a person disagree, and records that they did", () => {
    const read = genomeFromBrand(playfulBrand);
    const corrected = correctGenome(read, { density: 0.1, colourIntensity: 0.05 });
    expect(corrected.editorial.density).toBe(0.1);
    expect(isStated(corrected, "density")).toBe(true);
    expect(corrected.evidence.density.confidence).toBe(1);
    // Everything they did not touch is still a reading.
    expect(isStated(corrected, "formality")).toBe(false);
    // And the original is untouched, so "what did we think before they said that" is answerable.
    expect(read.editorial.density).not.toBe(0.1);
  });

  it("names each mood as itself", () => {
    for (const mood of DESIGN_MOODS) {
      expect(nearestMood(MOOD_GENOMES[mood]), mood).toBe(mood);
    }
  });
});

describe("resolving brand, title and issue into numbers", () => {
  const brand: BrandGenome = genomeFromBrand(DEFAULT_BRAND_SYSTEM);

  it("lets the title override the organisation, and the issue override the title", () => {
    const identity = newIdentity("p1", "The Review", { genome: { density: 0.8 } });
    const withTitle = resolveDirection(brand, identity, null);
    expect(withTitle.genome.density).toBe(0.8);

    const direction = newArtDirection("e1", { genome: { density: 0.2 } });
    const withIssue = resolveDirection(brand, identity, direction);
    expect(withIssue.genome.density).toBe(0.2);
    // And what the issue said nothing about still comes from the title.
    expect(withIssue.genome.formality).toBe(withTitle.genome.formality);
  });

  it("treats a mood as a whole genome, which this issue's own dials still overrule", () => {
    const identity = newIdentity("p1", "The Review");
    const direction = newArtDirection("e1", { mood: "minimal", genome: { colourIntensity: 0.9 } });
    const resolved = resolveDirection(brand, identity, direction);
    // Minimal brings its own density…
    expect(resolved.genome.density).toBe(MOOD_GENOMES.minimal.density);
    // …but the dial the editor moved wins over the mood that suggested otherwise.
    expect(resolved.genome.colourIntensity).toBe(0.9);
  });

  it("turns airy and dense into different pages, not different adjectives", () => {
    const airy = resolveDirection(brand, newIdentity("p1", "A", { genome: { density: 0.05 } }), null);
    const dense = resolveDirection(brand, newIdentity("p1", "A", { genome: { density: 0.95 } }), null);
    expect(airy.spacing).toBeGreaterThan(dense.spacing);
    expect(dense.measure.ideal).toBeGreaterThan(airy.measure.ideal);
    expect(dense.imagery.maxPerSurface).toBeGreaterThanOrEqual(airy.imagery.maxPerSurface);
  });

  it("withholds colour when colour is meant to be withheld", () => {
    const restrained = resolveDirection(brand, newIdentity("p1", "A", { genome: { colourIntensity: 0.1 } }), null);
    const rich = resolveDirection(brand, newIdentity("p1", "A", { genome: { colourIntensity: 0.95 } }), null);
    expect(restrained.colour.fieldsPerSurface).toBe(0);
    expect(restrained.colour.allowReversedSurface).toBe(false);
    expect(rich.colour.fieldsPerSurface).toBeGreaterThan(1);
    expect(rich.colour.allowReversedSurface).toBe(true);
  });

  it("lets photography lead, or keeps it out of the way", () => {
    const led = resolveDirection(brand, newIdentity("p1", "A", { genome: { imageUsage: "led" } }), null);
    const sparse = resolveDirection(brand, newIdentity("p1", "A", { genome: { imageUsage: "sparse" } }), null);
    expect(led.imagery.emphasis).toBeGreaterThan(sparse.imagery.emphasis);
    expect(led.imagery.allowFullBleed).toBe(true);
    expect(sparse.imagery.allowFullBleed).toBe(false);
    // With no photography to lead on, the cover is made of words.
    expect(sparse.cover).not.toBe("image-led");
    expect(led.cover).toBe("image-led");
  });

  it("decides how soon a repeated composition becomes a stack of cards", () => {
    const consistent = resolveDirection(brand, newIdentity("p1", "A", { genome: { variation: 0.1 } }), null);
    const dynamic = resolveDirection(brand, newIdentity("p1", "A", { genome: { variation: 0.9 } }), null);
    expect(dynamic.rhythm.repeatLimit).toBeLessThan(consistent.rhythm.repeatLimit);
    expect(dynamic.rhythm.repeatLimit).toBeGreaterThanOrEqual(1);
  });

  it("steps type harder for an expressive voice than a quiet one", () => {
    const quiet = resolveDirection(brand, newIdentity("p1", "A", { genome: { typographicVoice: "quiet" } }), null);
    const loud = resolveDirection(brand, newIdentity("p1", "A", { genome: { typographicVoice: "expressive" } }), null);
    expect(loud.scaleRatio).toBeGreaterThan(quiet.scaleRatio);
    expect(loud.emphasisSpread).toBeGreaterThan(quiet.emphasisSpread);
  });

  it("never resolves to a page nobody can read, whatever the dials say", () => {
    // Every corner of the dial space, including the combinations a model will eventually emit.
    const values = [0, 0.25, 0.5, 0.75, 1];
    for (const density of values) {
      for (const minimalism of values) {
        for (const voice of ["quiet", "confident", "expressive"] as const) {
          for (const playfulness of values) {
            const genome = editorialGenomeSchema.parse({ density, minimalism, typographicVoice: voice, playfulness, seriousness: 1 - playfulness });
            const resolved = resolveDirection(brand, newIdentity("p1", "A", { genome }), null);
            // The measure stays inside what typography tolerates.
            expect(resolved.measure.min).toBeGreaterThanOrEqual(34);
            expect(resolved.measure.max).toBeLessThanOrEqual(96);
            expect(resolved.measure.min).toBeLessThan(resolved.measure.ideal);
            expect(resolved.measure.ideal).toBeLessThan(resolved.measure.max);
            // A type scale that does not step is not a scale; one that doubles is a poster.
            expect(resolved.scaleRatio).toBeGreaterThan(1.1);
            expect(resolved.scaleRatio).toBeLessThan(1.7);
            // Space never collapses.
            expect(resolved.spacing).toBeGreaterThan(0.5);
            expect(resolved.imagery.maxPerSurface).toBeGreaterThanOrEqual(1);
            expect(resolved.rhythm.repeatLimit).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  it("resolves the same inputs to the same numbers, every time", () => {
    const identity = newIdentity("p1", "The Review", { genome: { density: 0.62 } });
    const direction = newArtDirection("e1", { mood: "bold" });
    expect(resolveDirection(brand, identity, direction)).toEqual(resolveDirection(brand, identity, direction));
  });

  it("explains itself in words an editor would use", () => {
    const airy = describeDirection(resolveDirection(brand, newIdentity("p1", "A", { genome: { density: 0.1, colourIntensity: 0.05, imageUsage: "sparse" } }), null));
    expect(airy).toContain("airy");
    expect(airy).toContain("typographic");
    expect(airy).toContain("colour held back");
    expect(airy).not.toMatch(/0\.\d|ratio|solver|constraint/);
  });
});
