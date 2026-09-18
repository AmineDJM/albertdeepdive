import type { ArticleBlock, DocumentArticle, DocumentMedia, DocumentPage } from "@/lib/publication/document";
import { PAGE_TEMPLATES } from "@/lib/constants";
import { fitFactor } from "@/lib/publication/layout-rules";
import { figure, flowBlocks, renderBlocks } from "./blocks";
import type { TemplateContext } from "./context";
import { EMPTY, html, join, when, type Html } from "./html";

/** Shared page chrome and building blocks used by the templates. */

export const CONTENT_WIDTH_MM = 182; // 210 - 2 × 14
export const CONTENT_HEIGHT_MM = 265; // 297 - 17 - 15
export const GUTTER_MM = 4.5;

/** Width in mm of `span` grid columns out of 12. */
export function colWidth(span: number, totalWidth = CONTENT_WIDTH_MM): number {
  const col = (totalWidth - 11 * GUTTER_MM) / 12;
  return col * span + GUTTER_MM * (span - 1);
}

export type TemplateOutput = { body: Html; className?: string; chrome?: boolean; sectionColour?: string | null };

export function sectionColour(ctx: TemplateContext, page: DocumentPage): string {
  return ctx.sectionOfPage(page)?.colour ?? "#10203A";
}

export function kickerFor(article: DocumentArticle | undefined, ctx: TemplateContext, page: DocumentPage): string {
  if (article?.kicker) return article.kicker;
  const section = ctx.section(article?.sectionId) ?? ctx.sectionOfPage(page);
  return section?.kicker ?? section?.name ?? "";
}

export function headlineClass(article: DocumentArticle): string {
  return /^["“«]/.test(article.headline.trim()) ? "quote" : "";
}

/** Wraps template output with running header, section bar and folio. */
export function pageShell(page: DocumentPage, ctx: TemplateContext, output: TemplateOutput): Html {
  const odd = page.number % 2 === 1;
  const section = ctx.sectionOfPage(page);
  const colour = output.sectionColour ?? section?.colour ?? "#10203A";
  const chrome = output.chrome ?? true;
  const label = section?.name ?? "";
  return html`<section class="page ${odd ? "odd" : "even"} ${output.className ?? ""}" data-page="${page.id}" data-number="${page.number}" data-template="${page.template}" style="--section:${colour}">
${when(chrome, () => html`<div class="section-bar"></div>
<div class="running"><span class="left"><span class="mark"></span>${ctx.doc.meta.masthead.title} · ${ctx.doc.meta.issueLabel}${label ? html` · ${label}` : EMPTY}</span><span class="right">${ctx.doc.meta.label} · ${page.number}</span></div>
<div class="folio">${page.number}</div>`)}
<div class="sheet">${output.body}</div>
<div class="preview-flag" data-preview-flag></div>
</section>`;
}

export function articleHeader(
  article: DocumentArticle,
  ctx: TemplateContext,
  page: DocumentPage,
  options: { size?: "xl" | "lg" | "md" | "sm" | "xs"; standfirst?: "full" | "sm" | "none"; meta?: boolean; rule?: boolean; kicker?: string; extra?: Html } = {},
): Html {
  const size = options.size ?? "lg";
  const standfirstMode = options.standfirst ?? "full";
  const meta = options.meta ?? true;
  const metaBits: Html[] = [];
  if (meta && article.campuses.length) metaBits.push(html`<span><b>${article.campuses.join(" · ")}</b></span>`);
  if (meta && article.eventDateText) metaBits.push(html`<span>${article.eventDateText}</span>`);
  return html`<div class="article-head ${options.rule ? "rule" : ""}">
<div class="kicker"><span class="dot"></span>${options.kicker ?? kickerFor(article, ctx, page)}</div>
<h1 class="headline ${size} ${headlineClass(article)}">${article.headline || article.storyTitle || ""}</h1>
${when(article.standfirst && standfirstMode !== "none", () => html`<p class="standfirst ${standfirstMode === "sm" ? "sm" : ""}">${article.standfirst}</p>`)}
${when(metaBits.length, () => html`<div class="byline-top">${join(metaBits)}</div>`)}
${options.extra ?? EMPTY}
</div>`;
}

export type FlowOptions = {
  cols: 1 | 2 | 3 | 4;
  className?: string;
  /** Body block ids lifted elsewhere on the page (sidebars); ignored when a slice is present. */
  exclude?: Set<string>;
  dropCap?: boolean;
  grow?: boolean;
};

/**
 * The flowing region of a page for one article: renders either the page slice (after layout) or the
 * whole body. The element carries data attributes the pagination pass reads.
 */
export function flowRegion(page: DocumentPage, article: DocumentArticle, ctx: TemplateContext, options: FlowOptions): Html {
  const slice = page.slices?.find((s) => s.articleId === article.id);
  const blocks = flowBlocks(article, slice, options.exclude);
  const level = slice?.fit ?? page.textScale ?? 0;
  const fit = fitFactor(level);
  const continuation = ctx.continuationOf(page.id);
  const continues = !!continuation?.slices?.some((s) => s.articleId === article.id);
  const foot = continues
    ? html`<span class="jump">Continued on page ${continuation!.number} →</span>`
    : article.byline
      ? html`<span class="byline">Article : ${article.byline}</span>`
      : EMPTY;
  return html`<div class="flow cols-${options.cols} ${options.grow === false ? "" : "grow"} ${options.className ?? ""}" data-flow="${page.id}:${article.id}" data-page="${page.id}" data-article="${article.id}" data-cols="${options.cols}" data-fit="${level}" style="--fit:${fit}">${renderBlocks(blocks, ctx.resolver, { dropCap: options.dropCap })}</div><div class="flow-foot">${foot}</div>`;
}

export { fitFactor, imageScaleFactor, FIT_LEVEL_RANGE, IMAGE_LEVEL_RANGE } from "@/lib/publication/layout-rules";

export function placeholder(page: DocumentPage, message: string): Html {
  const template = PAGE_TEMPLATES.find((t) => t.code === page.template);
  return html`<div class="placeholder"><div><b>${template?.name ?? page.template}</b>${message}</div></div>`;
}

export function heroMedia(article: DocumentArticle | undefined, ctx: TemplateContext, page: DocumentPage): DocumentMedia | undefined {
  const fromPage = page.mediaIds.map((id) => ctx.media(id)).find((m) => m && m.rightsStatus !== "RED");
  if (fromPage) return fromPage;
  if (!article) return undefined;
  const hero = ctx.media(article.heroMediaId);
  if (hero && hero.rightsStatus !== "RED") return hero;
  return article.media.map((m) => ctx.media(m.mediaId)).find((m) => m && m.rightsStatus !== "RED" && m.kind === "photo");
}

/** Media of an article with a given role, excluding RED-rights assets and already used ids. */
export function mediaByRole(article: DocumentArticle, ctx: TemplateContext, roles: string[], used: Set<string> = new Set()): DocumentMedia[] {
  return article.media
    .filter((m) => roles.includes(m.role) && !used.has(m.mediaId))
    .map((m) => ctx.media(m.mediaId))
    .filter((m): m is DocumentMedia => !!m && m.rightsStatus !== "RED");
}

export function galleryMedia(article: DocumentArticle, ctx: TemplateContext, used: Set<string>, kinds?: string[]): DocumentMedia[] {
  return article.media
    .filter((m) => !used.has(m.mediaId) && m.role !== "cover")
    .map((m) => ctx.media(m.mediaId))
    .filter((m): m is DocumentMedia => !!m && m.rightsStatus !== "RED" && (!kinds || kinds.includes(m.kind)));
}

/**
 * The body block a lifted pull quote came from, so the flow can leave it out.
 *
 * `article.pullQuotes` merges quotes gathered from the submissions with the `pullquote` blocks in
 * the copy. When a template lifts the first one into the margin and the flow still sets the block
 * it came from, the same sentence prints twice on the same spread — which is exactly what the last
 * issue did. Templates that lift a quote pass this id to `flowRegion`'s `exclude`.
 */
export function pullQuoteBlockId(article: DocumentArticle): string | undefined {
  const quote = article.pullQuotes[0];
  if (!quote) return undefined;
  const key = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = key(quote.text);
  return article.body.find((b) => b.type === "pullquote" && key(b.text) === wanted)?.id;
}

export function pullQuoteSide(article: DocumentArticle): Html {
  const quote = article.pullQuotes[0];
  if (!quote) return EMPTY;
  return html`<div class="pull-side">“${quote.text.replace(/^["“]|["”]$/g, "")}”${when(quote.attribution, () => html`<span class="attr">${quote.attribution}</span>`)}</div>`;
}

export function sideBox(block: Extract<ArticleBlock, { type: "box" }> | undefined): Html {
  if (!block) return EMPTY;
  return html`<div class="side-box">${when(block.title, () => html`<div class="box-title">${block.title}</div>`)}${when(block.text, () => html`<p>${block.text}</p>`)}${when(block.items?.length, () => html`<ul>${join((block.items ?? []).map((i) => html`<li>${i}</li>`))}</ul>`)}</div>`;
}

export function mastheadSmall(ctx: TemplateContext): Html {
  const [first, ...rest] = ctx.doc.meta.masthead.title.split(/\s+/);
  return html`<div class="masthead-small"><span class="logo-mark"></span><span class="word outline">${first}</span><span class="word">${rest.join(" ")}</span></div>`;
}

export function figureFor(media: DocumentMedia | undefined, ctx: TemplateContext, widthMm: number, opts: Parameters<typeof figure>[2] = { widthMm }): Html {
  if (media) ctx.used.add(media.id);
  return figure(media, ctx.resolver, { ...opts, widthMm, scale: ctx.imageScale });
}

/** Visual media of an article not yet shown on an earlier page (photos, charts, diagrams, screenshots; never logos). */
export function leftoverMedia(article: DocumentArticle, ctx: TemplateContext, max = 3): DocumentMedia[] {
  return article.media
    .filter((m) => !ctx.used.has(m.mediaId) && m.role !== "cover")
    .map((m) => ctx.media(m.mediaId))
    .filter((m): m is DocumentMedia => !!m && m.rightsStatus !== "RED" && m.kind !== "logo")
    .slice(0, max);
}

/** Page range covered by a section (for cover page references such as "Pages 6–15"). */
export function sectionPageRange(ctx: TemplateContext, sectionId: string | null | undefined): string | null {
  if (!sectionId) return null;
  const numbers = ctx.doc.pages.filter((p) => p.sectionId === sectionId).map((p) => p.number);
  if (!numbers.length) return null;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return min === max ? `Page ${min}` : `Pages ${min}–${max}`;
}
