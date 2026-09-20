import { describe, expect, it } from "vitest";
import { composeDesign, compositionSpread, unsupportedCompositions } from "@/lib/design/compose";
import { describeGrid, gridForDirection, measureFor, spanFor, textColumns } from "@/lib/design/grid";
import { blocksOf, surfacesOf } from "@/lib/design/model";
import { validateDesign, isRenderable } from "@/lib/design/validate";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { newIdentity, resolveDirection, type PublicationIdentity } from "@/lib/design/identity";
import { genomeFromBrand } from "@/lib/design/genome";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import type { DocumentArticle, DocumentMedia, EditionDocument } from "@/lib/publication/document";

/**
 * Composing a plan into a design.
 *
 * The failures being guarded here are the ones that make software-made publications recognisable
 * as software-made: the same shape on every surface, a picture-led layout with no picture in it,
 * and a hierarchy that exists in the data but not on the page. Each is cheap to write and obvious
 * in print.
 */

const brand = genomeFromBrand(DEFAULT_BRAND_SYSTEM);

function media(id: string, extra: Partial<DocumentMedia> = {}): DocumentMedia {
  return {
    id,
    kind: "PHOTO",
    caption: null,
    credit: null,
    altText: null,
    width: 2400,
    height: 1600,
    aspectRatio: 1.5,
    rightsStatus: "GREEN",
    src: { print: { key: id, url: "", path: null, width: 2400, height: 1600 }, web: null, thumb: null },
    ...extra,
  };
}

function article(id: string, extra: Partial<DocumentArticle> = {}): DocumentArticle {
  return {
    id,
    storyId: `st-${id}`,
    sectionId: "s1",
    storyType: "NEWS",
    kicker: "News",
    headline: `Headline ${id}`,
    standfirst: "A standfirst.",
    byline: "A. Writer",
    body: [{ id: `${id}-b1`, type: "paragraph", text: "Something happened, and here is what it means." }],
    pullQuotes: [],
    media: [],
    heroMediaId: null,
    tags: [],
    campuses: [],
    wordCount: 400,
    bdd: null,
    sourceIds: [],
    status: "APPROVED",
    eventDateText: null,
    ...extra,
  };
}

function edition(articles: DocumentArticle[], mediaItems: DocumentMedia[] = [], coverArticleId: string | null = null): EditionDocument {
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
      cover: { storyId: null, articleId: coverArticleId, headline: null, standfirst: null, mediaId: null, teasers: [] },
      editorial: null,
      credits: [],
      contactEmail: null,
      website: null,
      campuses: [],
    },
    sections: [{ id: "s1", slug: "news", name: "News", kicker: null, colour: null, sortOrder: 0 }],
    articles,
    media: mediaItems,
    pages: [],
    toc: [],
    references: [],
    warnings: [],
  };
}

function compose(doc: EditionDocument, genome: PublicationIdentity["genome"] = {}) {
  const identity = newIdentity("p1", "The Review", { genome });
  const direction = resolveDirection(brand, identity, null);
  const signals = readSignals(doc);
  const plan = planEdition("ed1", signals, direction);
  return { design: composeDesign({ editionId: "ed1", document: doc, signals, direction, plan }), signals, direction, plan };
}

describe("the grid", () => {
  it("gives a dense publication columns and an airy one air", () => {
    const dense = gridForDirection(resolveDirection(brand, newIdentity("p1", "A", { genome: { density: 0.9 } }), null));
    const airy = gridForDirection(resolveDirection(brand, newIdentity("p1", "A", { genome: { density: 0.05, minimalism: 0.9 } }), null));
    expect(textColumns(dense)).toBeGreaterThan(textColumns(airy));
    expect(airy.margins.left).toBeGreaterThan(dense.margins.left);
    expect(describeGrid(dense)).toMatch(/column/i);
  });

  it("gives importance space before it gives it type size", () => {
    const grid = gridForDirection(resolveDirection(brand, newIdentity("p1", "A"), null));
    const lead = spanFor("lead", "LEAD", grid);
    const secondary = spanFor("secondary", "STANDARD", grid);
    const brief = spanFor("brief", "BRIEF", grid);
    expect(lead.span).toBeGreaterThan(secondary.span);
    expect(secondary.span).toBeGreaterThan(brief.span);
    expect(lead.span).toBeLessThanOrEqual(grid.columns);
  });

  it("never resolves a measure outside what can be read", () => {
    const grid = gridForDirection(resolveDirection(brand, newIdentity("p1", "A"), null));
    const direction = resolveDirection(brand, newIdentity("p1", "A"), null);
    for (const span of [1, 3, 6, 9, 12]) {
      const measure = measureFor({ span, offset: 0 }, grid, direction);
      expect(measure.min).toBeGreaterThanOrEqual(34);
      expect(measure.max).toBeLessThanOrEqual(96);
      expect(measure.min).toBeLessThan(measure.max);
    }
  });
});

describe("composing", () => {
  it("never draws a composition the material cannot support", () => {
    // Nine stories, no photographs anywhere, and a publication that wants photography to lead.
    const doc = edition(Array.from({ length: 9 }, (_, i) => article(`a${i}`, { wordCount: 500 })));
    const identity = newIdentity("p1", "A", { genome: { imageUsage: "led" } });
    const direction = resolveDirection(brand, identity, null);
    const signals = readSignals(doc);
    const plan = planEdition("ed1", signals, direction);
    const design = composeDesign({ editionId: "ed1", document: doc, signals, direction, plan });

    expect(unsupportedCompositions(design, signals)).toEqual([]);
    // And no element points at a picture, because there are none.
    for (const block of blocksOf(design)) {
      expect(block.elements.some((el) => el.content.kind === "media")).toBe(false);
    }
  });

  it("does not use the same shape over and over", () => {
    const doc = edition(
      [
        article("a1", { wordCount: 1400, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }),
        ...Array.from({ length: 8 }, (_, i) => article(`b${i}`, { wordCount: 520, media: [{ mediaId: `n${i}`, role: "INLINE", sortOrder: 0 }] })),
      ],
      [media("m1"), ...Array.from({ length: 8 }, (_, i) => media(`n${i}`))],
      "a1",
    );
    const { design } = compose(doc);
    const spread = compositionSpread(design);
    // More than one shape, and nothing hammered beyond what the publication tolerates.
    expect(spread.used).toBeGreaterThan(3);
    const secondary = blocksOf(design).filter((b) => b.role === "secondary").map((b) => b.composition);
    if (secondary.length >= 3) expect(new Set(secondary).size).toBeGreaterThan(1);
  });

  it("puts the hierarchy on the page, not only in the data", () => {
    const doc = edition(
      [
        article("a1", { wordCount: 1600, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }),
        article("a2", { wordCount: 500 }),
        article("a3", { wordCount: 90 }),
      ],
      [media("m1")],
      "a1",
    );
    const { design } = compose(doc);
    const lead = blocksOf(design).find((b) => b.articleId === "a1" && b.role !== "cover")!;
    const brief = blocksOf(design).find((b) => b.articleId === "a3")!;
    // Space, priority and emphasis all say the same thing.
    expect(lead.constraints.maxWidth!).toBeGreaterThan(brief.constraints.maxWidth!);
    expect(lead.constraints.priority).toBeGreaterThan(brief.constraints.priority);
    expect(lead.style.emphasis!).toBeGreaterThan(brief.style.emphasis!);
    // A lead headline is held to fewer lines than a standard one: past three lines it stops being
    // a headline and becomes a paragraph in a large size.
    const leadHeadline = lead.elements.find((el) => el.role === "headline")!;
    expect(leadHeadline.constraints.maxHeadlineLines).toBeLessThanOrEqual(3);
    expect(leadHeadline.style.type).toMatch(/display/);
  });

  it("says why it chose each shape, and what else it could have been", () => {
    const doc = edition([article("a1", { wordCount: 1200, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }), article("a2", { wordCount: 600 })], [media("m1")], "a1");
    const { design } = compose(doc);
    for (const block of blocksOf(design)) {
      expect(block.rationale, `${block.role} has no reason`).toBeTruthy();
    }
    const lead = blocksOf(design).find((b) => b.role === "lead");
    // Real alternatives, not a list called Template 4.
    expect(lead?.alternatives.length).toBeGreaterThan(0);
    for (const alternative of lead!.alternatives) expect(alternative).not.toMatch(/template|option|variant \d/i);
  });

  it("produces a design that validates against the edition it was composed from", () => {
    const doc = edition(
      [article("a1", { wordCount: 1200, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }), article("a2", { wordCount: 400 }), article("a3", { wordCount: 80 })],
      [media("m1")],
      "a1",
    );
    const { design, signals } = compose(doc);
    const issues = validateDesign(design, doc);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(isRenderable(issues)).toBe(true);
    // Every story it read is somewhere in the design.
    const placed = new Set(blocksOf(design).map((b) => b.articleId).filter(Boolean));
    for (const story of signals.stories) expect(placed.has(story.articleId)).toBe(true);
  });

  it("carries a masthead and a way out, with no story attached to either", () => {
    const doc = edition([article("a1", { wordCount: 800 })], [], "a1");
    const { design } = compose(doc);
    const masthead = blocksOf(design).find((b) => b.role === "masthead")!;
    expect(masthead.articleId).toBeNull();
    expect(masthead.elements.some((el) => el.content.kind === "meta")).toBe(true);
    const footer = blocksOf(design).find((b) => b.role === "footer")!;
    // A page number belongs on a page, and an inbox has none.
    const pageNumber = footer.elements.find((el) => el.role === "page-number")!;
    expect(pageNumber.omitIn).toContain("email");
  });

  it("groups the surfaces into the sections they belong to", () => {
    const doc = edition([article("a1", { wordCount: 900 }), article("a2", { wordCount: 400 })], [], "a1");
    const { design } = compose(doc);
    expect(design.sections.length).toBeGreaterThan(1);
    expect(surfacesOf(design).length).toBe(design.sections.reduce((n, s) => n + s.surfaces.length, 0));
    expect(design.sections.some((s) => s.sectionId === "s1")).toBe(true);
  });

  it("composes the same edition the same way twice", () => {
    const doc = edition([article("a1", { wordCount: 1000, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }), article("a2", { wordCount: 300 })], [media("m1")], "a1");
    const shape = (design: ReturnType<typeof compose>["design"]) => blocksOf(design).map((b) => [b.role, b.composition, b.importance, b.articleId, b.constraints.maxWidth]);
    expect(shape(compose(doc).design)).toEqual(shape(compose(doc).design));
  });
});
