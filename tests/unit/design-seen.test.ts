import { describe, expect, it } from "vitest";
import { seenFindings, type LayoutCritique } from "@/server/ai/services/layout-critic";
import { pagesWorthSeeing } from "@/server/design/shots";
import { planPrint } from "@/lib/design/pages";
import { block, element, emptyDesign, section, surface, type DesignBlock } from "@/lib/design/model";
import { gridForDirection } from "@/lib/design/grid";
import { genomeFromBrand } from "@/lib/design/genome";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";

/**
 * What the critic that looks is allowed to say.
 *
 * A model asked to judge a page will sometimes name a block that does not exist, propose a
 * composition no renderer draws, or answer about page 40 of a twelve-page issue. None of that is
 * an error worth showing anybody — it is enthusiasm, and the boundary that turns enthusiasm into
 * either a real finding or nothing at all is tested here, because it is the only thing standing
 * between a vision model and the design.
 */

const direction = resolveDirection(genomeFromBrand(DEFAULT_BRAND_SYSTEM), newIdentity("p1", "The Review"), null);
const grid = gridForDirection(direction);

const critique = (findings: LayoutCritique["findings"]): LayoutCritique => ({ verdict: "competent", summary: "It reads as a publication, mostly.", findings });

const known = (blocks: { id: string; role: string }[], pages: number[]) => ({
  blockIds: new Set(blocks.map((entry) => entry.id)),
  roleOf: new Map(blocks.map((entry) => [entry.id, entry.role])),
  pages: new Set(pages),
});

describe("reading back what the critic saw", () => {
  it("keeps a finding about a block that exists, with the change it proposed", () => {
    const found = seenFindings(
      critique([
        { dimension: "rhythm", severity: "SERIOUS", where: "bl_1", issue: "Three pages in a row look the same.", remedy: { kind: "composition", blockId: "bl_1", composition: "three-column", importance: null } },
      ]),
      known([{ id: "bl_1", role: "feature" }], [1, 2, 3]),
    );
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe("seen");
    expect(found[0].remedy).toEqual({ kind: "composition", blockId: "bl_1", to: "three-column" });
  });

  it("drops a finding about a block nobody laid out", () => {
    const found = seenFindings(
      critique([{ dimension: "imagery", severity: "SERIOUS", where: "bl_invented", issue: "This picture is wrong.", remedy: { kind: "drop", blockId: "bl_invented", composition: null, importance: null } }]),
      known([{ id: "bl_1", role: "feature" }], [1]),
    );
    expect(found).toEqual([]);
  });

  it("refuses a composition the role cannot be drawn in, and keeps the finding", () => {
    const found = seenFindings(
      critique([
        { dimension: "rhythm", severity: "SERIOUS", where: "bl_1", issue: "It is monotonous.", remedy: { kind: "composition", blockId: "bl_1", composition: "kaleidoscope", importance: null } },
      ]),
      known([{ id: "bl_1", role: "feature" }], [1]),
    );
    // The observation stands; the proposal does not.
    expect(found).toHaveLength(1);
    expect(found[0].issue).toContain("monotonous");
    expect(found[0].remedy).toEqual({ kind: "none" });
  });

  it("understands a finding about a page, and forgets one about a page that was never printed", () => {
    const found = seenFindings(
      critique([
        { dimension: "density", severity: "MINOR", where: "page 3", issue: "The foot of the page is empty.", remedy: { kind: "none", blockId: null, composition: null, importance: null } },
        { dimension: "density", severity: "MINOR", where: "page 40", issue: "This one too.", remedy: { kind: "none", blockId: null, composition: null, importance: null } },
      ]),
      known([{ id: "bl_1", role: "feature" }], [1, 2, 3]),
    );
    expect(found.map((item) => item.page)).toEqual([3]);
  });
});

describe("which pages are worth looking at", () => {
  const story = (id: string): DesignBlock => block("feature", { articleId: id, elements: [element("headline", { kind: "article", articleId: id, part: "headline" })] });

  it("always looks at the cover, an opener, the fullest page and the emptiest", () => {
    const base = emptyDesign("ed1", grid);
    const design = {
      ...base,
      sections: [
        section("News", {
          sectionId: "s1",
          surfaces: [
            surface({ kind: "cover", blocks: [story("a1")] }),
            surface({ kind: "flow", blocks: [story("a2")] }),
            surface({ kind: "flow", blocks: [story("a3")] }),
            surface({ kind: "opener", blocks: [story("a4")] }),
            surface({ kind: "flow", blocks: [story("a5")] }),
            surface({ kind: "flow", blocks: [story("a6")] }),
          ],
        }),
      ],
    };
    const plan = planPrint(design);
    const measures = plan.pages.map((page, index) => ({ number: page.number, extent: [0.4, 0.95, 0.2, 0.5, 0.7, 0.6][index], tailGap: 0 }));
    const chosen = pagesWorthSeeing(plan, measures);

    expect(chosen).toContain(1); // the cover
    expect(chosen).toContain(4); // the opener
    expect(chosen).toContain(2); // the fullest
    expect(chosen).toContain(3); // the emptiest
    expect(chosen.length).toBeLessThanOrEqual(5);
    // Deterministic: the same issue gives the same shots, so two runs can be compared.
    expect(pagesWorthSeeing(plan, measures)).toEqual(chosen);
  });

  it("asks for nothing when there is nothing to look at", () => {
    expect(pagesWorthSeeing(planPrint(emptyDesign("ed1", grid)), [])).toEqual([]);
  });
});
