import { describe, expect, it } from "vitest";
import { assignImportance, describeEdition, readSignals } from "@/lib/design/signals";
import { planEdition } from "@/lib/design/plan";
import { resolveDirection, newIdentity } from "@/lib/design/identity";
import { genomeFromBrand } from "@/lib/design/genome";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import type { ArticleBlock, DocumentArticle, DocumentMedia, EditionDocument } from "@/lib/publication/document";

/**
 * Reading an edition, ranking it, and planning it — before anything is drawn.
 *
 * The tests are the failures the brief names. An edition with one obvious lead must get a lead; an
 * edition of twenty equal briefs must not invent one. A photographic cover must not be chosen when
 * there is no photograph. Six short items must be gathered onto one surface rather than strung out
 * over six. And a long run of identical surfaces must be broken — but only with material the
 * edition actually has, because a reset invented out of nothing is decoration.
 */

const brand = genomeFromBrand(DEFAULT_BRAND_SYSTEM);
const identity = newIdentity("p1", "The Review");
const direction = resolveDirection(brand, identity, null);

function media(id: string, extra: Partial<DocumentMedia> = {}): DocumentMedia {
  return {
    id,
    kind: "PHOTO",
    caption: null,
    credit: null,
    altText: null,
    width: 2000,
    height: 1333,
    aspectRatio: 1.5,
    rightsStatus: "GREEN",
    src: { print: { key: id, url: "", path: null, width: 2000, height: 1333 }, web: null, thumb: null },
    ...extra,
  };
}

function article(id: string, extra: Partial<DocumentArticle> = {}): DocumentArticle {
  const body: ArticleBlock[] = extra.body ?? [{ id: `${id}-b1`, type: "paragraph", text: "Something happened." }];
  return {
    id,
    storyId: `st-${id}`,
    sectionId: "s1",
    storyType: "NEWS",
    kicker: null,
    headline: `Headline ${id}`,
    standfirst: null,
    byline: null,
    body,
    pullQuotes: [],
    media: [],
    heroMediaId: null,
    tags: [],
    campuses: [],
    wordCount: 300,
    bdd: null,
    sourceIds: [],
    status: "APPROVED",
    eventDateText: null,
    ...extra,
  };
}

function edition(articles: DocumentArticle[], mediaItems: DocumentMedia[] = [], coverArticleId: string | null = null, sections = [{ id: "s1", slug: "news", name: "News", kicker: null, colour: null, sortOrder: 0 }]): EditionDocument {
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
    sections,
    articles,
    media: mediaItems,
    pages: [],
    toc: [],
    references: [],
    warnings: [],
  };
}

describe("reading what an edition is", () => {
  it("finds the lead when there is one", () => {
    const doc = edition(
      [
        article("a1", { wordCount: 1200, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }], pullQuotes: [{ text: "A line", attribution: null }] }),
        article("a2", { wordCount: 300 }),
        article("a3", { wordCount: 220 }),
      ],
      [media("m1")],
      "a1",
    );
    const signals = readSignals(doc);
    expect(signals.hasLead).toBe(true);
    expect(signals.dominant?.articleId).toBe("a1");
    expect(signals.dominant?.because).toContain("cover");
    const importance = assignImportance(signals);
    expect(importance.get("a1")).toBe("COVER");
  });

  it("refuses to invent a lead among twenty equal briefs", () => {
    const doc = edition(Array.from({ length: 20 }, (_, i) => article(`a${i}`, { wordCount: 120 })));
    const signals = readSignals(doc);
    expect(signals.hasLead).toBe(false);
    expect(signals.dominant).toBeNull();
    const importance = assignImportance(signals);
    // Nothing is promoted: every piece is what it is.
    expect([...importance.values()].every((i) => i === "BRIEF" || i === "STANDARD")).toBe(true);
    expect([...importance.values()]).not.toContain("LEAD");
    expect(describeEdition(signals)).toContain("Nothing in it stands out");
  });

  it("counts only pictures that could actually be printed", () => {
    const doc = edition(
      [article("a1", { media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }, { mediaId: "m2", role: "INLINE", sortOrder: 1 }, { mediaId: "m3", role: "INLINE", sortOrder: 2 }] })],
      [media("m1"), media("m2", { rightsStatus: "RED" }), media("m3", { width: 400, src: { print: { key: "m3", url: "", path: null, width: 400, height: 300 }, web: null, thumb: null } })],
    );
    const signals = readSignals(doc);
    expect(signals.counts.pictures).toBe(3);
    // One is blocked on rights and one is too small to print. Neither is a picture this edition has.
    expect(signals.counts.usablePictures).toBe(1);
    expect(signals.stories[0].usablePictures).toBe(1);
    expect(signals.stories[0].bestPictureId).toBe("m1");
  });

  it("hears an edition made of numbers", () => {
    const doc = edition([
      article("a1", { facts: [{ id: "f1", statement: "40%", status: "ACTIVE", confidence: "HIGH", conflictGroup: null }, { id: "f2", statement: "2.1m", status: "ACTIVE", confidence: "HIGH", conflictGroup: null }], body: [{ id: "x", type: "paragraph", text: "Revenue rose 40% to €2.1 million." }] }),
      article("a2", { facts: [{ id: "f3", statement: "12", status: "ACTIVE", confidence: "HIGH", conflictGroup: null }] }),
    ]);
    const signals = readSignals(doc);
    expect(signals.counts.figures).toBeGreaterThanOrEqual(3);
    expect(signals.dataDensity).toBeGreaterThan(0.3);
    expect(describeEdition(signals)).toMatch(/figures|edition/);
  });

  it("says plainly when there is no photography", () => {
    const doc = edition([article("a1"), article("a2")]);
    expect(describeEdition(readSignals(doc))).toContain("almost no usable photography");
  });
});

describe("planning an edition before composing it", () => {
  it("opens with a cover and gives the lead a surface of its own", () => {
    const doc = edition(
      [article("a1", { wordCount: 1400, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }], pullQuotes: [{ text: "A line worth setting", attribution: null }] }), article("a2", { wordCount: 400 }), article("a3", { wordCount: 380 })],
      [media("m1")],
      "a1",
    );
    const plan = planEdition("ed1", readSignals(doc), direction);
    expect(plan.surfaces[0].kind).toBe("cover");
    expect(plan.surfaces[0].blocks.map((b) => b.role)).toContain("cover");
    expect(plan.surfaces[1].kind).toBe("opener");
    expect(plan.surfaces[1].blocks[0].role).toBe("lead");
    expect(plan.surfaces[1].blocks[0].articleId).toBe("a1");
    // The lead's quote is punctuation on its own surface, not a decoration everywhere.
    expect(plan.surfaces[1].blocks.some((b) => b.role === "pull-quote")).toBe(true);
    // And it ends somewhere deliberate.
    expect(plan.surfaces[plan.surfaces.length - 1].kind).toBe("close");
  });

  it("does not put a photograph on the cover of an edition that has none", () => {
    const doc = edition([article("a1", { wordCount: 900 }), article("a2", { wordCount: 200 })], [], "a1");
    const led = resolveDirection(brand, newIdentity("p1", "A", { genome: { imageUsage: "led" }, coverStyle: "image-led" }), null);
    const plan = planEdition("ed1", readSignals(doc), led);
    expect(plan.decisions.some((d) => d.decision.includes("typographic"))).toBe(true);
    expect(plan.surfaces[0].intent).toContain("typographic");
  });

  it("gathers the short pieces instead of stringing them out", () => {
    const doc = edition([
      article("a1", { wordCount: 1200 }),
      ...Array.from({ length: 6 }, (_, i) => article(`b${i}`, { wordCount: 80 })),
    ]);
    const plan = planEdition("ed1", readSignals(doc), direction);
    const briefSurfaces = plan.surfaces.filter((s) => s.blocks.some((b) => b.role === "brief"));
    expect(briefSurfaces).toHaveLength(1);
    expect(briefSurfaces[0].blocks.filter((b) => b.role === "brief")).toHaveLength(6);
    expect(plan.decisions.some((d) => d.decision.includes("gathered"))).toBe(true);
  });

  it("breaks a long run of similar surfaces with material the edition actually has", () => {
    const doc = edition(
      [
        article("a1", { wordCount: 1200, heroMediaId: "m0", media: [{ mediaId: "m0", role: "HERO", sortOrder: 0 }] }),
        ...Array.from({ length: 10 }, (_, i) =>
          article(`c${i}`, { wordCount: 420, pullQuotes: [{ text: `Quote ${i}`, attribution: null }], media: [{ mediaId: `m${i + 1}`, role: "INLINE", sortOrder: 0 }, { mediaId: `n${i + 1}`, role: "INLINE", sortOrder: 1 }] }),
        ),
      ],
      [media("m0"), ...Array.from({ length: 10 }, (_, i) => media(`m${i + 1}`)), ...Array.from({ length: 10 }, (_, i) => media(`n${i + 1}`))],
      "a1",
    );
    const plan = planEdition("ed1", readSignals(doc), direction);
    const resets = plan.surfaces.filter((s) => s.id.startsWith("r"));
    expect(resets.length).toBeGreaterThan(0);
    expect(plan.decisions.some((d) => d.because.includes("reads as a list"))).toBe(true);
    // Every reset is made of something the edition has: a photograph, a quote or its figures.
    for (const reset of resets) expect(["photo-spread", "quote", "stat-group"]).toContain(reset.blocks[0].role);
  });

  it("invents no reset when there is nothing to reset with", () => {
    const doc = edition(Array.from({ length: 12 }, (_, i) => article(`a${i}`, { wordCount: 400 })));
    const plan = planEdition("ed1", readSignals(doc), direction);
    expect(plan.surfaces.filter((s) => s.id.startsWith("r"))).toHaveLength(0);
  });

  it("puts more on a surface when the publication is dense, and less when it breathes", () => {
    const doc = edition(Array.from({ length: 9 }, (_, i) => article(`a${i}`, { wordCount: 420 })));
    const signals = readSignals(doc);
    const airy = planEdition("ed1", signals, resolveDirection(brand, newIdentity("p1", "A", { genome: { density: 0.05 } }), null));
    const dense = planEdition("ed1", signals, resolveDirection(brand, newIdentity("p1", "A", { genome: { density: 0.95 } }), null));
    expect(dense.surfaces.length).toBeLessThan(airy.surfaces.length);
    const densest = Math.max(...dense.surfaces.map((s) => s.density));
    const airiest = Math.max(...airy.surfaces.map((s) => s.density));
    expect(densest).toBeGreaterThan(airiest);
  });

  it("plans the same edition the same way twice", () => {
    const doc = edition([article("a1", { wordCount: 900 }), article("a2", { wordCount: 300 })], [], "a1");
    const signals = readSignals(doc);
    const first = planEdition("ed1", signals, direction);
    const second = planEdition("ed1", signals, direction);
    // Ids are allocated per call; everything that decides the design is identical.
    expect(first.surfaces.map((s) => [s.kind, s.intent, s.density, s.blocks.map((b) => [b.role, b.articleId])])).toEqual(
      second.surfaces.map((s) => [s.kind, s.intent, s.density, s.blocks.map((b) => [b.role, b.articleId])]),
    );
  });

  it("still produces a publication when the edition is one long article and nothing else", () => {
    const doc = edition([article("a1", { wordCount: 4000 })]);
    const plan = planEdition("ed1", readSignals(doc), direction);
    expect(plan.surfaces[0].kind).toBe("cover");
    expect(plan.surfaces.some((s) => s.blocks.some((b) => b.role === "lead"))).toBe(true);
    expect(plan.surfaces[plan.surfaces.length - 1].kind).toBe("close");
  });

  it("produces something for an edition with nothing in it, rather than throwing", () => {
    const plan = planEdition("ed1", readSignals(edition([])), direction);
    expect(plan.surfaces).toHaveLength(1);
    expect(plan.surfaces[0].kind).toBe("close");
  });
});
