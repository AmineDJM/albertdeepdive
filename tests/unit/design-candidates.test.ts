import { describe, expect, it } from "vitest";
import { candidatesForBlock, candidatesForSurface, coverCandidates, scoreDesign } from "@/lib/design/candidates";
import { composeDesign } from "@/lib/design/compose";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { genomeFromBrand } from "@/lib/design/genome";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { blocksOf, findBlock, withBlock, type EditionDesign } from "@/lib/design/model";
import { fixtureArticle, fixtureEdition, fixtureMedia } from "../helpers/edition-fixture";

/**
 * Never ship the first valid layout.
 *
 * The first valid layout is the one the composer happened to reach first, which is a function of
 * the order the stories arrived in. What is tested here is that there is genuinely more than one
 * option, that each one is a whole design rather than a block in isolation, that a held block has
 * no options at all, and that a tie goes to the design that already exists — churn without a
 * reason is not a design decision.
 */

const direction = resolveDirection(genomeFromBrand(DEFAULT_BRAND_SYSTEM), newIdentity("p1", "The Review"), null);
const document = fixtureEdition(
  [
    fixtureArticle("a1", { wordCount: 1600, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }),
    fixtureArticle("a2", { wordCount: 900, heroMediaId: "m2", media: [{ mediaId: "m2", role: "HERO", sortOrder: 0 }] }),
    fixtureArticle("a3", { wordCount: 600 }),
    fixtureArticle("a4", { wordCount: 140 }),
  ],
  [fixtureMedia("m1"), fixtureMedia("m2")],
  "a1",
);
const signals = readSignals(document);
const ctx = { signals, direction };
const fresh = (): EditionDesign => composeDesign({ editionId: "ed1", document, signals, direction, plan: planEdition("ed1", signals, direction) });

describe("more than one way to do it", () => {
  it("offers real alternatives for a block, each one a whole design", () => {
    const design = fresh();
    const block = blocksOf(design).find((candidate) => candidate.alternatives.length > 0)!;
    const options = candidatesForBlock(design, block.id, ctx, 3);

    expect(options.length).toBeGreaterThan(1);
    expect(options.some((option) => option.current)).toBe(true);
    for (const option of options) {
      expect(option.design.sections.length).toBe(design.sections.length);
      expect(findBlock(option.design, block.id)).not.toBeNull();
      expect(option.why.length).toBeGreaterThan(5);
    }
    // Every option is a different way of drawing that block.
    const drawn = options.map((option) => findBlock(option.design, block.id)!.composition);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("offers a held block nothing but itself", () => {
    const design = fresh();
    const block = blocksOf(design)[1];
    const held = withBlock(design, block.id, (current) => ({ ...current, locked: true }));
    const options = candidatesForBlock(held, block.id, ctx, 3);
    expect(options).toHaveLength(1);
    expect(options[0].current).toBe(true);
  });

  it("gives the cover the approaches its material can actually carry", () => {
    const design = fresh();
    const options = coverCandidates(design, ctx, 4);
    expect(options.length).toBeGreaterThan(1);
    const labels = options.map((option) => option.label);
    // A portrait-led cover needs a portrait; this issue has none, so it is not offered.
    expect(labels.some((label) => label.includes("portrait"))).toBe(false);
  });

  it("changes a whole surface at once rather than one block three times", () => {
    const design = fresh();
    const surface = design.sections.flatMap((section) => section.surfaces).find((candidate) => candidate.blocks.length > 1);
    if (!surface) return;
    const options = candidatesForSurface(design, surface.id, ctx, 3);
    expect(options.some((option) => option.current)).toBe(true);
    for (const option of options.filter((entry) => !entry.current)) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps what exists when nothing scores better", () => {
    const design = fresh();
    const block = blocksOf(design).find((candidate) => candidate.alternatives.length > 0)!;
    const options = candidatesForBlock(design, block.id, ctx, 5);
    const best = options[0];
    const current = options.find((option) => option.current)!;
    // A tie is decided in favour of what is already there.
    if (Math.abs(best.score - current.score) < 0.001) expect(best.current).toBe(true);
  });
});

describe("how good a design is, as far as arithmetic can tell", () => {
  it("scores a composed issue somewhere it can be compared", () => {
    const scored = scoreDesign(fresh(), ctx);
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.score).toBeLessThanOrEqual(1);
    expect(scored.why).toContain("variety");
  });

  it("marks down a design with something broken in it", () => {
    const design = fresh();
    const block = blocksOf(design)[1];
    const broken = withBlock(design, block.id, (current) => ({ ...current, composition: "kaleidoscope" }));
    expect(scoreDesign(broken, ctx).score).toBeLessThan(scoreDesign(design, ctx).score);
  });

  it("marks down an issue drawn one way over and over", () => {
    const design = fresh();
    const story = blocksOf(design).find((block) => block.role === "secondary" || block.role === "feature");
    if (!story) return;
    let monotonous = design;
    for (const block of blocksOf(design).filter((candidate) => candidate.role === story.role)) {
      monotonous = withBlock(monotonous, block.id, (current) => ({ ...current, composition: story.composition }));
    }
    expect(scoreDesign(monotonous, ctx).score).toBeLessThanOrEqual(scoreDesign(design, ctx).score);
  });
});
