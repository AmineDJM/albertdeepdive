import { describe, expect, it } from "vitest";
import { renderWebEdition } from "@/server/design/render/web";
import { renderEmailEdition } from "@/server/design/render/email";
import { renderPrintEdition } from "@/server/design/render/print";
import { planPrint } from "@/lib/design/pages";
import { composeDesign } from "@/lib/design/compose";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { genomeFromBrand } from "@/lib/design/genome";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { gridForDirection } from "@/lib/design/grid";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { blocksOf, type EditionDesign } from "@/lib/design/model";
import { fixtureArticle, fixtureEdition, fixtureMedia } from "../helpers/edition-fixture";
import type { EditionDocument } from "@/lib/publication/document";

/**
 * Same design in, same pixels out.
 *
 * §94 and §95: a published issue must be reproducible, and the golden tests are meaningless
 * without this. Snapshotting the markup would be a worse test than it looks — it churns on every
 * legitimate change and nobody reads the diff — so what is asserted is the property the snapshot
 * was a proxy for: rendering the same design twice is byte-identical, in every medium, and
 * composing the same edition twice gives the same publication.
 */

const direction = resolveDirection(genomeFromBrand(DEFAULT_BRAND_SYSTEM), newIdentity("p1", "The Review"), null);
const grid = gridForDirection(direction);

const document: EditionDocument = fixtureEdition(
  [
    fixtureArticle("a1", { wordCount: 1600, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }),
    fixtureArticle("a2", { wordCount: 900 }),
    fixtureArticle("a3", { wordCount: 620 }),
    fixtureArticle("a4", { wordCount: 180 }),
    fixtureArticle("a5", { wordCount: 120 }),
  ],
  [fixtureMedia("m1"), fixtureMedia("m2")],
  "a1",
);
const signals = readSignals(document);
const compose = (): EditionDesign => composeDesign({ editionId: "ed1", document, signals, direction, plan: planEdition("ed1", signals, direction) });

const content = { document, medium: "web" as const, urls: { m1: "https://cdn.test/m1.jpg", m2: "https://cdn.test/m2.jpg" } };

/** The design's shape, without the ids — which are deliberately unique per composition. */
function shapeOf(design: EditionDesign) {
  return design.sections.map((section) => ({
    name: section.name,
    surfaces: section.surfaces.map((surface) => ({
      kind: surface.kind,
      atomic: surface.atomic,
      blocks: surface.blocks.map((block) => ({
        role: block.role,
        composition: block.composition,
        importance: block.importance,
        articleId: block.articleId,
        elements: block.elements.map((element) => `${element.role}:${element.content.kind}`),
      })),
    })),
  }));
}

describe("the same design gives the same pages", () => {
  const design = compose();

  it("renders the web edition byte for byte the same, twice", () => {
    const options = { design, direction, content, title: "The Review", locale: "en" };
    expect(renderWebEdition(options)).toBe(renderWebEdition(options));
  });

  it("renders the email byte for byte the same, twice", () => {
    const options = { design, direction, content, locale: "en", organizationName: "Acme", unsubscribeUrl: "https://example.test/u/1" };
    expect(renderEmailEdition(options).html).toBe(renderEmailEdition(options).html);
  });

  it("sets the printed pages byte for byte the same, twice", () => {
    const plan = planPrint(design);
    const options = { plan, grid, direction, content, title: "The Review", issueLabel: "Issue N°1" };
    expect(renderPrintEdition(options)).toBe(renderPrintEdition(options));
  });

  it("puts the same words in every medium", () => {
    const web = renderWebEdition({ design, direction, content, title: "The Review" });
    const email = renderEmailEdition({ design, direction, content, organizationName: "Acme", unsubscribeUrl: "https://example.test/u/1" }).html;
    // The cover's headline is the cover's headline wherever it is read.
    const headline = document.articles[0].headline;
    expect(web).toContain(headline);
    expect(email).toContain(headline);
  });
});

describe("the same edition composes into the same publication", () => {
  it("gives the same shape every time, whatever the ids happen to be", () => {
    expect(shapeOf(compose())).toEqual(shapeOf(compose()));
  });

  it("gives every block an id of its own", () => {
    const design = compose();
    const ids = blocksOf(design).map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
    // And two compositions of the same edition never collide, so two designs can be compared.
    const other = blocksOf(compose()).map((block) => block.id);
    expect(ids.some((id) => other.includes(id))).toBe(false);
  });

  it("plans the same pages from the same design", () => {
    const design = compose();
    const first = planPrint(design);
    const second = planPrint(design);
    expect(first.pages.map((page) => page.surfaces.map((surface) => surface.surfaceId))).toEqual(second.pages.map((page) => page.surfaces.map((surface) => surface.surfaceId)));
    expect(first.pageOfArticle).toEqual(second.pageOfArticle);
  });
});
