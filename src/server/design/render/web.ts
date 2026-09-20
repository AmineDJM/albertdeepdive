import { html, join, raw } from "@/server/publication/templates/html";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { buildScale } from "@/lib/design/type-scale";
import { blocksOf, type EditionDesign } from "@/lib/design/model";
import type { ResolvedDirection } from "@/lib/design/identity";
import type { PersonalityKey } from "@/lib/brand/typography";
import { designCss } from "./css";
import { renderDesign } from "./html";
import type { ResolveContext } from "./content";
import { resolve } from "./content";

/**
 * A web edition: a premium digital publication, not an email shown in a browser.
 *
 * §14 of the design brief. The page it produces is the design read at web scale — the same
 * hierarchy, the same compositions, the same type scale at a screen's sizes — plus the things only
 * a browser can offer: a table of contents that jumps, an anchor per story so one piece can be
 * shared on its own, and layout that rearranges rather than stacking (§12).
 *
 * The parts the brief insists on and software usually forgets are here on purpose: a skip link, a
 * real heading outline, a `lang` that matches the edition, and no animation for a reader who asked
 * not to have any.
 */

export type WebRenderOptions = {
  design: EditionDesign;
  direction: ResolvedDirection;
  content: ResolveContext;
  brand?: BrandSystem;
  personality?: PersonalityKey;
  /** The language the edition is written in, which is not always the reader's. */
  locale?: string;
  title: string;
  description?: string | null;
  /** Fonts, as the link or @font-face rules this deployment serves. */
  fontCss?: string;
  /** Anything the page needs beyond the design: an audio player, a subscribe form. */
  extraHead?: string;
  extraBody?: string;
};

export function renderWebEdition(options: WebRenderOptions): string {
  const brand = options.brand ?? DEFAULT_BRAND_SYSTEM;
  const tokens = compileBrandSystem(brand);
  const personality = options.personality ?? brand.personality;
  const scale = buildScale(options.direction, personality, "web");
  const grid = options.design.grid;
  const css = designCss({ tokens, scale, grid, direction: options.direction, medium: "web" });
  const content: ResolveContext = { ...options.content, medium: "web", locale: options.locale ?? options.content.locale };
  // 1180px is the edition's own maximum width, less the gutter the page keeps either side.
  const body = renderDesign(options.design, { medium: "web", content, baseLevel: 2, typography: { scale, contentWidth: 1180 - tokens.shape.unit * 4 } });
  const contents = tableOfContents(options.design, content);
  const locale = options.locale ?? "en";

  return html`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title}</title>
${options.description ? html`<meta name="description" content="${options.description}">` : ""}
<meta name="generator" content="Briefly editorial design engine">
<meta property="og:title" content="${options.title}">
${options.description ? html`<meta property="og:description" content="${options.description}">` : ""}
${options.fontCss ? html`<style>${raw(options.fontCss)}</style>` : ""}
<style>${raw(css)}</style>
<style>${raw(WEB_CHROME)}</style>
${options.extraHead ? raw(options.extraHead) : ""}
</head>
<body class="s-paper">
<a class="skip" href="#edition">Skip to the edition</a>
<header class="masthead-bar">
  <h1 class="t-headline">${options.title}</h1>
  ${contents}
</header>
<main id="edition">
${body}
</main>
${options.extraBody ? raw(options.extraBody) : ""}
</body>
</html>`.value;
}

/**
 * The contents, built from the design rather than from the document.
 *
 * It lists what the reader will actually meet, in the order the design put it — which is not always
 * the order the flatplan had, and is never the order the stories arrived in.
 */
function tableOfContents(design: EditionDesign, content: ResolveContext) {
  const seen = new Set<string>();
  const entries = blocksOf(design)
    // The cover is the way in, not an entry in the list — and a story listed twice because it has
    // both a cover and an opener is a contents that has lost count.
    .filter((block) => block.articleId && block.role !== "cover" && ["COVER", "LEAD", "MAJOR"].includes(block.importance))
    .filter((block) => {
      if (seen.has(block.articleId!)) return false;
      seen.add(block.articleId!);
      return true;
    })
    .map((block) => {
      const headline = block.elements.find((element) => element.role === "headline");
      if (!headline) return null;
      const resolved = resolve(headline.content, content);
      return resolved.kind === "text" ? { id: block.id, text: resolved.text } : null;
    })
    .filter((entry): entry is { id: string; text: string } => Boolean(entry));
  if (entries.length < 2) return html``;
  return html`<nav class="contents" aria-label="In this edition"><ul>${join(entries.map((entry) => html`<li><a href="#${entry.id}">${entry.text}</a></li>`))}</ul></nav>`;
}

/**
 * The page's own furniture, which is not the edition's design.
 *
 * Kept apart from the design's stylesheet on purpose: a skip link and a sticky masthead belong to
 * the web *page*, and mixing them into the design's CSS would put them in the PDF.
 */
const WEB_CHROME = `
.skip{position:absolute;left:-9999px;top:0;background:var(--ink);color:var(--paper);padding:8px 16px;z-index:10;}
.skip:focus{left:8px;top:8px;}
.masthead-bar{position:sticky;top:0;z-index:5;background:color-mix(in srgb, var(--paper) 92%, transparent);backdrop-filter:blur(8px);border-bottom:var(--border) solid var(--rule);padding:10px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between;}
.masthead-bar h1{margin:0;}
.contents ul{list-style:none;display:flex;flex-wrap:wrap;gap:14px;margin:0;padding:0;}
.contents a{color:var(--subdued);text-decoration:none;border-bottom:1px solid transparent;}
.contents a:hover,.contents a:focus{color:var(--ink);border-bottom-color:var(--highlight);}
article[data-block]{scroll-margin-top:72px;}
:focus-visible{outline:2px solid var(--highlight);outline-offset:2px;}
@media (prefers-reduced-motion: reduce){*{animation:none !important;transition:none !important;scroll-behavior:auto !important;}}
@media print{.masthead-bar,.skip{display:none;}}
`.trim();

/** Every block gets an anchor, so one story can be shared without the rest of the edition. */
export function anchorsOf(design: EditionDesign): string[] {
  return blocksOf(design)
    .filter((block) => block.articleId)
    .map((block) => block.id);
}
