import { describe, expect, it } from "vitest";
import { actionable, blocking, describeFindings, inspectDesign, ranked, type DesignFinding } from "@/lib/design/critic";
import { applyRemedies, describeChanges } from "@/lib/design/revise";
import { block, element, emptyDesign, findBlock, section, surface, type DesignBlock, type EditionDesign } from "@/lib/design/model";
import { composeDesign } from "@/lib/design/compose";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { genomeFromBrand } from "@/lib/design/genome";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { gridForDirection } from "@/lib/design/grid";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { fixtureArticle, fixtureEdition, fixtureMedia } from "../helpers/edition-fixture";

/**
 * The critic that does not need eyes, and the hand that acts on it.
 *
 * The measurable half of §42 exists so that the expensive half — a model looking at a render — is
 * spent on what only looking can catch. So what is tested here is that the cheap findings are the
 * *right* cheap findings: an empty frame, a composition no renderer draws, one shape four times in
 * a row, the same photograph twice. And that acting on them is bounded and honest: one change per
 * block, locks respected, and a plain sentence for every change made.
 */

const genome = genomeFromBrand(DEFAULT_BRAND_SYSTEM);
const direction = resolveDirection(genome, newIdentity("p1", "The Review"), null);
const grid = gridForDirection(direction);

function designOf(blocks: DesignBlock[], kind: "cover" | "opener" | "flow" | "close" = "flow"): EditionDesign {
  const base = emptyDesign("ed1", grid);
  return { ...base, sections: [section("News", { sectionId: "s1", surfaces: [surface({ kind, blocks })] })] };
}

const doc = (articles = [fixtureArticle("a1")], media = [fixtureMedia("m1")]) => fixtureEdition(articles, media, "a1");
const signalsOf = (articles?: Parameters<typeof doc>[0], media?: Parameters<typeof doc>[1]) => readSignals(doc(articles, media));

function inspect(design: EditionDesign, extra: Partial<Parameters<typeof inspectDesign>[0]> = {}) {
  return inspectDesign({ design, signals: signalsOf(), direction, ...extra });
}

const story = (id: string, extra: Partial<DesignBlock> = {}) =>
  block("feature", {
    articleId: id,
    elements: [element("headline", { kind: "article", articleId: id, part: "headline" }), element("body", { kind: "article", articleId: id, part: "body" })],
    ...extra,
  });

describe("what can be found without looking", () => {
  it("finds nothing blocking in an edition the engine composed itself", () => {
    const document = fixtureEdition(
      [fixtureArticle("a1", { wordCount: 1400, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }), fixtureArticle("a2", { wordCount: 600 }), fixtureArticle("a3", { wordCount: 120 })],
      [fixtureMedia("m1")],
      "a1",
    );
    const signals = readSignals(document);
    const design = composeDesign({ editionId: "ed1", document, signals, direction, plan: planEdition("ed1", signals, direction) });
    expect(blocking(inspectDesign({ design, signals, direction })).map((item) => item.issue)).toEqual([]);
  });

  it("refuses a composition no renderer draws, and says what to draw instead", () => {
    const broken = { ...story("a1"), composition: "fancy-hero-2" };
    const findings = inspect(designOf([broken]));
    const found = findings.find((item) => item.id.startsWith("structure:unknown-composition"));
    expect(found?.severity).toBe("BLOCKING");
    expect(found?.remedy).toEqual({ kind: "composition", blockId: broken.id, to: "two-column" });
  });

  it("refuses a composition that needs a photograph the story does not have", () => {
    const imageLed = { ...story("a1"), composition: "image-opener" };
    const findings = inspect(designOf([imageLed]));
    const found = findings.find((item) => item.id.startsWith("structure:composition-without-picture"));
    expect(found?.severity).toBe("BLOCKING");
    expect(found?.remedy.kind).toBe("composition");
    if (found?.remedy.kind === "composition") expect(found.remedy.to).not.toMatch(/image|photo/);
  });

  it("finds the empty frame before a reader does", () => {
    const empty = block("photo", { articleId: "a1", elements: [element("caption", { kind: "text", text: "A caption with nothing above it" })] });
    const found = inspect(designOf([empty])).find((item) => item.id.startsWith("imagery:empty-frame"));
    expect(found?.severity).toBe("BLOCKING");
    expect(found?.remedy).toEqual({ kind: "drop", blockId: empty.id });
  });

  it("hears one shape repeated too often", () => {
    const run = [1, 2, 3, 4, 5].map((n) => ({ ...story(`a${n}`), composition: "two-column" }));
    const found = inspect(designOf(run)).find((item) => item.dimension === "rhythm");
    expect(found?.severity).toBe("SERIOUS");
    expect(found?.issue).toContain("in a row");
    expect(found?.remedy.kind).toBe("composition");
    if (found?.remedy.kind === "composition") expect(found.remedy.to).not.toBe("two-column");
  });

  it("notices the same photograph twice in one issue", () => {
    const picture = (id: string) => block("photo", { articleId: id, elements: [element("image", { kind: "media", mediaId: "m1" })] });
    const [first, second] = [picture("a1"), picture("a2")];
    const found = inspect(designOf([first, second])).find((item) => item.id.startsWith("imagery:repeated"));
    expect(found?.severity).toBe("SERIOUS");
    expect(found?.remedy).toEqual({ kind: "picture", blockId: second.id, mediaId: null });
  });

  it("says when everything is set at the same weight", () => {
    const flat = [story("a1"), story("a2"), story("a3"), story("a4")];
    const signals = readSignals(fixtureEdition([fixtureArticle("a1", { wordCount: 2200 }), fixtureArticle("a2", { wordCount: 200 })], [], "a1"));
    const found = inspectDesign({ design: designOf(flat), signals, direction }).find((item) => item.id === "hierarchy:flat");
    expect(found?.severity).toBe("SERIOUS");
  });

  it("carries what the paper said back into the critique", () => {
    const findings = inspect(designOf([story("a1")]), {
      print: { overflowing: [4], underfilled: [2, 3, 5, 6], pages: 8, relaxations: [{ surfaceId: "sf1", blockId: "bl1", fromPage: 3, reason: "the pull quote would not fit on the page" }] },
    });
    expect(findings.find((item) => item.id === "density:overflow:4")?.severity).toBe("BLOCKING");
    expect(findings.find((item) => item.id === "density:underfilled")?.severity).toBe("SERIOUS");
    const relaxed = findings.find((item) => item.id.startsWith("density:relaxed"));
    expect(relaxed?.severity).toBe("MINOR");
    expect(relaxed?.page).toBe(3);
  });

  it("puts what must be fixed first, and what it can fix before what it cannot", () => {
    const findings: DesignFinding[] = [
      { id: "a", dimension: "rhythm", severity: "MINOR", issue: "", remedy: { kind: "none" }, blockId: null, surfaceId: null, page: null, source: "measured", evidence: {} },
      { id: "b", dimension: "density", severity: "BLOCKING", issue: "", remedy: { kind: "none" }, blockId: null, surfaceId: null, page: null, source: "measured", evidence: {} },
      { id: "c", dimension: "rhythm", severity: "SERIOUS", issue: "", remedy: { kind: "drop", blockId: "x" }, blockId: "x", surfaceId: null, page: null, source: "seen", evidence: {} },
      { id: "d", dimension: "rhythm", severity: "SERIOUS", issue: "", remedy: { kind: "none" }, blockId: null, surfaceId: null, page: null, source: "measured", evidence: {} },
    ];
    expect(ranked(findings).map((item) => item.id)).toEqual(["b", "c", "d", "a"]);
    expect(actionable(findings).map((item) => item.id)).toEqual(["c"]);
    expect(describeFindings(findings)).toContain("4 findings");
    expect(describeFindings([])).toContain("measures clean");
  });
});

describe("acting on what was found", () => {
  it("makes the change, and says what it did in a sentence", () => {
    const run = [1, 2, 3, 4, 5].map((n) => ({ ...story(`a${n}`), composition: "two-column" }));
    const design = designOf(run);
    const findings = inspect(design).filter((item) => item.dimension === "rhythm");
    const revised = applyRemedies(design, findings);

    expect(revised.applied).toHaveLength(1);
    expect(revised.design).not.toBe(design);
    const changed = findBlock(revised.design, revised.applied[0].blockId!)!;
    expect(changed.composition).not.toBe("two-column");
    // The way it looked before is offered as an alternative rather than forgotten.
    expect(changed.alternatives).toContain("two-column");
    expect(describeChanges(revised.applied)).toContain("redrawn as");
  });

  it("will not touch a block that is locked", () => {
    const locked = { ...story("a1"), composition: "fancy-hero-2", locked: true };
    const design = designOf([locked]);
    const revised = applyRemedies(design, inspect(design));
    expect(revised.applied).toEqual([]);
    expect(revised.skipped.some((item) => item.why.includes("locked"))).toBe(true);
    expect(findBlock(revised.design, locked.id)!.composition).toBe("fancy-hero-2");
  });

  it("respects a lock on one aspect while leaving the others alone", () => {
    const held = { ...story("a1"), composition: "image-opener", lockedAspects: ["composition" as const] };
    const design = designOf([held]);
    const revised = applyRemedies(design, inspect(design));
    expect(revised.applied).toEqual([]);
    expect(findBlock(revised.design, held.id)!.composition).toBe("image-opener");
  });

  it("changes one thing per block in a round, whatever else is said about it", () => {
    const target = { ...story("a1"), composition: "fancy-hero-2" };
    const design = designOf([target]);
    const twice: DesignFinding[] = [
      { id: "one", dimension: "structure", severity: "BLOCKING", issue: "", remedy: { kind: "composition", blockId: target.id, to: "three-column" }, blockId: target.id, surfaceId: null, page: null, source: "measured", evidence: {} },
      { id: "two", dimension: "rhythm", severity: "SERIOUS", issue: "", remedy: { kind: "importance", blockId: target.id, to: "BRIEF" }, blockId: target.id, surfaceId: null, page: null, source: "seen", evidence: {} },
    ];
    const revised = applyRemedies(design, twice);
    expect(revised.applied).toHaveLength(1);
    expect(revised.skipped[0].why).toContain("already changed this block");
    expect(findBlock(revised.design, target.id)!.importance).not.toBe("BRIEF");
  });

  it("stops at the round's limit rather than rewriting the issue", () => {
    const blocks = [1, 2, 3, 4].map((n) => ({ ...story(`a${n}`), composition: "fancy-hero-2" }));
    const design = designOf(blocks);
    const revised = applyRemedies(design, inspect(design), { limit: 2 });
    expect(revised.applied).toHaveLength(2);
    expect(revised.skipped.some((item) => item.why.includes("next round"))).toBe(true);
  });

  it("takes out a photo block whose photograph has already run", () => {
    const picture = (id: string) => block("photo", { articleId: id, elements: [element("image", { kind: "media", mediaId: "m1" }), element("caption", { kind: "text", text: "A caption" })] });
    const [first, second] = [picture("a1"), picture("a2")];
    const design = designOf([first, second]);
    const revised = applyRemedies(design, inspect(design).filter((item) => item.id.startsWith("imagery:repeated")));

    expect(findBlock(revised.design, second.id)).toBeNull();
    expect(findBlock(revised.design, first.id)).not.toBeNull();
    expect(revised.applied[0].what).toContain("already used in this issue");
  });

  it("skips a change that would change nothing", () => {
    const target = story("a1");
    const design = designOf([target]);
    const same: DesignFinding[] = [
      { id: "same", dimension: "structure", severity: "SERIOUS", issue: "", remedy: { kind: "composition", blockId: target.id, to: target.composition }, blockId: target.id, surfaceId: null, page: null, source: "measured", evidence: {} },
    ];
    const revised = applyRemedies(design, same);
    expect(revised.applied).toEqual([]);
    expect(revised.design).toBe(design);
  });
});
