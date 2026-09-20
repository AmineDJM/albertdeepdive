import { describe, expect, it } from "vitest";
import { composeDesign } from "@/lib/design/compose";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { genomeFromBrand } from "@/lib/design/genome";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { gridForDirection } from "@/lib/design/grid";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { blocksOf, surfacesOf } from "@/lib/design/model";
import { blocking, inspectDesign } from "@/lib/design/critic";
import { planPrint } from "@/lib/design/pages";
import { renderWebEdition } from "@/server/design/render/web";
import { renderEmailEdition } from "@/server/design/render/email";
import { renderPrintEdition } from "@/server/design/render/print";
import { validateDesign, isRenderable } from "@/lib/design/validate";
import { fixtureArticle, fixtureEdition, fixtureMedia } from "../helpers/edition-fixture";
import type { DocumentArticle, DocumentMedia, EditionDocument } from "@/lib/publication/document";

/**
 * Five publications, four formats, one engine.
 *
 * §103 of the design brief: the engine has to be proved on genuinely different material, because
 * the failure mode of a design system is looking excellent on the one issue it was built against.
 * These five are chosen to break different things — a photo-led community letter, a restrained
 * business review, an issue with no pictures at all, one that is mostly figures, and five short
 * pieces meant for an inbox.
 *
 * What is asserted for every one of them is the floor: it composes, it validates, nothing blocking
 * is found in it, and all four outputs come out with the words in them. The judgements that need
 * eyes are made on real editions with a real browser and a real model elsewhere; these are the
 * things that must never break, on any material, without a test going red.
 */

const direction = resolveDirection(genomeFromBrand(DEFAULT_BRAND_SYSTEM), newIdentity("p1", "The Review"), null);
const grid = gridForDirection(direction);

function paragraphs(id: string, count: number, text: string): DocumentArticle["body"] {
  return Array.from({ length: count }, (_, index) => ({ id: `${id}-p${index + 1}`, type: "paragraph" as const, text: `${text} (${index + 1})` }));
}

/** A: a community newsletter that is mostly photographs. */
function photographic(): EditionDocument {
  const media: DocumentMedia[] = Array.from({ length: 8 }, (_, index) => fixtureMedia(`m${index + 1}`));
  const articles = Array.from({ length: 6 }, (_, index) =>
    fixtureArticle(`a${index + 1}`, {
      wordCount: 260 + index * 40,
      heroMediaId: `m${index + 1}`,
      media: [{ mediaId: `m${index + 1}`, role: "HERO", sortOrder: 0 }],
      body: paragraphs(`a${index + 1}`, 3, "The afternoon was bright and the whole street came out."),
    }),
  );
  return fixtureEdition(articles, media, "a1");
}

/** B: a serious business review — long pieces, restraint, a couple of portraits. */
function business(): EditionDocument {
  const media = [fixtureMedia("m1", { kind: "PORTRAIT" }), fixtureMedia("m2")];
  const articles = [
    fixtureArticle("a1", { wordCount: 2400, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }], body: paragraphs("a1", 14, "Margins narrowed again this quarter, and the board knows why.") }),
    fixtureArticle("a2", { wordCount: 1800, body: paragraphs("a2", 11, "The acquisition closes in March, subject to the usual conditions.") }),
    fixtureArticle("a3", { wordCount: 1100, body: paragraphs("a3", 7, "Three of the five regions grew; the other two did not.") }),
  ];
  return fixtureEdition(articles, media, "a1");
}

/** C: almost no imagery — §99's test, where typography and space have to carry it. */
function textOnly(): EditionDocument {
  const articles = Array.from({ length: 5 }, (_, index) =>
    fixtureArticle(`a${index + 1}`, { wordCount: 700 + index * 120, heroMediaId: null, media: [], pullQuotes: [{ text: "A line worth setting large", attribution: "A. Writer" }], body: paragraphs(`a${index + 1}`, 6, "Nobody photographed any of this, and it does not matter.") }),
  );
  return fixtureEdition(articles, [], "a1");
}

/** D: mostly figures — stat blocks, tables, and prose around them. */
function dataHeavy(): EditionDocument {
  const articles = Array.from({ length: 4 }, (_, index) =>
    fixtureArticle(`a${index + 1}`, {
      wordCount: 500,
      heroMediaId: null,
      media: [],
      facts: [
        { id: `f${index}a`, statement: "Sales rose 12.4% year on year", status: "ACTIVE", confidence: "HIGH", conflictGroup: null },
        { id: `f${index}b`, statement: "Four of nine shops beat their target", status: "ACTIVE", confidence: "HIGH", conflictGroup: null },
      ],
      body: [
        ...paragraphs(`a${index + 1}`, 2, "The figures are the story here."),
        { id: `a${index + 1}-t1`, type: "box" as const, title: "By the numbers", items: ["12.4% growth", "9 shops", "4 above target"] },
      ],
    }),
  );
  return fixtureEdition(articles, [], "a1");
}

/** E: five short pieces, email first — the common case, and the easiest to make generic. */
function shortAndEmailFirst(): EditionDocument {
  const articles = Array.from({ length: 5 }, (_, index) =>
    fixtureArticle(`a${index + 1}`, { wordCount: 110, standfirst: index % 2 ? null : "One sentence about what happened.", heroMediaId: null, media: [], body: paragraphs(`a${index + 1}`, 1, "It happened on Tuesday and it took an hour.") }),
  );
  return fixtureEdition(articles, [fixtureMedia("m1")], "a1");
}

const TERRAIN = [
  { name: "a photography-led community newsletter", document: photographic() },
  { name: "a serious business review", document: business() },
  { name: "an issue with no photographs at all", document: textOnly() },
  { name: "an issue that is mostly figures", document: dataHeavy() },
  { name: "five short pieces, read in an inbox", document: shortAndEmailFirst() },
];

describe.each(TERRAIN)("$name", ({ document }) => {
  const signals = readSignals(document);
  const design = composeDesign({ editionId: "ed1", document, signals, direction, plan: planEdition("ed1", signals, direction) });
  const urls = Object.fromEntries(document.media.map((media) => [media.id, `https://cdn.test/${media.id}.jpg`]));
  const content = { document, medium: "web" as const, urls };

  it("composes into a publication rather than a list", () => {
    expect(surfacesOf(design).length).toBeGreaterThan(2);
    expect(blocksOf(design).length).toBeGreaterThan(3);
    // A cover, and an end.
    expect(blocksOf(design).some((block) => block.role === "cover")).toBe(true);
    expect(surfacesOf(design).at(-1)?.kind).toBe("close");
  });

  it("is renderable, and nothing blocking is found in it", () => {
    expect(isRenderable(validateDesign(design, document))).toBe(true);
    expect(blocking(inspectDesign({ design, signals, direction })).map((finding) => finding.issue)).toEqual([]);
  });

  it("comes out in all four formats with the words in them", () => {
    const headline = document.articles[0].headline;

    const web = renderWebEdition({ design, direction, content, title: "The Review" });
    expect(web).toContain(headline);
    expect(web).toContain("<!doctype html>");

    const email = renderEmailEdition({ design, direction, content, organizationName: "Acme", unsubscribeUrl: "https://example.test/u/1" });
    expect(email.html.toLowerCase()).toContain("unsubscribe");
    expect(email.bytes).toBeLessThan(102_000);

    const plan = planPrint(design);
    const print = renderPrintEdition({ plan, grid, direction, content, title: "The Review", issueLabel: "Issue N°1" });
    expect(print).toContain('class="page"');
    expect(plan.pages.length).toBeGreaterThan(1);

    // The fourth format is the design itself: the same graph all three read from.
    expect(design.media).toContain("print");
  });

  it("never draws a frame with no photograph in it", () => {
    for (const block of blocksOf(design)) {
      const pictures = block.elements.filter((element) => element.content.kind === "media");
      for (const picture of pictures) {
        const content = picture.content;
        if (content.kind !== "media") continue;
        expect(document.media.some((media) => media.id === content.mediaId), `${block.role} points at a picture this issue does not have`).toBe(true);
      }
    }
  });
});

describe("the terrain, compared", () => {
  it("does not give every publication the same issue", () => {
    const shapes = TERRAIN.map(({ name, document }) => {
      const signals = readSignals(document);
      const design = composeDesign({ editionId: "ed1", document, signals, direction, plan: planEdition("ed1", signals, direction) });
      const shape = blocksOf(design)
        .map((block) => `${block.role}:${block.composition}`)
        .join("|");
      return { name, shape };
    });
    // Five different publications, five different issues. Identical shapes would mean the material
    // is not reaching the design at all — so the failure names the two that came out the same,
    // which is the only part of this worth reading when it goes red.
    for (const [index, one] of shapes.entries()) {
      for (const other of shapes.slice(index + 1)) {
        expect(one.shape, `${one.name} and ${other.name} came out as the same issue`).not.toBe(other.shape);
      }
    }
  });

  it("uses photographs where there are photographs, and type where there are none", () => {
    const pictured = TERRAIN[0];
    const bare = TERRAIN[2];
    const count = (document: EditionDocument) => {
      const signals = readSignals(document);
      const design = composeDesign({ editionId: "ed1", document, signals, direction, plan: planEdition("ed1", signals, direction) });
      return blocksOf(design).filter((block) => block.elements.some((element) => element.content.kind === "media")).length;
    };
    expect(count(pictured.document)).toBeGreaterThan(count(bare.document));
    expect(count(bare.document)).toBe(0);
  });
});
