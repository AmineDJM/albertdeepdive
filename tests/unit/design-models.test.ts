import { describe, expect, it } from "vitest";
import { MODEL_KEYS, MODEL_ORDER, MODEL_PERSONALITY, isModelKey, modelGenome, specimenFor } from "@/lib/design/models";
import { DESIGN_MOODS, brandGenomeSchema, MOOD_GENOMES } from "@/lib/design/genome";
import { resolveDirection } from "@/lib/design/identity";
import { PERSONALITIES } from "@/lib/brand/typography";

const directionFor = (key: (typeof MODEL_KEYS)[number]) =>
  resolveDirection(brandGenomeSchema.parse({ editorial: MOOD_GENOMES[key] }), null, null);

/**
 * The models are what somebody chooses between before their newsletter exists, so the thing worth
 * testing is that they are actually different from each other and that none of them produces a
 * sample page that could not be read.
 */
describe("Briefly's own models", () => {
  it("offers every mood, once, and in a deliberate order", () => {
    expect([...MODEL_ORDER].sort()).toEqual([...DESIGN_MOODS].sort());
    expect(new Set(MODEL_ORDER).size).toBe(MODEL_ORDER.length);
    // Not alphabetical: the first card is the one most people take, so it is chosen, not sorted.
    expect(MODEL_ORDER[0]).toBe("editorial");
  });

  it("sets each model in a type pairing that exists", () => {
    for (const key of MODEL_KEYS) expect(PERSONALITIES[MODEL_PERSONALITY[key]], key).toBeTruthy();
  });

  it("recognises its own keys and refuses anything else", () => {
    expect(isModelKey("editorial")).toBe(true);
    for (const bad of ["", "Editorial", "brand", "../minimal", "__proto__"]) expect(isModelKey(bad), bad).toBe(false);
  });

  it("gives every model a readable sample page", () => {
    for (const key of MODEL_KEYS) {
      const s = specimenFor(directionFor(key), MODEL_PERSONALITY[key]);
      // A card cannot honestly show three columns of sample text.
      expect(s.columns, key).toBeGreaterThanOrEqual(1);
      expect(s.columns, key).toBeLessThanOrEqual(2);
      // Every role stays in order: a standfirst under a headline under a masthead.
      expect(s.scale.masthead, key).toBeGreaterThan(s.scale.headline);
      expect(s.scale.headline, key).toBeGreaterThan(s.scale.standfirst);
      expect(s.scale.standfirst, key).toBeGreaterThan(s.scale.body);
      expect(s.scale.label, key).toBeLessThan(s.scale.body);
      // Nothing may be set so tight it cannot be read, nor so loose it stops being a page.
      expect(s.leading.body, key).toBeGreaterThanOrEqual(1.3);
      expect(s.spacing, key).toBeGreaterThanOrEqual(0.7);
      expect(s.spacing, key).toBeLessThanOrEqual(1.8);
      expect(s.imageShare, key).toBeLessThanOrEqual(0.45);
      expect(s.colourFields, key).toBeLessThanOrEqual(3);
    }
  });

  it("makes the models visibly different rather than six names for one page", () => {
    const specimens = MODEL_KEYS.map((key) => specimenFor(directionFor(key), MODEL_PERSONALITY[key]));
    // If every card came out the same, the gallery would be a lie told six times.
    expect(new Set(specimens.map((s) => JSON.stringify(s))).size).toBe(MODEL_KEYS.length);
  });

  it("keeps each mood's own character in its sample", () => {
    const minimal = specimenFor(directionFor("minimal"), MODEL_PERSONALITY.minimal);
    const bold = specimenFor(directionFor("bold"), MODEL_PERSONALITY.bold);
    const classic = specimenFor(directionFor("classic"), MODEL_PERSONALITY.classic);

    // Minimal removes ornament and colour; bold leads with a picture and carries colour.
    expect(minimal.rule).toBe(false);
    expect(minimal.colourFields).toBeLessThan(bold.colourFields);
    expect(bold.imageShare).toBeGreaterThan(minimal.imageShare);
    // Airy sets more space between blocks than dense does.
    expect(minimal.spacing).toBeGreaterThan(classic.spacing);
  });

  it("hands back the mood's genome unchanged, so the gallery cannot drift from the engine", () => {
    for (const key of MODEL_KEYS) expect(modelGenome(key)).toEqual(MOOD_GENOMES[key]);
  });
});
