import { describe, expect, it } from "vitest";
import {
  absorb,
  breakPoint,
  demote,
  describePlan,
  dropEmpty,
  FIT_STEPS,
  jumpSource,
  jumpTarget,
  PAGE_SIZES,
  planIntegrity,
  planPrint,
  reflow,
  splitCopy,
  tighten,
  type PrintPlan,
} from "@/lib/design/pages";
import { block, element, emptyDesign, section, surface, type DesignBlock, type EditionDesign } from "@/lib/design/model";
import { gridForDirection } from "@/lib/design/grid";
import { genomeFromBrand } from "@/lib/design/genome";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { marginsMm, printCss, printWords, renderPrintEdition, renderPrintPage } from "@/server/design/render/print";
import { resolve } from "@/server/design/render/content";
import type { DocumentArticle, EditionDocument } from "@/lib/publication/document";

/**
 * The design on paper.
 *
 * Print is where intent stops being an opinion: a page is a fixed rectangle and a story that runs
 * long has to go somewhere. What is worth testing is therefore not that markup came out, but that
 * the constraints the composition stated are actually enforced — that a cover is never continued,
 * that a heading is not left alone at the foot of a page, that a story carried over says where it
 * went, and that the folio on the page is the folio in the contents.
 */

const genome = genomeFromBrand(DEFAULT_BRAND_SYSTEM);
const direction = resolveDirection(genome, newIdentity("p1", "The Review"), null);
const grid = gridForDirection(direction);

function story(id: string, extra: Partial<DesignBlock> = {}): DesignBlock {
  return block("feature", {
    articleId: id,
    elements: [
      element("headline", { kind: "article", articleId: id, part: "headline" }),
      element("body", { kind: "article", articleId: id, part: "body" }),
    ],
    ...extra,
  });
}

function designOf(surfaces: { kind: "cover" | "opener" | "spread" | "flow" | "close"; blocks: DesignBlock[]; atomic?: boolean }[]): EditionDesign {
  const base = emptyDesign("ed1", grid);
  return {
    ...base,
    sections: [
      section("News", {
        sectionId: "s1",
        surfaces: surfaces.map((entry) => surface({ kind: entry.kind, blocks: entry.blocks, atomic: entry.atomic ?? false })),
      }),
    ],
  };
}

function article(id: string): DocumentArticle {
  return {
    id,
    storyId: `st-${id}`,
    sectionId: "s1",
    storyType: "NEWS",
    kicker: "News",
    headline: `Headline ${id}`,
    standfirst: "A standfirst.",
    byline: "A. Writer",
    body: [
      { id: `${id}-p1`, type: "paragraph", text: "One." },
      { id: `${id}-p2`, type: "paragraph", text: "Two." },
      { id: `${id}-p3`, type: "paragraph", text: "Three." },
    ],
    pullQuotes: [],
    media: [],
    heroMediaId: null,
    tags: [],
    campuses: [],
    wordCount: 600,
    bdd: null,
    sourceIds: [],
    status: "APPROVED",
    eventDateText: null,
  };
}

function doc(articles: DocumentArticle[]): EditionDocument {
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
      masthead: { title: "The Review", tagline: "Every month" },
      cover: { storyId: null, articleId: null, headline: null, standfirst: null, mediaId: null, teasers: [] },
      editorial: null,
      credits: [],
      contactEmail: null,
      website: null,
      campuses: [],
    },
    sections: [{ id: "s1", slug: "news", name: "News", kicker: null, colour: null, sortOrder: 0 }],
    articles,
    media: [],
    pages: [],
    toc: [],
    references: [],
    warnings: [],
  };
}

const content = (articles: DocumentArticle[]) => ({ document: doc(articles), medium: "print" as const, urls: {} });

function renderOptions(plan: PrintPlan, articles: DocumentArticle[]) {
  return { plan, grid, direction, content: content(articles), title: "The Review", issueLabel: "Issue N°1" };
}

describe("resolving a design into pages", () => {
  it("gives every surface a page, numbered from the first", () => {
    const plan = planPrint(designOf([{ kind: "cover", blocks: [story("a1")] }, { kind: "flow", blocks: [story("a2")] }]));
    expect(plan.pages).toHaveLength(2);
    expect(plan.pages.map((page) => page.number)).toEqual([1, 2]);
    expect(plan.pages.map((page) => page.side)).toEqual(["right", "left"]);
    expect(plan.size).toBe(PAGE_SIZES.a4);
  });

  it("leaves out a surface with nothing on it", () => {
    const plan = planPrint(designOf([{ kind: "flow", blocks: [] }, { kind: "flow", blocks: [story("a1")] }]));
    expect(plan.pages).toHaveLength(1);
  });

  it("holds an opener back to a right-hand page when the publication asks for that", () => {
    const design = designOf([
      { kind: "cover", blocks: [story("a1")] },
      { kind: "flow", blocks: [story("a2")] },
      { kind: "flow", blocks: [story("a3")] },
      { kind: "opener", blocks: [story("a4")] },
    ]);
    const loose = planPrint(design);
    expect(loose.pages).toHaveLength(4);
    // Left to itself the opener lands on a left-hand page, which is where openers go to die.
    expect(loose.pages[3].side).toBe("left");

    const bound = planPrint(design, { openersOnRight: true });
    expect(bound.pages).toHaveLength(5);
    expect(bound.pages[3].blank).toBe(true);
    const opener = bound.pages[4];
    expect(opener.side).toBe("right");
    expect(opener.surfaces[0].kind).toBe("opener");
  });

  it("knows where every story and block can be found", () => {
    const plan = planPrint(designOf([{ kind: "flow", blocks: [story("a1")] }, { kind: "flow", blocks: [story("a2"), story("a3")] }]));
    expect(plan.pageOfArticle.a1).toBe(1);
    expect(plan.pageOfArticle.a3).toBe(2);
    expect(Object.keys(plan.pageOfBlock)).toHaveLength(3);
  });
});

describe("where a page may be cut", () => {
  it("cuts where the measurement says the page ran out", () => {
    const blocks = [story("a1"), story("a2"), story("a3")];
    expect(breakPoint(blocks, new Set([blocks[0].id, blocks[1].id]))).toBe(2);
  });

  it("never leaves a heading alone at the foot of a page", () => {
    const heading = story("a2", { constraints: { priority: 0.5, keepWithNext: true } });
    const blocks = [story("a1"), heading, story("a3")];
    // The measurement says the heading fits and the story after it does not; the cut moves up.
    expect(breakPoint(blocks, new Set([blocks[0].id, heading.id]))).toBe(1);
  });

  it("never opens a page with a block that may not open one", () => {
    const continuation = story("a3", { constraints: { priority: 0.5, avoidBreakBefore: true } });
    const blocks = [story("a1"), story("a2"), continuation];
    expect(breakPoint(blocks, new Set([blocks[0].id, blocks[1].id]))).toBe(1);
  });

  it("keeps something on the page, whatever the rules ask for", () => {
    const blocks = [story("a1", { constraints: { priority: 0.5, keepWithNext: true } }), story("a2")];
    expect(breakPoint(blocks, new Set())).toBe(1);
  });

  it("lets a whole surface leave a page that is already carrying another", () => {
    // The floor is what stops a page being emptied; a second surface on the page is not the floor.
    const blocks = [story("a1")];
    expect(breakPoint(blocks, new Set(), 0)).toBe(0);
  });
});

describe("carrying what does not fit", () => {
  it("moves a whole surface down rather than splitting the one before it", () => {
    const first = story("a1");
    const second = story("a2");
    const plan = planPrint(designOf([{ kind: "flow", blocks: [first] }, { kind: "flow", blocks: [second] }]));
    const merged = absorb(plan, plan.pages[0].id)!;
    expect(merged.pages).toHaveLength(1);
    // Now the second surface does not fit: it leaves entirely, and the first page keeps its own.
    const carried = reflow(merged, merged.pages[0].id, new Set([first.id]))!;
    expect(carried.plan.pages[0].surfaces).toHaveLength(1);
    expect(carried.plan.pages[1].surfaces[0].blocks.map((block) => block.id)).toEqual([second.id]);
    expect(carried.plan.pages[1].surfaces[0].continued).toBe(false);
  });

  it("moves the overflow onto a page of its own, keeping the surface it came from", () => {
    const blocks = [story("a1"), story("a2"), story("a3")];
    const plan = planPrint(designOf([{ kind: "flow", blocks }]));
    const carried = reflow(plan, plan.pages[0].id, new Set([blocks[0].id]));

    expect(carried).not.toBeNull();
    expect(carried!.moved).toEqual([blocks[1].id, blocks[2].id]);
    expect(carried!.plan.pages).toHaveLength(2);
    expect(carried!.plan.pages[0].surfaces[0].continues).toBe(true);
    expect(carried!.plan.pages[1].surfaces[0].continued).toBe(true);
    expect(carried!.plan.pages[1].surfaces[0].surfaceId).toBe(plan.pages[0].surfaces[0].surfaceId);
    // And the folios followed.
    expect(carried!.plan.pageOfArticle.a3).toBe(2);
  });

  it("never continues a cover", () => {
    const plan = planPrint(designOf([{ kind: "cover", blocks: [story("a1"), story("a2")] }]));
    expect(reflow(plan, plan.pages[0].id, new Set())).toBeNull();
  });

  it("says where a carried story went, and where it came from", () => {
    const blocks = [story("a1"), story("a2")];
    const plan = planPrint(designOf([{ kind: "flow", blocks }]));
    const carried = reflow(plan, plan.pages[0].id, new Set([blocks[0].id]))!.plan;
    const [head, tail] = carried.pages;
    expect(jumpTarget(carried, head.id, head.surfaces[0].surfaceId)).toBe(2);
    expect(jumpSource(carried, tail.id, tail.surfaces[0].surfaceId)).toBe(1);
  });
});

describe("breaking a story's copy over the page turn", () => {
  it("keeps the paragraphs that fit and carries the rest as a continuation", () => {
    const lead = story("a1");
    const plan = planPrint(designOf([{ kind: "flow", blocks: [lead] }]));
    const split = splitCopy(plan, plan.pages[0].id, lead.id, ["a1-p1", "a1-p2"], ["a1-p3"]);

    expect(split).not.toBeNull();
    const blocks = split!.plan.pages[0].surfaces[0].blocks;
    expect(blocks).toHaveLength(2);
    const head = blocks[0].elements.find((el) => el.role === "body")!;
    expect(head.content).toMatchObject({ kind: "article", blockIds: ["a1-p1", "a1-p2"] });

    const tail = blocks[1];
    expect(tail.id).toBe(split!.tailBlockId);
    expect(tail.articleId).toBe("a1");
    // A continuation is the story resumed: no second headline, no second byline.
    expect(tail.elements.map((el) => el.role)).toEqual(["body"]);
    expect(tail.elements[0].content).toMatchObject({ blockIds: ["a1-p3"] });
  });

  it("refuses to break a block that said it may not be broken", () => {
    const quote = story("a1", { constraints: { priority: 0.5, keepTogether: true } });
    const plan = planPrint(designOf([{ kind: "flow", blocks: [quote] }]));
    expect(splitCopy(plan, plan.pages[0].id, quote.id, ["a1-p1"], ["a1-p2"])).toBeNull();
  });

  it("refuses a split that would leave one side empty", () => {
    const lead = story("a1");
    const plan = planPrint(designOf([{ kind: "flow", blocks: [lead] }]));
    expect(splitCopy(plan, plan.pages[0].id, lead.id, [], ["a1-p1"])).toBeNull();
    expect(splitCopy(plan, plan.pages[0].id, lead.id, ["a1-p1"], [])).toBeNull();
  });
});

describe("paper that was not earned", () => {
  it("pulls the next page up and rejoins a story that was split", () => {
    const blocks = [story("a1"), story("a2")];
    const plan = planPrint(designOf([{ kind: "flow", blocks }]));
    const carried = reflow(plan, plan.pages[0].id, new Set([blocks[0].id]))!.plan;
    const merged = absorb(carried, carried.pages[0].id);

    expect(merged).not.toBeNull();
    expect(merged!.pages).toHaveLength(1);
    expect(merged!.pages[0].surfaces).toHaveLength(1);
    expect(merged!.pages[0].surfaces[0].blocks.map((candidate) => candidate.id)).toEqual(blocks.map((candidate) => candidate.id));
    expect(merged!.pages[0].surfaces[0].continues).toBe(false);
  });

  it("never tidies a cover away onto the page before it", () => {
    const plan = planPrint(designOf([{ kind: "flow", blocks: [story("a1")] }, { kind: "cover", blocks: [story("a2")] }]));
    expect(absorb(plan, plan.pages[0].id)).toBeNull();
  });

  it("drops a page left with nothing on it, and keeps a blank that was bought on purpose", () => {
    const design = designOf([
      { kind: "cover", blocks: [story("a1")] },
      { kind: "flow", blocks: [story("a2")] },
      { kind: "opener", blocks: [story("a3")] },
    ]);
    const plan = planPrint(design, { openersOnRight: true });
    const emptied: PrintPlan = {
      ...plan,
      pages: plan.pages.map((page) => (page.number === 2 ? { ...page, surfaces: page.surfaces.map((surf) => ({ ...surf, blocks: [] })) } : page)),
    };
    const cleaned = dropEmpty(emptied);
    expect(cleaned.pages.filter((page) => page.blank)).toHaveLength(1);
    expect(cleaned.pages.filter((page) => !page.blank)).toHaveLength(2);
  });
});

describe("overruling the design, on the record", () => {
  it("moves the least important block off a page that cannot be made to fit", () => {
    const lead = story("a1", { constraints: { priority: 0.9 } });
    const ornament = block("pull-quote", {
      articleId: "a1",
      constraints: { priority: 0.2, keepTogether: true },
      elements: [element("quote", { kind: "article", articleId: "a1", part: "pullquote" })],
    });
    const plan = planPrint(designOf([{ kind: "opener", blocks: [lead, ornament] }, { kind: "flow", blocks: [story("a2")] }]));
    const moved = demote(plan, plan.pages[0].id, [ornament.id]);

    expect(moved).not.toBeNull();
    expect(moved!.blockId).toBe(ornament.id);
    // The lead kept the opener; the quote went to the page after, which was not a cover.
    expect(moved!.plan.pages[0].surfaces[0].blocks.map((candidate) => candidate.id)).toEqual([lead.id]);
    expect(moved!.plan.pages[1].surfaces[0].blocks.map((candidate) => candidate.id)).toEqual([ornament.id]);
    expect(moved!.plan.relaxations).toHaveLength(1);
    expect(moved!.plan.relaxations[0]).toMatchObject({ blockId: ornament.id, fromPage: 1 });
    expect(moved!.plan.relaxations[0].reason).toContain("pull quote");
  });

  it("will not empty a page to make it fit", () => {
    const plan = planPrint(designOf([{ kind: "opener", blocks: [story("a1")] }]));
    expect(demote(plan, plan.pages[0].id, [plan.pages[0].surfaces[0].blocks[0].id])).toBeNull();
  });

  it("does not call an atomic surface broken when the plan says it was overruled", () => {
    const lead = story("a1", { constraints: { priority: 0.9 } });
    const ornament = story("a2", { constraints: { priority: 0.1 } });
    const design = designOf([{ kind: "flow", blocks: [lead, ornament], atomic: true }, { kind: "flow", blocks: [story("a3")] }]);
    const plan = planPrint(design);
    const moved = demote(plan, plan.pages[0].id, [ornament.id])!.plan;
    // The surface is on two pages now — and the plan says why, so it is a decision, not a defect.
    expect(planIntegrity(design, moved).brokenAtomic).toEqual([]);
    expect(planIntegrity(design, { ...moved, relaxations: [] }).brokenAtomic).toHaveLength(1);
  });
});

describe("setting a page tighter", () => {
  it("steps up to the ceiling and then stops", () => {
    let plan = planPrint(designOf([{ kind: "flow", blocks: [story("a1")] }]));
    for (let step = 0; step < FIT_STEPS.max; step += 1) plan = tighten(plan, plan.pages[0].id)!;
    expect(plan.pages[0].fit).toBe(FIT_STEPS.max);
    expect(tighten(plan, plan.pages[0].id)).toBeNull();
  });

  it("never sets body copy below the size a printed page can be read at", () => {
    const plan = planPrint(designOf([{ kind: "flow", blocks: [story("a1")] }]));
    const css = printCss(renderOptions(plan, [article("a1")]));
    const sizes = [...css.matchAll(/\.page\[data-fit="\d"\] \.body[^{]*\{font-size:([\d.]+)pt/g)].map((match) => Number(match[1]));
    expect(sizes).toHaveLength(4);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(9);
  });
});

describe("the sheet itself", () => {
  it("turns the grid's margin units into millimetres, inside what a printer can hold", () => {
    expect(marginsMm({ ...grid, columns: 12, margins: { top: 1, right: 1, bottom: 1, left: 1 } }, 210).top).toBeCloseTo(17.5, 1);
    // Nothing under 8 mm, whatever the grid asks for; nothing past a fifth of the page.
    expect(marginsMm({ ...grid, columns: 12, margins: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 } }, 210).left).toBe(8);
    expect(marginsMm({ ...grid, columns: 12, margins: { top: 9, right: 9, bottom: 9, left: 9 } }, 210).right).toBe(42);
  });

  it("states the page size the PDF will be printed at", () => {
    const plan = planPrint(designOf([{ kind: "flow", blocks: [story("a1")] }]), { size: "a5" });
    const css = printCss(renderOptions(plan, [article("a1")]));
    expect(css).toContain("@page{size:148mm 210mm;margin:0;}");
  });
});

describe("what a printed page says", () => {
  it("prints the folio, and the running head, on an ordinary page", () => {
    const plan = planPrint(designOf([{ kind: "flow", blocks: [story("a1")] }]));
    const markup = renderPrintPage(plan.pages[0], renderOptions(plan, [article("a1")])).value;
    expect(markup).toContain('data-number="1"');
    expect(markup).toContain('class="folio');
    expect(markup).toContain('class="running');
    expect(markup).toContain("The Review");
  });

  it("leaves the furniture off a cover", () => {
    const plan = planPrint(designOf([{ kind: "cover", blocks: [story("a1")] }]));
    const markup = renderPrintPage(plan.pages[0], renderOptions(plan, [article("a1")])).value;
    expect(markup).not.toContain('class="folio');
    expect(markup).not.toContain('class="running');
    expect(markup).toContain('data-bleed-sheet="true"');
  });

  it("tells the reader where the story went, and where it came from", () => {
    const blocks = [story("a1"), story("a2")];
    const plan = planPrint(designOf([{ kind: "flow", blocks }]));
    const settled = reflow(plan, plan.pages[0].id, new Set([blocks[0].id]))!.plan;
    const options = renderOptions(settled, [article("a1"), article("a2")]);
    const head = renderPrintPage(settled.pages[0], options).value;
    const tail = renderPrintPage(settled.pages[1], options).value;
    expect(head).toContain("Continued on page 2");
    expect(tail).toContain("Continued from page 1");
  });

  it("says it in the language the publication is read in", () => {
    expect(printWords("fr").continuedOn(9)).toBe("Suite page 9");
    expect(printWords("fr-CA").continuedFrom(3)).toBe("Suite de la page 3");
    expect(printWords(undefined).continuedOn(9)).toBe("Continued on page 9");
  });

  it("puts one page in the document for every page in the plan", () => {
    const plan = planPrint(designOf([{ kind: "cover", blocks: [story("a1")] }, { kind: "flow", blocks: [story("a2")] }]));
    const markup = renderPrintEdition(renderOptions(plan, [article("a1"), article("a2")]));
    expect([...markup.matchAll(/class="page"/g)]).toHaveLength(2);
    expect(markup).toContain('<html lang="en">');
  });
});

describe("the page number nobody else can answer", () => {
  it("resolves to the folio in print, and to nothing where there are no pages", () => {
    const ctx = content([article("a1")]);
    expect(resolve({ kind: "meta", part: "page" }, ctx)).toMatchObject({ kind: "nothing" });
    expect(resolve({ kind: "meta", part: "page" }, { ...ctx, page: { number: 7, total: 12 } })).toEqual({ kind: "text", text: "7" });
  });
});

describe("what the paper refused", () => {
  it("reports an atomic surface that ended up on two pages", () => {
    const blocks = [story("a1"), story("a2")];
    const design = designOf([{ kind: "flow", blocks, atomic: true }]);
    const plan = planPrint(design);
    // Force the break the engine would have refused, to prove the check sees it.
    const broken: PrintPlan = {
      ...plan,
      pages: [
        { ...plan.pages[0], surfaces: [{ ...plan.pages[0].surfaces[0], blocks: [blocks[0]], continues: true }] },
        { ...plan.pages[0], id: "pg_forced", surfaces: [{ ...plan.pages[0].surfaces[0], blocks: [blocks[1]], continued: true }] },
      ],
    };
    expect(planIntegrity(design, broken).brokenAtomic).toEqual([plan.pages[0].surfaces[0].surfaceId]);
    expect(planIntegrity(design, plan).brokenAtomic).toEqual([]);
  });

  it("describes the issue in words an editor would use", () => {
    const blocks = [story("a1"), story("a2")];
    const plan = planPrint(designOf([{ kind: "flow", blocks }]));
    const carried = reflow(plan, plan.pages[0].id, new Set([blocks[0].id]))!.plan;
    const summary = describePlan(tighten(carried, carried.pages[0].id)!);
    expect(summary).toContain("2 pages on A4");
    expect(summary).toContain("carrying a story on from the page before");
    expect(summary).toContain("tighter");
  });
});
