import { describe, expect, it } from "vitest";
import { renderDesign } from "@/server/design/render/html";
import { resolve } from "@/server/design/render/content";
import { composeDesign } from "@/lib/design/compose";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { genomeFromBrand } from "@/lib/design/genome";
import { buildScale } from "@/lib/design/type-scale";
import { composeHeadline } from "@/lib/design/headline";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { blocksOf } from "@/lib/design/model";
import { fixtureArticle, fixtureEdition } from "../helpers/edition-fixture";
import type { EditionDocument } from "@/lib/publication/document";

/**
 * The finish pass: the last five per cent that separates set type from poured text.
 *
 * §83 asks for it and §7 built the engine; until now nothing used it. What is tested is what a
 * reader would actually see: a display line broken where the sense breaks rather than where the box
 * ran out, and French punctuation spaced the way French is spaced.
 */

const direction = resolveDirection(genomeFromBrand(DEFAULT_BRAND_SYSTEM), newIdentity("p1", "The Review"), null);
const scale = buildScale(direction, DEFAULT_BRAND_SYSTEM.personality, "web");

function build(doc: EditionDocument, locale?: string) {
  const signals = readSignals(doc);
  const design = composeDesign({ editionId: "ed1", document: doc, signals, direction, plan: planEdition("ed1", signals, direction) });
  const content = { document: doc, medium: "web" as const, urls: {}, locale };
  return { design, content };
}

describe("a headline, set rather than poured", () => {
  it("breaks where the words let it, and says so in the markup", () => {
    const headline = "Pet food, two LightGBM models and a sales uplift of nearly half a percent per shop";
    const doc = fixtureEdition([fixtureArticle("a1", { headline, wordCount: 1600 })], [], "a1");
    const { design, content } = build(doc);
    const markup = renderDesign(design, { medium: "web", content, typography: { scale, contentWidth: 640 } }).value;

    expect(markup).toContain("<br>");
    // Every word survives the break: a composed headline is the same headline.
    const drawn = /<h\d[^>]*class="headline[^"]*"[^>]*>(.*?)<\/h\d>/s.exec(markup)![1];
    expect(drawn.replace(/<br>/g, " ").replace(/&#39;/g, "'")).toBe(headline);
  });

  it("leaves a headline that already fits exactly as the scale set it", () => {
    const doc = fixtureEdition([fixtureArticle("a1", { headline: "A short headline", wordCount: 1600 })], [], "a1");
    const { design, content } = build(doc);
    const markup = renderDesign(design, { medium: "web", content, typography: { scale, contentWidth: 1100 } }).value;
    const drawn = /<h\d[^>]*class="headline[^"]*"[^>]*>(.*?)<\/h\d>/s.exec(markup)![1];
    expect(drawn).toBe("A short headline");
    expect(markup).not.toMatch(/class="headline[^"]*"[^>]*style="font-size/);
  });

  it("keeps to the number of lines the design allowed, when the words allow it too", () => {
    const doc = fixtureEdition([fixtureArticle("a1", { headline: "A cover line of six words", wordCount: 1600 })], [], "a1");
    const { design, content } = build(doc);
    const cover = blocksOf(design).find((block) => block.role === "cover");
    const limit = cover?.elements.find((element) => element.role === "headline")?.constraints.maxHeadlineLines ?? 2;
    const markup = renderDesign(design, { medium: "web", content, typography: { scale, contentWidth: 900 } }).value;
    const drawn = /<h\d[^>]*class="headline[^"]*"[^>]*>(.*?)<\/h\d>/s.exec(markup)![1];
    expect(drawn.split("<br>").length).toBeLessThanOrEqual(limit);
  });

  it("still sets the best breaks it can find when the words will not fit, and reports it", () => {
    // A cover line of eighteen words at display size in a narrow column cannot be two lines. The
    // engine says so rather than pretending, and the renderer still uses its breaks rather than
    // letting a box choose them.
    const composed = composeHeadline("A cover line of quite a few words indeed that keeps going and going and going", scale.roles["display-xl"], { maxWidth: 420, maxLines: 2 });
    expect(composed.fits).toBe(false);
    expect(composed.problems).toContain("too-many-lines");
    expect(composed.lines.length).toBeGreaterThan(2);
  });

  it("does nothing at all when the renderer has no scale to set it in", () => {
    const doc = fixtureEdition([fixtureArticle("a1", { headline: "A headline with quite a lot of words in it, enough to need breaking somewhere", wordCount: 1600 })], [], "a1");
    const { design, content } = build(doc);
    const markup = renderDesign(design, { medium: "web", content }).value;
    expect(markup).not.toContain("<br>");
  });
});

describe("the language's own spacing", () => {
  it("sets French punctuation the way French is set", () => {
    const doc = fixtureEdition([fixtureArticle("a1", { headline: "Pourquoi ce chiffre ?", standfirst: "Il a dit : « c'est fini ». Vraiment ?" })], [], "a1");
    const content = { document: doc, medium: "web" as const, urls: {}, locale: "fr" };
    const headline = resolve({ kind: "article", articleId: "a1", part: "headline" }, content);
    const standfirst = resolve({ kind: "article", articleId: "a1", part: "standfirst" }, content);

    expect(headline).toEqual({ kind: "text", text: "Pourquoi ce chiffre ?" });
    expect(standfirst.kind === "text" && standfirst.text).toContain("dit :");
    expect(standfirst.kind === "text" && standfirst.text).toContain("« c'est");
    expect(standfirst.kind === "text" && standfirst.text).toContain("».");
  });

  it("leaves English exactly as it was written", () => {
    const doc = fixtureEdition([fixtureArticle("a1", { headline: "Why this figure? A question." })], [], "a1");
    const english = resolve({ kind: "article", articleId: "a1", part: "headline" }, { document: doc, medium: "web", urls: {}, locale: "en" });
    expect(english).toEqual({ kind: "text", text: "Why this figure? A question." });
  });

  it("changes nothing when nobody said what language the edition is in", () => {
    const doc = fixtureEdition([fixtureArticle("a1", { headline: "Pourquoi ce chiffre ?" })], [], "a1");
    const untouched = resolve({ kind: "article", articleId: "a1", part: "headline" }, { document: doc, medium: "web", urls: {} });
    expect(untouched).toEqual({ kind: "text", text: "Pourquoi ce chiffre ?" });
  });
});
