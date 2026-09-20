import { describe, expect, it } from "vitest";
import {
  addressOf,
  block,
  blockFor,
  blocksOf,
  element,
  emptyDesign,
  findBlock,
  findElement,
  idsOf,
  mayChange,
  section,
  surface,
  withBlock,
  withElement,
  withSection,
  withoutBlock,
  type EditionDesign,
} from "@/lib/design/model";
import { BLOCK_ROLES, COMPOSITIONS, defaultComposition, isComposition } from "@/lib/design/roles";
import { isRenderable, validateDesign } from "@/lib/design/validate";
import type { EditionDocument } from "@/lib/publication/document";

/**
 * The design model's four promises, each tested as the way it would break.
 *
 * Nothing is copied; everything is addressable; values are roles; updates are immutable. They sound
 * like architecture and they are all behaviour: the first is why a correction reaches the email and
 * the PDF at once, the second is why "make this bigger" can mean anything, the third is why a
 * restyle does not re-lay out an issue, and the fourth is why undo and before/after are real.
 */

function doc(): EditionDocument {
  return {
    schemaVersion: "1",
    meta: {
      editionId: "ed1",
      versionLabel: "v1",
      issueNumber: 1,
      title: "The Review",
      label: "May 2026",
      month: 5,
      year: 2026,
      isSpecialIssue: false,
      issueLabel: "Issue N°1",
      publicationDate: null,
      generatedAt: new Date().toISOString(),
      pageSize: { name: "A4", widthMm: 210, heightMm: 297 },
      masthead: { title: "The Review", tagline: null },
      cover: { storyId: null, articleId: "a1", headline: "A headline", standfirst: null, mediaId: "m1", teasers: [] },
      editorial: null,
      credits: [],
      contactEmail: null,
      website: null,
      campuses: [],
    },
    sections: [{ id: "s1", slug: "news", name: "News", kicker: null, colour: null, sortOrder: 0 }],
    articles: [
      {
        id: "a1",
        storyId: "st1",
        sectionId: "s1",
        storyType: "NEWS",
        kicker: null,
        headline: "The lead",
        standfirst: "What happened",
        byline: null,
        body: [{ id: "b1", type: "paragraph", text: "One paragraph." }],
        pullQuotes: [],
        media: [],
        heroMediaId: "m1",
        tags: [],
        campuses: [],
        wordCount: 2,
        bdd: null,
        sourceIds: [],
        status: "APPROVED",
        eventDateText: null,
        facts: [{ id: "f1", statement: "40%", status: "ACTIVE", confidence: "HIGH", conflictGroup: null }],
      },
    ],
    media: [
      {
        id: "m1",
        kind: "PHOTO",
        caption: null,
        credit: null,
        altText: null,
        width: 2000,
        height: 1333,
        aspectRatio: 1.5,
        rightsStatus: "GREEN",
        src: { print: null, web: null, thumb: null },
      },
    ],
    pages: [],
    toc: [],
    references: [],
    warnings: [],
  };
}

/** A small design over that document: a cover, a lead, and a picture. */
function design(): EditionDesign {
  const cover = block("cover", {
    importance: "COVER",
    articleId: "a1",
    elements: [
      element("headline", { kind: "article", articleId: "a1", part: "headline" }, { style: { type: "display-xl" } }),
      element("image", { kind: "media", mediaId: "m1" }, { constraints: { priority: 0.9, fullBleed: true } }),
    ],
  });
  const lead = block("lead", {
    importance: "LEAD",
    articleId: "a1",
    composition: "editorial-split",
    elements: [
      element("headline", { kind: "article", articleId: "a1", part: "headline" }),
      element("body", { kind: "article", articleId: "a1", part: "body", blockIds: ["b1"] }),
      element("image", { kind: "media", mediaId: "m1" }),
    ],
  });
  const front = section("Front", { surfaces: [surface({ kind: "cover", blocks: [cover], atomic: true })] });
  const news = section("News", { sectionId: "s1", surfaces: [surface({ kind: "flow", blocks: [lead] })] });
  const base = emptyDesign("ed1");
  return withSection(withSection(base, front), news);
}

describe("the edition design model", () => {
  it("refers to content instead of copying it", () => {
    const d = design();
    const texts = JSON.stringify(d);
    // The headline appears in the document, and nowhere in the design.
    expect(doc().articles[0].headline).toBe("The lead");
    expect(texts).not.toContain("The lead");
    expect(texts).not.toContain("One paragraph.");
    // What it does contain is the id of the thing to read.
    expect(texts).toContain("\"articleId\":\"a1\"");
  });

  it("gives everything a distinct id, because everything can be pointed at", () => {
    const ids = idsOf(design());
    expect(ids.length).toBeGreaterThan(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds a block, an element and where they are", () => {
    const d = design();
    const lead = blocksOf(d).find((b) => b.role === "lead")!;
    expect(findBlock(d, lead.id)?.id).toBe(lead.id);
    expect(findBlock(d, "nope")).toBeNull();
    const address = addressOf(d, lead.id)!;
    expect(address.sectionIndex).toBe(1);
    expect(address.surfaceIndex).toBe(0);
    expect(address.blockIndex).toBe(0);
    const headline = lead.elements[0];
    expect(findElement(d, headline.id)?.block.id).toBe(lead.id);
  });

  it("asks for roles, never for values", () => {
    const styles = blocksOf(design()).flatMap((b) => b.elements.map((e) => e.style));
    for (const style of styles) {
      expect(JSON.stringify(style)).not.toMatch(/#[0-9a-f]{3,8}|px|rem/i);
    }
  });

  it("changes a block by making a new design, and bumps the revision", () => {
    const before = design();
    const lead = blocksOf(before).find((b) => b.role === "lead")!;
    const after = withBlock(before, lead.id, (b) => ({ ...b, importance: "MAJOR" }));
    expect(findBlock(after, lead.id)!.importance).toBe("MAJOR");
    // The design that was rendered is still exactly what was rendered.
    expect(findBlock(before, lead.id)!.importance).toBe("LEAD");
    expect(after.revision).toBe(before.revision + 1);
    expect(after).not.toBe(before);
  });

  it("changes one element without touching its neighbours", () => {
    const before = design();
    const lead = blocksOf(before).find((b) => b.role === "lead")!;
    const body = lead.elements[1];
    const after = withElement(before, body.id, (el) => ({ ...el, style: { ...el.style, type: "body-small" } }));
    expect(findElement(after, body.id)!.element.style.type).toBe("body-small");
    expect(findElement(after, lead.elements[0].id)!.element).toEqual(lead.elements[0]);
  });

  it("does nothing, and says nothing changed, for an id that is not there", () => {
    const before = design();
    expect(withBlock(before, "missing", (b) => b)).toBe(before);
    expect(withElement(before, "missing", (e) => e)).toBe(before);
  });

  it("refuses to remove a locked block, wherever the call came from", () => {
    const before = design();
    const lead = blocksOf(before).find((b) => b.role === "lead")!;
    const locked = withBlock(before, lead.id, (b) => ({ ...b, locked: true }));
    expect(withoutBlock(locked, lead.id)).toBe(locked);
    // Unlocked, the same call removes it.
    expect(blocksOf(withoutBlock(before, lead.id)).some((b) => b.id === lead.id)).toBe(false);
  });

  it("locks an aspect without locking the block", () => {
    const b = block("lead", { locked: true, lockedAspects: ["image"] });
    expect(mayChange(b, "image")).toBe(false);
    expect(mayChange(b, "composition")).toBe(true);
    // Locked with nothing named means locked outright.
    expect(mayChange(block("lead", { locked: true }), "composition")).toBe(false);
  });

  it("refuses a composition the role cannot be drawn in, and falls back to a real one", () => {
    expect(block("lead", { composition: "fancy-hero-2" }).composition).toBe(defaultComposition("lead"));
    expect(block("lead", { composition: "editorial-split" }).composition).toBe("editorial-split");
    for (const role of BLOCK_ROLES) {
      expect(COMPOSITIONS[role].length, role).toBeGreaterThan(0);
      expect(isComposition(role, defaultComposition(role))).toBe(true);
    }
  });

  it("gives a medium its override, and the others what they had", () => {
    const b = block("lead", {
      composition: "editorial-split",
      elements: [element("image", { kind: "media", mediaId: "m1" })],
    });
    const image = b.elements[0];
    const withOverride = {
      ...b,
      overrides: { email: { composition: "image-left-text-right" as const, content: { [image.id]: { kind: "media" as const, mediaId: "m2" } } } },
    };
    expect(blockFor(withOverride, "email")!.composition).toBe("image-left-text-right");
    expect((blockFor(withOverride, "email")!.elements[0].content as { mediaId: string }).mediaId).toBe("m2");
    // The web is untouched by email's problem.
    expect(blockFor(withOverride, "web")!.composition).toBe("editorial-split");
    expect((blockFor(withOverride, "web")!.elements[0].content as { mediaId: string }).mediaId).toBe("m1");
  });

  it("omits what a medium should not draw", () => {
    const b = block("lead", { elements: [element("page-number", { kind: "meta", part: "page" }, { omitIn: ["email", "web"] })] });
    expect(blockFor(b, "print")!.elements).toHaveLength(1);
    expect(blockFor(b, "email")!.elements).toHaveLength(0);
    const hidden = { ...b, overrides: { email: { omit: true } } };
    expect(blockFor(hidden, "email")).toBeNull();
  });
});

describe("validating a design against the edition it describes", () => {
  it("passes a design whose every reference resolves", () => {
    const issues = validateDesign(design(), doc());
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(isRenderable(issues)).toBe(true);
  });

  it("catches a picture that is no longer in the edition", () => {
    const d = design();
    const lead = blocksOf(d).find((b) => b.role === "lead")!;
    const image = lead.elements[2];
    const broken = withElement(d, image.id, (el) => ({ ...el, content: { kind: "media", mediaId: "gone" } }));
    const issues = validateDesign(broken, doc());
    expect(issues.some((i) => i.code === "ref.media.missing")).toBe(true);
    expect(isRenderable(issues)).toBe(false);
  });

  it("catches an article block the editor deleted after the design was made", () => {
    const d = design();
    const lead = blocksOf(d).find((b) => b.role === "lead")!;
    const body = lead.elements[1];
    const broken = withElement(d, body.id, (el) => ({ ...el, content: { kind: "article", articleId: "a1", part: "body", blockIds: ["b1", "b9"] } }));
    expect(validateDesign(broken, doc()).some((i) => i.code === "ref.block.missing")).toBe(true);
  });

  it("catches two things sharing an id, which is how the wrong thing gets changed", () => {
    const d = design();
    const lead = blocksOf(d).find((b) => b.role === "lead")!;
    const clash = withBlock(d, lead.id, (b) => ({ ...b, elements: [b.elements[0], { ...b.elements[1], id: b.elements[0].id }] }));
    expect(validateDesign(clash, doc()).some((i) => i.code === "duplicate.id")).toBe(true);
  });

  it("catches constraints that cannot all be true", () => {
    const d = design();
    const lead = blocksOf(d).find((b) => b.role === "lead")!;
    const impossible = withBlock(d, lead.id, (b) => ({ ...b, constraints: { ...b.constraints, minMeasure: 90, maxMeasure: 45 } }));
    expect(validateDesign(impossible, doc()).some((i) => i.code === "measure.inverted")).toBe(true);
  });

  it("notices a second cover, and a print design with none", () => {
    const d = design();
    const withTwo = withSection(d, section("Extra", { surfaces: [surface({ blocks: [block("cover", { articleId: "a1", elements: [element("headline", { kind: "article", articleId: "a1", part: "headline" })] })] })] }));
    expect(validateDesign(withTwo, doc()).some((i) => i.code === "cover.duplicated")).toBe(true);

    const noCover = { ...d, sections: d.sections.slice(1) };
    expect(validateDesign(noCover, doc()).some((i) => i.code === "cover.missing")).toBe(true);
  });

  it("warns about a stat pointing at a fact the article no longer carries", () => {
    const d = design();
    const lead = blocksOf(d).find((b) => b.role === "lead")!;
    const withStat = withBlock(d, lead.id, (b) => ({ ...b, elements: [...b.elements, element("stat-value", { kind: "fact", articleId: "a1", factId: "f9" })] }));
    const issues = validateDesign(withStat, doc());
    expect(issues.some((i) => i.code === "ref.fact.missing")).toBe(true);
    // A missing fact is a warning: the page still draws, it just says less.
    expect(isRenderable(issues)).toBe(true);
  });
});
