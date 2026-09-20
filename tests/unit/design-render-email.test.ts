import { describe, expect, it } from "vitest";
import { emailPalette, emailType, renderEmailEdition, type EmailRenderOptions } from "@/server/design/render/email";
import { composeDesign } from "@/lib/design/compose";
import { planEdition } from "@/lib/design/plan";
import { readSignals } from "@/lib/design/signals";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { genomeFromBrand } from "@/lib/design/genome";
import { buildScale } from "@/lib/design/type-scale";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { blocksOf } from "@/lib/design/model";
import { fixtureArticle, fixtureEdition, fixtureMedia } from "../helpers/edition-fixture";
import type { EditionDocument } from "@/lib/publication/document";

/**
 * The design, as an email.
 *
 * Email is the medium where being nearly right is being wrong: a stylesheet that does not load, a
 * picture the reader has blocked, a message Gmail cut in half. So what is tested here is not that
 * markup came out — it is the things that actually break an inbox, each of which has ended a real
 * newsletter: unescaped contributor text, an image with no alt, a button Outlook will not draw, a
 * message over the clipping limit, and a design that forgot to say how to unsubscribe.
 */

const genome = genomeFromBrand(DEFAULT_BRAND_SYSTEM);
const direction = resolveDirection(genome, newIdentity("p1", "The Review"), null);

function build(doc: EditionDocument, extra: Partial<EmailRenderOptions> = {}) {
  const signals = readSignals(doc);
  const plan = planEdition("ed1", signals, direction);
  const design = composeDesign({ editionId: "ed1", document: doc, signals, direction, plan });
  return renderEmailEdition({
    design,
    direction,
    content: { document: doc, medium: "email", urls: Object.fromEntries(doc.media.map((item) => [item.id, `https://cdn.test/${item.id}.jpg`])) },
    organizationName: "Acme",
    webUrl: "https://example.test/r/may-2026",
    unsubscribeUrl: "https://example.test/s/unsubscribe/abc",
    ...extra,
  });
}

const withStories = (count = 4) =>
  fixtureEdition(
    Array.from({ length: count }, (_, index) =>
      fixtureArticle(`a${index + 1}`, { wordCount: index === 0 ? 1600 : 500, heroMediaId: index === 0 ? "m1" : null, media: index === 0 ? [{ mediaId: "m1", role: "HERO", sortOrder: 0 }] : [] }),
    ),
    [fixtureMedia("m1")],
    "a1",
  );

describe("an edition as an email", () => {
  it("is built from tables, not from a layout no client supports", () => {
    const { html } = build(withStories());
    // A style attribute that ends early takes the rest of the tag with it, and a font stack is
    // full of quotes: the stack has to be written with the other kind.
    expect(html).not.toContain('font-family:"');
    expect(html).toContain("font-family:'");
    expect(html).toContain('role="presentation"');
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
    // Two class attributes on one tag is one class attribute the client ignores.
    for (const tag of [...html.matchAll(/<[a-z][^>]*>/g)].map((match) => match[0])) {
      expect((tag.match(/ class=/g) ?? []).length, tag).toBeLessThanOrEqual(1);
    }
    expect(html).toContain("mso-table-lspace:0pt");
    expect(html).toContain('<table role="presentation" width="600"');
  });

  it("cannot be broken by what a contributor wrote", () => {
    const nasty = `</td></table><script>alert("x")</script> & "quotes"`;
    const doc = fixtureEdition([fixtureArticle("a1", { headline: nasty, wordCount: 1200 })], [], "a1");
    const { html, subject } = build(doc);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(subject).toContain("<script>");
  });

  it("sends the issue's openings and a way in, not its body copy", () => {
    const doc = fixtureEdition(
      [fixtureArticle("a1", { wordCount: 1600, body: [{ id: "p1", type: "paragraph", text: "A paragraph that belongs to the web edition and not to the inbox." }] })],
      [],
      "a1",
    );
    const { html } = build(doc);
    expect(html).not.toContain("belongs to the web edition");
    expect(html).toContain("A standfirst that says what happened.");
    expect(html).toContain("https://example.test/r/may-2026");
  });

  it("gives a story with no standfirst a line of its own anyway", () => {
    const doc = fixtureEdition(
      [fixtureArticle("a1", { wordCount: 1600, standfirst: null, body: [{ id: "p1", type: "paragraph", text: "The opening sentence carries it. And then a second one." }] })],
      [],
      "a1",
    );
    const { html } = build(doc);
    expect(html).toContain("The opening sentence carries it.");
  });

  it("still reads when the reader has blocked the pictures", () => {
    const { html } = build(withStories());
    const images = [...html.matchAll(/<img [^>]*>/g)].map((match) => match[0]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).toMatch(/alt="/);
      expect(image).toContain("border:0");
    }
    // The photograph's own words are what a blocked image falls back to.
    expect(html).toContain('alt="What is in the picture"');
  });

  it("only ever points at absolute image URLs", () => {
    const { html } = build(withStories());
    for (const source of [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((match) => match[1])) {
      expect(source.startsWith("https://"), `${source} would not load in an inbox`).toBe(true);
    }
  });

  it("draws a button Outlook can draw", () => {
    const { html } = build(withStories());
    expect(html).toContain("v:roundrect");
    expect(html).toContain("<!--[if !mso]><!-- -->");
    expect(html).toContain("<w:anchorlock/>");
  });

  it("carries a preheader, and hides it", () => {
    const { html, preheader } = build(withStories());
    expect(preheader.length).toBeGreaterThan(5);
    const hidden = html.slice(html.indexOf("<body"), html.indexOf("<table"));
    expect(hidden).toContain(preheader);
    expect(hidden).toContain("mso-hide:all");
  });

  it("has a dark mode made of the publication's own dark surface, not an inversion", () => {
    const tokens = compileBrandSystem(DEFAULT_BRAND_SYSTEM);
    const palette = emailPalette(tokens);
    const { html } = build(withStories());
    expect(html).toContain("@media (prefers-color-scheme:dark)");
    expect(html).toContain(palette.darkPaper);
    expect(palette.darkPaper).toBe(tokens.surfaces.ink.background);
    expect(html).toContain('name="color-scheme" content="light dark"');
    // And it keeps the hierarchy it was given: a standfirst stays quieter than a headline, and a
    // kicker stays the accent, instead of every line collapsing to one colour.
    expect(html).toContain(`.card .sub{color:${palette.darkSubdued}`);
    expect(html).toContain(`.card .hl,.card a{color:${palette.darkHighlight}`);
    expect(html).toMatch(new RegExp(`<p class="sub" style="[^"]*color:${palette.subdued}`));
    expect(html).toMatch(new RegExp(`<p class="hl" style="[^"]*color:${palette.highlight}`));
  });

  it("drops the tail on purpose rather than being cut in half by Gmail", () => {
    const doc = fixtureEdition(
      Array.from({ length: 14 }, (_, index) => fixtureArticle(`a${index + 1}`, { wordCount: index === 0 ? 1400 : 400 })),
      [],
      "a1",
    );
    const full = build(doc);
    const trimmed = build(doc, { maxBytes: Math.round(full.bytes * 0.6) });

    expect(full.dropped).toEqual([]);
    expect(trimmed.dropped.length).toBeGreaterThan(0);
    expect(trimmed.bytes).toBeLessThanOrEqual(Math.round(full.bytes * 0.6));
    // And it says so, rather than the issue simply stopping.
    expect(trimmed.html).toContain(`and ${trimmed.dropped.length} more in this edition`);
    expect(trimmed.text).toContain(`and ${trimmed.dropped.length} more in this edition`);
  });

  it("always says how to stop receiving it", () => {
    const { html, text } = build(withStories());
    expect(html).toContain("https://example.test/s/unsubscribe/abc");
    expect(html).toContain("Unsubscribe");
    expect(text).toContain("Unsubscribe: https://example.test/s/unsubscribe/abc");
  });

  it("removes Briefly's mark for the plans that paid for that", () => {
    expect(build(withStories()).html).toContain("Published with Briefly");
    expect(build(withStories(), { showBrieflyMark: false }).html).not.toContain("Published with Briefly");
  });

  it("is written in the language the publication publishes in", () => {
    const { html, text } = build(withStories(), { locale: "fr", greetingName: "Camille" });
    expect(html).toContain("Bonjour Camille,");
    expect(html).toContain("Lire toute l’édition");
    expect(text).toContain("Se désabonner:");
    expect(html).not.toContain("Read the whole edition");
  });

  it("does not draw the design's print furniture a second time", () => {
    const doc = withStories();
    const signals = readSignals(doc);
    const plan = planEdition("ed1", signals, direction);
    const design = composeDesign({ editionId: "ed1", document: doc, signals, direction, plan });
    // The design has a masthead and a colophon; the email has its own, so the design's are skipped.
    expect(blocksOf(design).some((block) => block.role === "masthead")).toBe(true);
    const { html } = build(doc);
    expect([...html.matchAll(/The Review/g)].length).toBeLessThanOrEqual(3);
  });

  it("keeps type at inbox sizes, whatever the publication's display scale says", () => {
    const scale = buildScale(direction, DEFAULT_BRAND_SYSTEM.personality, "email");
    const palette = emailPalette(compileBrandSystem(DEFAULT_BRAND_SYSTEM));
    const sizes = (["display-xl", "display-l", "headline", "body", "label"] as const).map((role) => Number(/font-size:(\d+)px/.exec(emailType(scale, role, palette))![1]));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(34);
    // And never so small it cannot be read on a phone.
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
    const { html } = build(withStories());
    for (const size of [...html.matchAll(/font-size:(\d+)px/g)].map((match) => Number(match[1]))) {
      expect(size).toBeLessThanOrEqual(34);
      expect(size).toBeGreaterThanOrEqual(11);
    }
  });

  it("gives the plain-text alternative the same edition", () => {
    const { text } = build(withStories());
    expect(text).toContain("The Review — Issue N°1, May 2026");
    expect(text).toContain("Headline a1");
    expect(text).toContain("Read the whole edition: https://example.test/r/may-2026");
    expect(text).not.toContain("<");
  });
});
