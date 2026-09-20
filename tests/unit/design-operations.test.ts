import { describe, expect, it } from "vitest";
import { asksFirst, designOperationSchema, isWholeIssue, subjectsOf, summarise, type DesignOperation } from "@/lib/design/operations";
import { applyOperations } from "@/lib/design/apply";
import { diffDesigns, describeDiff, touched } from "@/lib/design/diff";
import { composeDesign, recomposeBlock } from "@/lib/design/compose";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { genomeFromBrand } from "@/lib/design/genome";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { blocksOf, findBlock, withBlock, type EditionDesign } from "@/lib/design/model";
import { COMPOSITIONS, isComposition, type BlockRole } from "@/lib/design/roles";
import { fixtureArticle, fixtureEdition, fixtureMedia } from "../helpers/edition-fixture";

/**
 * Talking to a design.
 *
 * The vocabulary is closed on purpose: an edition is full of words strangers sent in, and those
 * words reach the model. What is tested here is that the closed set stays closed — an operation
 * that names something that does not exist, a composition no renderer draws, or a block somebody
 * has held, is refused in words rather than obeyed — and that a change is *local*: asking about one
 * block must leave every other block byte-identical, or "selective recomputation" is a slogan.
 */

const direction = resolveDirection(genomeFromBrand(DEFAULT_BRAND_SYSTEM), newIdentity("p1", "The Review"), null);

const document = fixtureEdition(
  [
    fixtureArticle("a1", { wordCount: 1600, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }),
    fixtureArticle("a2", { wordCount: 800 }),
    fixtureArticle("a3", { wordCount: 700 }),
    fixtureArticle("a4", { wordCount: 120 }),
  ],
  [fixtureMedia("m1"), fixtureMedia("m2")],
  "a1",
);
const signals = readSignals(document);
const ctx = { signals, direction };

function fresh(): EditionDesign {
  return composeDesign({ editionId: "ed1", document, signals, direction, plan: planEdition("ed1", signals, direction) });
}

const storyBlock = (design: EditionDesign) => blocksOf(design).find((block) => block.articleId && block.elements.some((element) => element.role === "headline"))!;
const pictureBlock = (design: EditionDesign) => blocksOf(design).find((block) => block.elements.some((element) => element.content.kind === "media"))!;

describe("the vocabulary", () => {
  it("refuses anything that is not one of the things a person may ask for", () => {
    expect(designOperationSchema.safeParse({ kind: "delete_everything" }).success).toBe(false);
    expect(designOperationSchema.safeParse({ kind: "set_dial", dial: "vibes", value: 0.5 }).success).toBe(false);
    expect(designOperationSchema.safeParse({ kind: "set_dial", dial: "density", value: 1.4 }).success).toBe(false);
    expect(designOperationSchema.safeParse({ kind: "set_dial", dial: "density", value: 0.8 }).success).toBe(true);
  });

  it("asks first only where undoing is not the same as never having done it", () => {
    expect(asksFirst({ kind: "set_importance", blockId: "b", importance: "LEAD" })).toBe(false);
    expect(asksFirst({ kind: "redesign", scope: "block", targetId: "b", steer: null })).toBe(false);
    expect(asksFirst({ kind: "redesign", scope: "edition", targetId: null, steer: null })).toBe(true);
    expect(asksFirst({ kind: "restore_revision", revision: 2 })).toBe(true);
  });

  it("knows what each thing is about, which is what keeps a change local", () => {
    expect(subjectsOf({ kind: "set_crop", blockId: "b1", shape: "square" })).toEqual(["b1"]);
    expect(subjectsOf({ kind: "set_dial", dial: "density", value: 0.3 })).toEqual([]);
    expect(isWholeIssue({ kind: "set_mood", mood: "editorial" })).toBe(true);
    expect(isWholeIssue({ kind: "set_crop", blockId: "b1", shape: "square" })).toBe(false);
  });

  it("says what it is going to do in words, with the block's name rather than its id", () => {
    const operation: DesignOperation = { kind: "set_composition", blockId: "bl_1", composition: "image-left-text-right" };
    expect(summarise(operation, () => "the lead")).toBe("the lead drawn as image left text right");
  });
});

describe("carrying it out", () => {
  it("draws a block a different way, and rebuilds it for the way it is now drawn", () => {
    const design = fresh();
    const block = storyBlock(design);
    const wanted = COMPOSITIONS[block.role as BlockRole].find((candidate) => candidate !== block.composition)!;
    expect(wanted, `${block.role} has only one way to be drawn`).toBeDefined();
    const { design: after, outcomes } = applyOperations(design, [{ kind: "set_composition", blockId: block.id, composition: wanted }], ctx);

    expect(outcomes[0].done).toBe(true);
    const now = findBlock(after, block.id)!;
    expect(now.composition).toBe(wanted);
    // The way it was is offered back rather than forgotten.
    expect(now.alternatives).toContain(block.composition);
  });

  it("refuses a composition the role cannot be drawn in, and says so", () => {
    const design = fresh();
    const block = storyBlock(design);
    const { design: after, outcomes } = applyOperations(design, [{ kind: "set_composition", blockId: block.id, composition: "kaleidoscope" }], ctx);
    expect(outcomes[0].done).toBe(false);
    expect(outcomes[0].what).toContain("cannot be drawn");
    expect(after).toBe(design);
  });

  it("refuses to touch a block that is held, and names the reason", () => {
    const design = fresh();
    const block = storyBlock(design);
    const held = withBlock(design, block.id, (current) => ({ ...current, locked: true }));
    const { outcomes } = applyOperations(held, [{ kind: "set_importance", blockId: block.id, importance: "BRIEF" }], ctx);
    expect(outcomes[0].done).toBe(false);
    expect(outcomes[0].what).toContain("held");
  });

  it("holds and releases one aspect at a time", () => {
    const design = fresh();
    const block = pictureBlock(design);
    const { design: locked } = applyOperations(design, [{ kind: "lock", blockId: block.id, aspects: ["image"] }], ctx);
    expect(findBlock(locked, block.id)!.lockedAspects).toEqual(["image"]);

    // The photograph is held; the way the block is drawn is not.
    const { outcomes } = applyOperations(locked, [
      { kind: "set_crop", blockId: block.id, shape: "square" },
      { kind: "set_importance", blockId: block.id, importance: "MAJOR" },
    ], ctx);
    expect(outcomes[0].done).toBe(false);
    expect(outcomes[1].done).toBe(true);

    const { design: released, outcomes: freed } = applyOperations(locked, [{ kind: "unlock", blockId: block.id }], ctx);
    expect(freed[0].done).toBe(true);
    expect(findBlock(released, block.id)!.lockedAspects).toEqual([]);
  });

  it("changes only what it was asked about", () => {
    const design = fresh();
    const block = storyBlock(design);
    const { design: after } = applyOperations(design, [{ kind: "set_importance", blockId: block.id, importance: "BRIEF" }], ctx);
    expect(touched(design, after)).toEqual([block.id]);
  });

  it("moves a block within its surface, and refuses to move it off the end", () => {
    const design = fresh();
    const surface = design.sections.flatMap((section) => section.surfaces).find((candidate) => candidate.blocks.length > 1)!;
    const [first, second] = surface.blocks;
    const { design: after, outcomes } = applyOperations(design, [{ kind: "move_block", blockId: second.id, direction: "up" }], ctx);
    expect(outcomes[0].done).toBe(true);
    const moved = after.sections.flatMap((section) => section.surfaces).find((candidate) => candidate.id === surface.id)!;
    expect(moved.blocks.map((entry) => entry.id).slice(0, 2)).toEqual([second.id, first.id]);

    const { outcomes: refused } = applyOperations(design, [{ kind: "move_block", blockId: first.id, direction: "up" }], ctx);
    expect(refused[0].done).toBe(false);
    expect(refused[0].what).toContain("already first");
  });

  it("designs one surface again without touching the rest of the issue", () => {
    const design = fresh();
    const surface = design.sections.flatMap((section) => section.surfaces).find((candidate) => candidate.blocks.some((block) => block.alternatives.length))!;
    const { design: after, outcomes } = applyOperations(design, [{ kind: "redesign", scope: "surface", targetId: surface.id, steer: null }], ctx);

    if (outcomes[0].done) {
      const ids = new Set(surface.blocks.map((block) => block.id));
      for (const id of touched(design, after)) expect(ids.has(id), `${id} changed and is not on that surface`).toBe(true);
    } else {
      expect(outcomes[0].what).toMatch(/held|no other way/);
    }
  });

  it("takes the style of one block to another where it can be drawn", () => {
    const design = fresh();
    const blocks = blocksOf(design).filter((block) => block.role === "secondary" || block.role === "feature");
    if (blocks.length < 2) return;
    const [from, to] = blocks;
    const { design: after, outcomes } = applyOperations(design, [{ kind: "copy_style", fromBlockId: from.id, toBlockId: to.id }], ctx);
    expect(outcomes[0].done).toBe(true);
    expect(findBlock(after, to.id)!.style).toEqual(from.style);
  });

  it("will not pretend to do what belongs somewhere else", () => {
    const design = fresh();
    const { outcomes } = applyOperations(design, [
      { kind: "restore_revision", revision: 1 },
      { kind: "set_dial", dial: "density", value: 0.8 },
      { kind: "redesign", scope: "edition", targetId: null, steer: null },
    ], ctx);
    expect(outcomes.every((outcome) => !outcome.done)).toBe(true);
    expect(outcomes[0].what).toContain("history");
    expect(outcomes[1].what).toContain("direction");
  });
});

describe("what changed", () => {
  it("reads a revision back in the words an editor would use", () => {
    const design = fresh();
    const block = storyBlock(design);
    const { design: after } = applyOperations(design, [{ kind: "set_importance", blockId: block.id, importance: "BRIEF" }], ctx);
    const changes = diffDesigns(design, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("importance");
    expect(changes[0].what).toContain("brief");
    expect(describeDiff(changes)).toMatch(/^The|^A /);
  });

  it("says plainly when nothing changed", () => {
    const design = fresh();
    expect(diffDesigns(design, design)).toEqual([]);
    expect(describeDiff([])).toBe("Nothing changed.");
  });

  it("notices a block that went, and one that arrived", () => {
    const design = fresh();
    const block = storyBlock(design);
    const { design: after } = applyOperations(design, [{ kind: "remove_block", blockId: block.id }], ctx);
    const changes = diffDesigns(design, after);
    expect(changes.some((change) => change.kind === "removed" && change.blockId === block.id)).toBe(true);
  });
});

describe("composing one block again", () => {
  it("gives it a different legitimate way to be drawn, and keeps what identifies it", () => {
    const design = fresh();
    const block = blocksOf(design).find((candidate) => candidate.alternatives.length > 0)!;
    const again = recomposeBlock(block, { signals, direction, sectionId: "s1" });
    expect(again.id).toBe(block.id);
    expect(again.articleId).toBe(block.articleId);
    expect(again.importance).toBe(block.importance);
    expect(again.composition).not.toBe(block.composition);
    expect(isComposition(again.role as BlockRole, again.composition)).toBe(true);
  });

  it("leaves a held block exactly as it is", () => {
    const design = fresh();
    const block = { ...blocksOf(design)[0], locked: true };
    expect(recomposeBlock(block, { signals, direction, sectionId: "s1" })).toBe(block);
  });
});
