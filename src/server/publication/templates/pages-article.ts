import type { DocumentArticle, DocumentMedia, DocumentPage } from "@/lib/publication/document";
import { firstBlockOfType } from "./blocks";
import type { TemplateContext } from "./context";
import { EMPTY, html, join, when, type Html } from "./html";
import {
  CONTENT_WIDTH_MM,
  articleHeader,
  colWidth,
  figureFor,
  flowRegion,
  galleryMedia,
  heroMedia,
  kickerFor,
  headlineClass,
  leftoverMedia,
  mediaByRole,
  placeholder,
  pullQuoteSide,
  sideBox,
  type TemplateOutput,
} from "./parts";

/** Article family: hero, two/three columns, interview, profile, news grid, shorts, event, photo story, continuation. */

function noArticle(page: DocumentPage): TemplateOutput {
  return { body: placeholder(page, "No approved article is placed on this page yet.") };
}

export function articleHero(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return noArticle(page);
  const hero = heroMedia(article, ctx, page);
  const body = html`${figureFor(hero, ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 55, maxMm: 82, className: "hero-figure" })}
${articleHeader(article, ctx, page, { size: "lg" })}
${flowRegion(page, article, ctx, { cols: 2, dropCap: true })}`;
  return { body };
}

export function articleTwoColumn(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return noArticle(page);
  const hero = heroMedia(article, ctx, page);
  const box = firstBlockOfType(article, "box");
  const exclude = new Set<string>(box ? [box.id] : []);
  const aside = article.pullQuotes.length ? pullQuoteSide(article) : box ? sideBox(box) : EMPTY;
  const hasAside = aside !== EMPTY;
  const heroWidth = hasAside ? colWidth(7) : CONTENT_WIDTH_MM;
  const band = hero
    ? hasAside
      ? html`<div class="grid" style="margin-bottom:4mm;align-items:end"><div class="span-7">${figureFor(hero, ctx, heroWidth, { widthMm: heroWidth, minMm: 42, maxMm: 66 })}</div><div class="span-5">${aside}</div></div>`
      : figureFor(hero, ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 40, maxMm: 60, className: "hero-figure" })
    : hasAside
      ? html`<div style="margin-bottom:4mm">${aside}</div>`
      : EMPTY;
  const body = html`${articleHeader(article, ctx, page, { size: "lg", rule: true })}
${band}
${flowRegion(page, article, ctx, { cols: 2, dropCap: true, exclude: hasAside && box && !article.pullQuotes.length ? exclude : new Set() })}`;
  return { body };
}

export function articleThreeColumn(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return noArticle(page);
  const hero = heroMedia(article, ctx, page);
  const body = html`${articleHeader(article, ctx, page, { size: "lg", rule: true })}
${figureFor(hero, ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 40, maxMm: 58, className: "hero-figure" })}
${flowRegion(page, article, ctx, { cols: 3, className: "compact", dropCap: true })}`;
  return { body };
}

export function interview(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return noArticle(page);
  const portrait = mediaByRole(article, ctx, ["portrait"])[0] ?? heroMedia(article, ctx, page);
  const box = firstBlockOfType(article, "box");
  const exclude = new Set<string>(box ? [box.id] : []);
  const sideWidth = colWidth(4);
  const body = html`<div class="grid grow" style="min-height:0">
  <div class="span-4 side">
    ${figureFor(portrait, ctx, sideWidth, { widthMm: sideWidth, minMm: 50, maxMm: 82, position: "50% 20%" })}
    ${pullQuoteSide(article)}
    ${sideBox(box)}
  </div>
  <div class="span-8 fill">
    ${articleHeader(article, ctx, page, { size: "md" })}
    ${flowRegion(page, article, ctx, { cols: 2, className: "compact", exclude })}
  </div>
</div>`;
  return { body, className: "interview" };
}

export function profile(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return noArticle(page);
  const portrait = mediaByRole(article, ctx, ["portrait"])[0] ?? heroMedia(article, ctx, page);
  const width = colWidth(5);
  const aspect = portrait?.aspectRatio && portrait.aspectRatio > 0 ? portrait.aspectRatio : 1;
  const height = Math.min(96, Math.max(62, width / aspect));
  const secondary = galleryMedia(article, ctx, new Set(portrait ? [portrait.id] : []), ["logo", "photo", "chart", "diagram", "screenshot"])[0];
  const body = html`<div class="head-band" style="grid-template-columns:${width.toFixed(1)}mm 1fr">
  <div>${figureFor(portrait, ctx, width, { widthMm: width, heightMm: height, position: "50% 15%" })}</div>
  <div>${articleHeader(article, ctx, page, { size: "md" })}${pullQuoteSide(article)}${when(secondary && !article.pullQuotes.length, () => html`<div style="max-width:60mm;margin-top:2mm">${figureFor(secondary, ctx, 60, { widthMm: 60, minMm: 24, maxMm: 40 })}</div>`)}</div>
</div>
${flowRegion(page, article, ctx, { cols: 2, dropCap: true })}`;
  return { body, className: "profile" };
}

function newsItem(page: DocumentPage, article: DocumentArticle, ctx: TemplateContext, width: number): Html {
  const media = heroMedia(article, ctx, page);
  return html`<div class="news-item">
<div class="kicker"><span class="dot"></span>${kickerFor(article, ctx, page)}</div>
<h2 class="headline xs ${headlineClass(article)}">${article.headline || article.storyTitle || ""}</h2>
${when(article.standfirst, () => html`<p class="standfirst">${article.standfirst}</p>`)}
${figureFor(media, ctx, width, { widthMm: width, heightMm: 34, caption: true })}
${flowRegion(page, article, ctx, { cols: 1, className: "compact" })}
</div>`;
}

export function newsGrid(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const articles = ctx.articlesOf(page).slice(0, 4);
  if (!articles.length) return noArticle(page);
  if (articles.length === 1) {
    const article = articles[0];
    const hero = heroMedia(article, ctx, page);
    const body = html`<div class="digest-head">${articleHeader(article, ctx, page, { size: "md" })}</div>
${figureFor(hero, ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 30, maxMm: 60, className: "hero-figure" })}
${flowRegion(page, article, ctx, { cols: 3, className: "compact" })}`;
    return { body, className: "digest" };
  }
  const width = colWidth(12 / articles.length);
  const body = html`<div class="news-grid n-${articles.length}">${join(articles.map((a) => newsItem(page, a, ctx, width)))}</div>`;
  return { body, className: "news" };
}

export function shorts(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return noArticle(page);
  const body = html`${articleHeader(article, ctx, page, { size: "lg", rule: true })}
${flowRegion(page, article, ctx, { cols: 2, className: "shorts" })}`;
  return { body, className: "shorts-page" };
}

export function event(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return noArticle(page);
  const hero = heroMedia(article, ctx, page);
  const ev = article.event ?? null;
  const when_ = ev?.dateText ?? article.eventDateText ?? null;
  const metaBits: Html[] = [];
  if (ev?.location) metaBits.push(html`<div class="meta"><b>Where</b>${ev.location}</div>`);
  if (ev?.organiser) metaBits.push(html`<div class="meta"><b>Organised by</b>${ev.organiser}</div>`);
  if (ev?.signupUrl) metaBits.push(html`<div class="meta"><b>Sign up</b>${ev.signupUrl}</div>`);
  const box =
    when_ || metaBits.length
      ? html`<div class="event-box"><div><b class="label" style="color:var(--blue);display:block;margin-bottom:1.6mm">${ev?.isUpcoming === false ? "It happened" : "Save the date"}</b><div class="when">${when_ ?? ev?.title ?? ""}</div></div><div>${join(metaBits)}</div></div>`
      : EMPTY;
  const body = html`${articleHeader(article, ctx, page, { size: "lg", meta: false })}
${box}
${figureFor(hero, ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 50, maxMm: 76, className: "hero-figure" })}
${flowRegion(page, article, ctx, { cols: 2, className: "shorts event-flow" })}`;
  return { body, className: "event-page" };
}

export function photoStory(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return noArticle(page);
  const hero = heroMedia(article, ctx, page);
  const used = new Set<string>(hero ? [hero.id] : []);
  const gallery = galleryMedia(article, ctx, used, ["photo"]).slice(0, 3);
  const half = colWidth(6);
  const grid: Html[] = [];
  if (hero) grid.push(figureFor(hero, ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 60, maxMm: 90, className: "wide" }));
  for (const m of gallery) grid.push(figureFor(m, ctx, half, { widthMm: half, heightMm: 52 }));
  const body = html`${articleHeader(article, ctx, page, { size: "md", standfirst: "sm" })}
<div class="photo-grid">${join(grid)}</div>
${flowRegion(page, article, ctx, { cols: 2, className: "compact" })}`;
  return { body, className: "photo-story" };
}

/** Pages inserted by the pagination pass: "Continued from page N" + the moved blocks. */
export function continuation(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const slices = page.slices ?? [];
  const from = page.continuationOf;
  if (!slices.length) return { body: placeholder(page, "Nothing to continue here."), className: "continuation" };
  if (slices.length === 1) {
    const article = ctx.article(slices[0].articleId);
    if (!article) return { body: placeholder(page, "Missing article."), className: "continuation" };
    const leftovers = leftoverMedia(article, ctx, 3);
    const stripWidth = leftovers.length ? colWidth(12 / leftovers.length) : 0;
    const body = html`<div class="article-head rule">
<div class="blk continued-from">Continued from page ${from ?? "?"}</div>
<div class="kicker"><span class="dot"></span>${kickerFor(article, ctx, page)}</div>
<h1 class="headline sm ${headlineClass(article)}">${article.headline || article.storyTitle || ""}</h1>
</div>
${flowRegion(page, article, ctx, { cols: 3, className: "auto", grow: false })}
${when(leftovers.length, () => html`<div class="leftover-strip" style="grid-template-columns:repeat(${leftovers.length},1fr)">${join(leftovers.map((m) => figureFor(m, ctx, stripWidth, { widthMm: stripWidth, heightMm: leftovers.length === 1 ? 70 : 52 })))}</div>`)}`;
    return { body, className: "continuation" };
  }
  const width = colWidth(12 / Math.min(4, slices.length));
  const items = slices.slice(0, 4).map((slice) => {
    const article = ctx.article(slice.articleId);
    if (!article) return EMPTY;
    return html`<div class="news-item" style="width:${width.toFixed(1)}mm">
<div class="blk continued-from">Continued from page ${from ?? "?"}</div>
<div class="kicker"><span class="dot"></span>${kickerFor(article, ctx, page)}</div>
<h2 class="headline xs ${headlineClass(article)}">${article.headline || article.storyTitle || ""}</h2>
${flowRegion(page, article, ctx, { cols: 1, className: "compact" })}
</div>`;
  });
  return { body: html`<div class="news-grid n-${Math.min(4, slices.length)}">${join(items)}</div>`, className: "continuation" };
}

export function firstPhoto(article: DocumentArticle, ctx: TemplateContext): DocumentMedia | undefined {
  return article.media.map((m) => ctx.media(m.mediaId)).find((m) => m && m.kind === "photo" && m.rightsStatus !== "RED");
}
