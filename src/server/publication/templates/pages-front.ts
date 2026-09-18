import type { DocumentPage } from "@/lib/publication/document";
import { formatIsoDate } from "@/lib/publication/text";
import { captionHtml, creditLine, firstBlockOfType } from "./blocks";
import type { TemplateContext } from "./context";
import { EMPTY, html, join, when, type Html } from "./html";
import {
  CONTENT_WIDTH_MM,
  articleHeader,
  colWidth,
  figureFor,
  flowRegion,
  heroMedia,
  mastheadSmall,
  placeholder,
  sectionPageRange,
  type TemplateOutput,
} from "./parts";

/** Cover, contents, section opener, quote page and back page. */

function mastheadBig(ctx: TemplateContext): Html {
  const [first, ...rest] = ctx.doc.meta.masthead.title.split(/\s+/);
  return html`<div class="masthead"><div class="logo-mark"></div><div><span class="word outline big">${first}</span><span class="word big2">${rest.join(" ")}</span></div></div>
<div class="masthead-line"><span>${ctx.doc.meta.issueLabel} · ${ctx.monthLabel}</span>${when(ctx.doc.meta.masthead.tagline, () => html`<span class="tagline">${ctx.doc.meta.masthead.tagline}</span>`)}</div>`;
}

function teaserList(ctx: TemplateContext): Html {
  const teasers = ctx.doc.meta.cover.teasers;
  if (!teasers.length) return EMPTY;
  return html`<div class="teasers"><span class="label">Also in this issue</span>${join(
    teasers.map((t) => html`<div class="teaser"><span>${t.line}</span><span class="pg">${t.page ? `p. ${t.page}` : ""}</span></div>`),
  )}</div>`;
}

function coverLead(ctx: TemplateContext, page: DocumentPage): Html {
  const cover = ctx.doc.meta.cover;
  const article = cover.articleId ? ctx.article(cover.articleId) : undefined;
  const section = ctx.section(article?.sectionId);
  const range = sectionPageRange(ctx, article?.sectionId) ?? (article ? `Page ${ctx.pageOfArticle(article.id) ?? ""}` : null);
  const headline = cover.headline ?? article?.headline ?? ctx.doc.meta.title;
  const kicker = section?.name ?? ctx.sectionOfPage(page)?.name ?? "";
  return html`<div class="cover-lead">${when(kicker, () => html`<div class="kicker"><span class="dot"></span>${kicker}</div>`)}<h1 class="headline">${headline}</h1>${when(cover.standfirst, () => html`<p class="standfirst">${cover.standfirst}</p>`)}${when(range, () => html`<div class="pageref">${range}</div>`)}</div>`;
}

export function coverA(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const media = ctx.media(ctx.doc.meta.cover.mediaId) ?? heroMedia(ctx.article(ctx.doc.meta.cover.articleId ?? "") ?? undefined, ctx, page);
  const src = ctx.src(media);
  const landscape = !!media?.aspectRatio && media.aspectRatio >= 1.15;
  const photo = src
    ? html`<div class="cover-photo"><img src="${src}" alt="${media?.altText ?? media?.caption ?? ""}" data-media="${media?.id}" style="object-position:${landscape ? "62% 40%" : "50% 30%"}" /></div>`
    : EMPTY;
  const credit = creditLine(media);
  const body = html`${photo}<div class="cover-inner">${mastheadBig(ctx)}<div class="cover-bottom">${coverLead(ctx, page)}${teaserList(ctx)}</div>${when(credit, () => html`<div class="cover-credit">Cover photo ${credit}</div>`)}</div>`;
  return { body, className: `cover cover-a ${landscape ? "cover-band" : ""}`, chrome: false };
}

export function coverB(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const teasers = ctx.doc.meta.cover.teasers.slice(0, 3);
  const figures = teasers
    .map((t) => ctx.article(t.articleId))
    .map((a) => (a ? heroMedia(a, ctx, page) : undefined))
    .filter(Boolean)
    .slice(0, 3);
  const body = html`<div class="cover-inner">${mastheadBig(ctx)}${when(figures.length, () => html`<div class="teaser-figs">${join(figures.map((m) => figureFor(m, ctx, colWidth(4), { widthMm: colWidth(4), heightMm: 52, caption: true })))}</div>`)}<div class="cover-bottom">${coverLead(ctx, page)}${teaserList(ctx)}</div></div>`;
  return { body, className: "cover cover-b", chrome: false };
}

export function contents(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const doc = ctx.doc;
  const groups: { name: string; colour: string; lines: typeof doc.toc }[] = [];
  for (const line of doc.toc) {
    const article = ctx.article(line.articleId);
    const section = ctx.section(article?.sectionId) ?? doc.sections.find((s) => s.name === line.sectionName);
    const name = section?.name ?? line.sectionName ?? "";
    let group = groups[groups.length - 1];
    if (!group || group.name !== name) {
      group = { name, colour: section?.colour ?? "#10203A", lines: [] };
      groups.push(group);
    }
    group.lines.push(line);
  }
  const dense = doc.toc.length > 20;
  const veryDense = doc.toc.length > 34;
  const editorialText = doc.meta.editorial ?? "";
  const editorInChief = doc.meta.credits.find((c) => /editor in chief/i.test(c.role))?.name ?? null;
  const pageMedia = page.mediaIds.map((id) => ctx.media(id)).find(Boolean);
  const candidate =
    pageMedia ??
    doc.toc
      .map((l) => ctx.article(l.articleId))
      .map((a) => (a ? ctx.media(a.heroMediaId) : undefined))
      .find((m) => m && m.kind === "photo" && m.rightsStatus === "GREEN" && (m.aspectRatio ?? 1) >= 0.7 && (m.aspectRatio ?? 1) <= 1.9);
  const contact = [doc.meta.contactEmail, doc.meta.website, doc.meta.social?.instagram ? `@${doc.meta.social.instagram}` : null].filter(Boolean);
  const body = html`<div class="contents-head"><div>${mastheadSmall(ctx)}<div class="issue-line">${doc.meta.issueLabel} · ${ctx.monthLabel}</div></div><div class="contents-title">Contents</div></div>
<div class="grid grow" style="min-height:0">
  <div class="span-5">
    ${when(editorialText, () => html`<div class="editorial"><span class="label">Editorial</span>${join(editorialText.split(/\n\s*\n/).map((p, i) => html`<p class="${i === 0 ? "drop" : ""}">${p}</p>`))}${when(editorInChief, () => html`<div class="sign">${editorInChief} · Editor in chief</div>`)}</div>`)}
    ${when(candidate, () => {
      const owner = doc.toc.find((l) => ctx.article(l.articleId)?.heroMediaId === candidate!.id || ctx.article(l.articleId)?.media.some((m) => m.mediaId === candidate!.id));
      const media = owner ? { ...candidate!, caption: `${candidate!.caption ?? owner.text} · page ${owner.page}` } : candidate!;
      return html`<div style="margin-top:5mm">${figureFor(media, ctx, colWidth(5), { widthMm: colWidth(5), minMm: 45, maxMm: 70 })}</div>`;
    })}
  </div>
  <div class="span-7 toc-col ${dense ? "dense" : ""} ${veryDense ? "very-dense" : ""}">
    ${join(
      groups.map(
        (g) => html`<div class="toc-section" style="--section:${g.colour}"><div class="sec">${g.name}</div>${join(
          g.lines.map((l) => html`<div class="toc-line"><span class="t">${l.text}</span><span class="dots"></span><span class="pg">${l.page}</span></div>`),
        )}</div>`,
      ),
    )}
  </div>
</div>
<div class="credits">
  ${join(doc.meta.credits.map((c) => html`<div><span class="label">${c.role}</span><b>${c.name}</b></div>`))}
  ${when(contact.length, () => html`<div><span class="label">Contact</span>${join(contact.map((c) => html`<div>${c}</div>`))}</div>`)}
  <div><span class="label">${doc.meta.masthead.title}</span>${doc.meta.issueLabel} · ${ctx.monthLabel}${when(doc.meta.publicationDate, () => html`<div>Published ${formatIsoDate(doc.meta.publicationDate)}</div>`)}</div>
</div>`;
  return { body, className: "contents" };
}

export function sectionOpener(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const section = ctx.sectionOfPage(page);
  const articles = ctx.doc.toc.filter((l) => {
    const a = ctx.article(l.articleId);
    return a && section && a.sectionId === section.id;
  });
  const first = ctx.articlesOf(page)[0] ?? (articles[0] ? ctx.article(articles[0].articleId) : undefined);
  const media = heroMedia(first, ctx, page);
  const src = ctx.src(media);
  const body = html`${when(src, () => html`<div class="opener-photo"><img src="${src}" alt="${media?.altText ?? ""}" data-media="${media?.id}" /></div>`)}<div class="opener-inner">${when(section?.kicker, () => html`<div class="kicker"><span class="dot"></span>${section?.kicker}</div>`)}<div class="opener-title">${section?.name ?? "Section"}</div>${when(articles.length, () => html`<div class="opener-list">${join(articles.map((l) => html`<div class="item"><span class="pg">${l.page}</span><span>${l.text}</span></div>`))}</div>`)}${when(media, () => captionHtml(media?.caption, creditLine(media), "on-photo"))}</div>`;
  return { body, className: "opener" };
}

export function quotePage(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return { body: placeholder(page, "Place a story with an approved pull quote on this page."), className: "quote-page" };
  const quote = article.pullQuotes[0] ?? firstBlockOfType(article, "pullquote");
  const media = heroMedia(article, ctx, page);
  const src = ctx.src(media);
  const otherPage = ctx.pageOfArticle(article.id);
  const body = html`${when(src, () => html`<div class="opener-photo"><img src="${src}" alt="${media?.altText ?? ""}" data-media="${media?.id}" /></div>`)}<div class="opener-inner">${when(quote, () => html`<div class="big-quote">“${quote!.text.replace(/^["“]|["”]$/g, "")}”</div>`)}<div class="attr">${quote && "attribution" in quote && quote.attribution ? quote.attribution : article.headline}${when(otherPage && otherPage !== page.number, () => html` · Read the story on page ${otherPage}`)}</div></div>`;
  return { body, className: "quote-page opener" };
}

/**
 * What the back page prints when no community story was placed on it.
 *
 * It used to print "Place the community story on this page." — an instruction to the editor, set in
 * a magazine that had already been sent to its readers. The back page always has standing furniture
 * (the colophon, the credits, how to reach the newsroom), so the missing story is replaced by the
 * invitation that furniture is there to make. The quality gate still reports the page as thin; the
 * difference is that the reader is not told to do the editor's job.
 */
function standingInvitation(ctx: TemplateContext): Html {
  const doc = ctx.doc;
  const reach = [doc.meta.contactEmail, doc.meta.website].filter(Boolean).join(" · ");
  return html`<div class="flow cols-2 grow back-flow">
<p class="blk para">Every issue of ${doc.meta.masthead.title} is made of what its community sends in: what happened, what was built, who is worth reading about.</p>
<p class="blk para">Tell the newsroom about it${reach ? html` — ${reach}` : EMPTY} — and it can be in the next one.</p>
</div><div class="flow-foot"></div>`;
}

export function backPage(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const doc = ctx.doc;
  const article = ctx.articlesOf(page)[0];
  const hero = article ? heroMedia(article, ctx, page) : undefined;
  const used = new Set(hero ? [hero.id] : []);
  const social = article ? article.media.map((m) => ctx.media(m.mediaId)).find((m) => m && !used.has(m.id) && m.rightsStatus !== "RED" && m.kind !== "photo") : undefined;
  if (social) used.add(social.id);
  const instagram = doc.meta.social?.instagram ?? null;
  const contact = [doc.meta.contactEmail, doc.meta.website].filter(Boolean);
  const head = article
    ? articleHeader(article, ctx, page, { size: "md", standfirst: "sm", meta: false })
    : html`<div class="article-head"><div class="kicker"><span class="dot"></span>Community</div><h1 class="headline md">Join ${doc.meta.masthead.title}</h1></div>`;
  const body = html`<div class="contents-head" style="margin-bottom:4mm;padding-bottom:2.4mm">${mastheadSmall(ctx)}<div class="issue-line" style="margin:0">${doc.meta.issueLabel} · ${ctx.monthLabel}</div></div>
${head}
${when(hero, () => figureFor(hero, ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 34, maxMm: 62, className: "hero-figure" }))}
<div class="back-grid">
  <div class="fill">${article ? flowRegion(page, article, ctx, { cols: 2, className: "back-flow" }) : standingInvitation(ctx)}</div>
  <div class="side">
    ${when(social || instagram, () => html`<div class="social-card">${when(social, () => figureFor(social, ctx, colWidth(4), { widthMm: colWidth(4), heightMm: 40, caption: false, contain: true }))}<div class="handle">${instagram ? `@${instagram}` : doc.meta.masthead.title}</div><div class="hint">${instagram ? "Follow the newsroom on Instagram for photos, behind the scenes and the next call for contributions." : "Write to the newsroom to contribute to the next issue."}</div></div>`)}
  </div>
</div>
<div class="colophon">
  <div>${mastheadSmall(ctx)}<div class="issue-line" style="margin-top:1.4mm">${doc.meta.issueLabel} · ${ctx.monthLabel}</div></div>
  <div>${join(doc.meta.credits.map((c) => html`<div><span class="label">${c.role}</span><b>${c.name}</b></div>`))}</div>
  <div><span class="label">Contact</span>${join(contact.map((c) => html`<div>${c}</div>`))}${when(instagram, () => html`<div>@${instagram}</div>`)}</div>
  <div><span class="label">Colophon</span>${doc.meta.masthead.title} is written by the students of Albert School. Version ${doc.meta.versionLabel} · ${formatIsoDate(doc.meta.generatedAt)}</div>
</div>`;
  return { body, className: "back" };
}
