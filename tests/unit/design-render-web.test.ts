import { describe, expect, it } from "vitest";
import { renderDesign } from "@/server/design/render/html";
import { renderWebEdition } from "@/server/design/render/web";
import { resolve } from "@/server/design/render/content";
import { composeDesign } from "@/lib/design/compose";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { genomeFromBrand } from "@/lib/design/genome";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { blocksOf } from "@/lib/design/model";
import { fixtureArticle as article, fixtureEdition as edition, fixtureMedia as media } from "../helpers/edition-fixture";
import type { EditionDocument } from "@/lib/publication/document";

/**
 * The design, as a web edition.
 *
 * What is worth testing in a renderer is not that it produced markup. It is that contributor text
 * cannot break the page, that an element with nothing behind it leaves no empty frame, that the
 * heading outline matches the editorial hierarchy rather than the order things happen to appear in,
 * and that the crop computed for this medium actually reaches the picture.
 */

const brand = genomeFromBrand(DEFAULT_BRAND_SYSTEM);
const direction = resolveDirection(brand, newIdentity("p1", "The Review"), null);

function build(doc: EditionDocument) {
  const signals = readSignals(doc);
  const plan = planEdition("ed1", signals, direction);
  const design = composeDesign({ editionId: "ed1", document: doc, signals, direction, plan });
  const content = { document: doc, medium: "web" as const, urls: Object.fromEntries(doc.media.map((item) => [item.id, `https://cdn.test/${item.id}.jpg`])) };
  return { design, content, signals };
}

describe("rendering a design as HTML", () => {
  it("cannot be broken by what a contributor wrote", () => {
    const nasty = `<script>alert("x")</script> & "quotes" 'and' <b>bold</b>`;
    const doc = edition([article("a1", { headline: nasty, wordCount: 900, body: [{ id: "x", type: "paragraph", text: nasty }] })], [], "a1");
    const { design, content } = build(doc);
    const markup = renderDesign(design, { medium: "web", content }).value;
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&amp;");
  });

  it("draws nothing where there is nothing, rather than an empty frame", () => {
    // No standfirst, no byline, no picture: the elements for them simply do not appear.
    const doc = edition([article("a1", { standfirst: null, byline: null, wordCount: 900 })], [], "a1");
    const { design, content } = build(doc);
    const markup = renderDesign(design, { medium: "web", content }).value;
    expect(markup).not.toContain('class="deck');
    expect(markup).not.toContain('class="byline');
    expect(markup).not.toContain("<figure");
    // And the blocks that do have content are still there.
    expect(markup).toContain('class="headline');
  });

  it("gives the heading outline the editorial hierarchy", () => {
    const doc = edition(
      [article("a1", { wordCount: 1600, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }), article("a2", { wordCount: 700 }), article("a3", { wordCount: 80 })],
      [media("m1")],
      "a1",
    );
    const { design, content } = build(doc);
    const markup = renderDesign(design, { medium: "web", content, baseLevel: 2 }).value;
    // The lead is an h2 inside a page whose h1 is the masthead; a brief is further down.
    const lead = blocksOf(design).find((block) => block.articleId === "a1" && block.role !== "cover")!;
    const brief = blocksOf(design).find((block) => block.articleId === "a3")!;
    expect(markup).toMatch(new RegExp(`id="${lead.id}"[\\s\\S]*?<h2`));
    expect(markup).toMatch(new RegExp(`id="${brief.id}"[\\s\\S]*?<h[45]`));
  });

  it("puts the crop it computed onto the picture, without touching the original", () => {
    const doc = edition([article("a1", { wordCount: 1200, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] })], [media("m1", { width: 3000, height: 1000 })], "a1");
    const { design, content } = build(doc);
    const markup = renderDesign(design, { medium: "web", content }).value;
    expect(markup).toContain("object-position:");
    expect(markup).toContain("aspect-ratio:");
    // The src is still the whole picture: a crop is a rectangle, not a second file.
    expect(markup).toContain("https://cdn.test/m1.jpg");
  });

  it("marks each block with what it is, so a critic and a conversation can point at it", () => {
    const doc = edition([article("a1", { wordCount: 1400 }), article("a2", { wordCount: 400 })], [], "a1");
    const { design, content } = build(doc);
    const markup = renderDesign(design, { medium: "web", content }).value;
    // Every block that reached the page carries what it is. A block whose content all resolved to
    // nothing is legitimately absent, which is why the markup is the source of truth here.
    const drawn = [...markup.matchAll(/data-block="(bl_[^"]+)"/g)].map((match) => match[1]);
    expect(drawn.length).toBeGreaterThan(3);
    for (const id of drawn) {
      const block = blocksOf(design).find((candidate) => candidate.id === id)!;
      expect(block, id).toBeTruthy();
      expect(markup).toContain(`c-${block.composition}`);
      expect(markup).toContain(`data-importance="${block.importance}"`);
    }
    // The lead and the cover are always among them.
    for (const role of ["cover", "lead"]) expect(drawn.some((id) => blocksOf(design).find((block) => block.id === id)?.role === role), role).toBe(true);
    // And nothing was drawn with an empty heading.
    expect(markup).not.toMatch(/<h[1-6][^>]*><\/h[1-6]>/);
  });

  it("leaves out what this medium should not draw", () => {
    const doc = edition([article("a1", { wordCount: 900 })], [], "a1");
    const { design, content } = build(doc);
    const web = renderDesign(design, { medium: "web", content }).value;
    const print = renderDesign(design, { medium: "print", content: { ...content, medium: "print" } }).value;
    // The footer's page number is print's business.
    const hasPageNumber = (markup: string) => blocksOf(design).some((block) => block.role === "footer" && block.elements.some((el) => el.role === "page-number")) && markup.includes('class="label');
    expect(hasPageNumber(print) || !print.includes("footer")).toBe(true);
    expect(web).not.toContain("page-number");
  });

  it("renders the same design the same way twice", () => {
    const doc = edition([article("a1", { wordCount: 1000 }), article("a2", { wordCount: 400 })], [], "a1");
    const { design, content } = build(doc);
    expect(renderDesign(design, { medium: "web", content }).value).toBe(renderDesign(design, { medium: "web", content }).value);
  });
});

describe("the web edition", () => {
  const doc = edition(
    [
      article("a1", { wordCount: 1600, heroMediaId: "m1", media: [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] }),
      article("a2", { wordCount: 900 }),
      article("a3", { wordCount: 800 }),
      article("a4", { wordCount: 120 }),
    ],
    [media("m1")],
    "a1",
  );

  it("is a page a browser and a screen reader can both use", () => {
    const { design, content } = build(doc);
    const page = renderWebEdition({ design, direction, content, title: "The Review — May 2026", description: "This month", locale: "en" });
    expect(page).toContain("<!doctype html>");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('name="viewport"');
    expect(page).toContain('class="skip"');
    expect(page).toContain("<main id=\"edition\"");
    // One h1 — the masthead — and the edition's own headings below it.
    expect(page.match(/<h1/g)).toHaveLength(1);
    expect(page).toContain("prefers-reduced-motion");
  });

  it("carries the design's own type scale and colours, not a stylesheet's defaults", () => {
    const { design, content } = build(doc);
    const page = renderWebEdition({ design, direction, content, title: "The Review" });
    expect(page).toContain(".t-display-xl{");
    expect(page).toContain("--measure:");
    expect(page).toContain(".s-paper{");
    // The compositions are real rules, not decoration on a class name.
    expect(page).toContain(".c-editorial-split{");
    expect(page).toContain("@media (max-width:900px)");
  });

  it("offers a way into each story, and a contents when there is more than one worth listing", () => {
    const { design, content } = build(doc);
    const page = renderWebEdition({ design, direction, content, title: "The Review" });
    expect(page).toContain('aria-label="In this edition"');
    // The same rule the contents uses: one entry per story, and the cover is the way in rather
    // than an entry in the list.
    const seen = new Set<string>();
    const listed = blocksOf(design)
      .filter((block) => block.articleId && block.role !== "cover" && ["COVER", "LEAD", "MAJOR"].includes(block.importance))
      .filter((block) => (seen.has(block.articleId!) ? false : (seen.add(block.articleId!), true)));
    expect(listed.length).toBeGreaterThanOrEqual(2);
    for (const block of listed.slice(0, 2)) expect(page).toContain(`href="#${block.id}"`);
  });

  it("leaves out the contents when there is nothing to list", () => {
    const small = edition([article("a1", { wordCount: 700 })], [], "a1");
    const { design, content } = build(small);
    const page = renderWebEdition({ design, direction, content, title: "The Review" });
    expect(page).not.toContain('aria-label="In this edition"');
  });
});

describe("resolving what the design points at", () => {
  const doc = edition([article("a1", { wordCount: 900 })], [media("m1")], "a1");
  const ctx = { document: doc, medium: "web" as const, urls: { m1: "https://cdn.test/m1.jpg" } };

  it("says what is missing rather than drawing a blank", () => {
    expect(resolve({ kind: "article", articleId: "gone", part: "headline" }, ctx)).toEqual({ kind: "nothing", why: "that article is not in this edition" });
    expect(resolve({ kind: "media", mediaId: "gone" }, ctx).kind).toBe("nothing");
    expect(resolve({ kind: "article", articleId: "a1", part: "kicker" }, ctx)).toEqual({ kind: "text", text: "News" });
  });

  it("cuts an excerpt at a sentence rather than mid-word", () => {
    const long = article("a2", { standfirst: null, body: [{ id: "x", type: "paragraph", text: `${"A sentence that runs on. ".repeat(20)}` }] });
    const resolved = resolve({ kind: "article", articleId: "a2", part: "excerpt" }, { ...ctx, document: edition([long]) });
    expect(resolved.kind).toBe("text");
    if (resolved.kind === "text") {
      expect(resolved.text.length).toBeLessThanOrEqual(241);
      expect(resolved.text).toMatch(/[.…]$/);
    }
  });
});
