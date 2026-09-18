import type { DocumentArticle, DocumentBdd, DocumentMedia, DocumentPage } from "@/lib/publication/document";
import { firstBlockOfType } from "./blocks";
import type { TemplateContext } from "./context";
import { EMPTY, html, join, when, type Html } from "./html";
import { CONTENT_WIDTH_MM, articleHeader, colWidth, figureFor, flowRegion, galleryMedia, heroMedia, headlineClass, placeholder, pullQuoteBlockId, pullQuoteSide, sideBox, type TemplateOutput } from "./parts";

/** Business Deep Dive templates: the structured case page and the visual (dashboards/diagrams) page. */

function names(list: { name: string; program?: string; campus?: string }[]): string {
  return list.map((m) => m.name).join(", ");
}

function juryNames(list: { name: string; role?: string; organisation?: string }[]): string {
  return list.map((j) => [j.name, [j.role, j.organisation].filter(Boolean).join(", ")].filter(Boolean).join(" — ")).join(" · ");
}

/** Labelled case blocks from the satellite, falling back to the article body's crossheads when no satellite exists. */
export function caseItems(article: DocumentArticle): { label: string; text?: string; items?: string[]; chips?: string[] }[] {
  const bdd = article.bdd;
  if (bdd) {
    const items: { label: string; text?: string; items?: string[]; chips?: string[] }[] = [];
    if (bdd.theCase) items.push({ label: "The case", text: bdd.theCase });
    if (bdd.theData) items.push({ label: "The data", text: bdd.theData });
    if (bdd.theChallenge) items.push({ label: "The challenge", text: bdd.theChallenge });
    if (bdd.theApproach) items.push({ label: "The approach", text: bdd.theApproach });
    if (bdd.theMethods || bdd.technologies.length) items.push({ label: "The methods", text: bdd.theMethods ?? undefined, chips: bdd.technologies });
    if (bdd.theSolution) items.push({ label: "The solution", text: bdd.theSolution });
    if (bdd.theResults) items.push({ label: "The results", text: bdd.theResults });
    if (bdd.winningTeam.length) items.push({ label: "The winning team", text: names(bdd.winningTeam) });
    if (bdd.finalists.length) items.push({ label: bdd.finalists.length > 1 ? "Finalists" : "Runners-up", text: bdd.finalists.map(names).join(" · ") });
    if (bdd.jury.length) items.push({ label: "The jury", text: juryNames(bdd.jury) });
    if (bdd.keyTakeaways.length) items.push({ label: "Key takeaways", items: bdd.keyTakeaways });
    return items;
  }
  // Fallback: group body paragraphs under their crossheads.
  const items: { label: string; text?: string }[] = [];
  let current: { label: string; text?: string } | null = null;
  for (const block of article.body) {
    if (block.type === "crosshead") {
      current = { label: block.text, text: "" };
      items.push(current);
    } else if (current && block.type === "paragraph") {
      current.text = [current.text, block.text].filter(Boolean).join(" ");
    }
  }
  return items.filter((i) => i.text);
}

function casePanel(article: DocumentArticle): Html {
  const bdd = article.bdd;
  const items = caseItems(article);
  if (!items.length && !bdd?.metrics.length) return EMPTY;
  return html`<div class="case-panel">
${when(bdd?.metrics.length, () => html`<div class="metrics">${join((bdd?.metrics ?? []).map((m) => html`<div class="metric"><div class="v">${m.value}</div><div class="l">${m.label}</div></div>`))}</div>`)}
${join(
  items.map(
    (i) =>
      html`<div class="item"><span class="label">${i.label}</span>${when(i.text, () => html`<div class="${/team|jury|finalist|runner/i.test(i.label) ? "names" : ""}">${i.text}</div>`)}${when(i.items?.length, () => html`<ul class="takeaways">${join((i.items ?? []).map((t) => html`<li>${t}</li>`))}</ul>`)}${when(i.chips?.length, () => html`<div class="chips">${join((i.chips ?? []).map((c) => html`<span class="chip">${c}</span>`))}</div>`)}</div>`,
  ),
)}
</div>`;
}

function bddTop(article: DocumentArticle, ctx: TemplateContext, page: DocumentPage, size: "md" | "sm" = "md"): Html {
  const bdd = article.bdd;
  const logo = ctx.media(bdd?.logoMediaId) ?? article.media.map((m) => ctx.media(m.mediaId)).find((m) => m?.kind === "logo");
  const logoSrc = ctx.src(logo);
  const kicker = bdd ? [bdd.companyName, bdd.cohortLabel].filter(Boolean).join(" – ") : undefined;
  const dateText = bdd?.dateText ?? article.eventDateText;
  return html`<div class="bdd-top" style="${logo ? "" : "grid-template-columns:1fr auto"}">
${when(logo, () => html`<div class="bdd-logo">${logoSrc ? html`<img src="${logoSrc}" alt="${logo?.caption ?? bdd?.companyName ?? ""}" data-media="${logo?.id}" />` : EMPTY}</div>`)}
<div>${articleHeader(article, ctx, page, { size, standfirst: "sm", meta: false, kicker })}</div>
<div class="bdd-date">${when(dateText, () => html`<b>${dateText}</b>`)}${when(article.campuses.length, () => html`${article.campuses.join(" · ")} campus`)}</div>
</div>`;
}

export function bddCase(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return { body: placeholder(page, "Place a Business Deep Dive story on this page."), className: "bdd" };
  const bdd = article.bdd;
  const team = ctx.media(bdd?.teamPhotoMediaId) ?? heroMedia(article, ctx, page);
  const used = new Set<string>([team?.id, bdd?.logoMediaId ?? undefined].filter((x): x is string => !!x));
  const extra = galleryMedia(article, ctx, used, ["photo"])[0];
  const box = firstBlockOfType(article, "box");
  const exclude = new Set<string>(box ? [box.id] : []);
  const leftWidth = colWidth(5);
  const rightWidth = colWidth(7);
  const body = html`${bddTop(article, ctx, page)}
<div class="grid grow" style="min-height:0">
  <div class="span-5 side">
    ${casePanel(article)}
    ${sideBox(box)}
    ${when(extra, () => figureFor(extra, ctx, leftWidth, { widthMm: leftWidth, minMm: 34, maxMm: 52 }))}
  </div>
  <div class="span-7 fill">
    ${figureFor(team, ctx, rightWidth, { widthMm: rightWidth, minMm: 46, maxMm: 70, className: "hero-figure" })}
    ${flowRegion(page, article, ctx, { cols: 2, className: "compact", exclude })}
  </div>
</div>`;
  return { body, className: "bdd bdd-case" };
}

function visualsFor(article: DocumentArticle, ctx: TemplateContext): DocumentMedia[] {
  const bdd = article.bdd;
  const out: DocumentMedia[] = [];
  const push = (m: DocumentMedia | undefined) => {
    if (m && m.rightsStatus !== "RED" && !out.some((x) => x.id === m.id)) out.push(m);
  };
  push(ctx.media(bdd?.dashboardMediaId));
  push(ctx.media(bdd?.diagramMediaId));
  for (const m of galleryMedia(article, ctx, new Set(out.map((m) => m.id)), ["screenshot", "diagram", "chart"])) push(m);
  return out.slice(0, 3);
}

export function bddVisual(page: DocumentPage, ctx: TemplateContext): TemplateOutput {
  const article = ctx.articlesOf(page)[0];
  if (!article) return { body: placeholder(page, "Place a Business Deep Dive story with dashboards or diagrams on this page."), className: "bdd" };
  const bdd = article.bdd;
  const visuals = visualsFor(article, ctx);
  const otherFlowPages = ctx.flowPagesOfArticle(article.id).filter((p) => p.id !== page.id && p.template !== "CONTINUATION");
  const bodyElsewhere = otherFlowPages.length > 0;
  const half = colWidth(6);
  const grid: Html[] = [];
  if (visuals.length === 1) grid.push(figureFor(visuals[0], ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 60, maxMm: bodyElsewhere ? 110 : 80, className: "full", contain: true }));
  else if (visuals.length === 2) {
    const max = bodyElsewhere ? 70 : 52;
    for (const v of visuals) grid.push(figureFor(v, ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 40, maxMm: max, className: "full", contain: true }));
  } else {
    grid.push(figureFor(visuals[0], ctx, CONTENT_WIDTH_MM, { widthMm: CONTENT_WIDTH_MM, minMm: 40, maxMm: bodyElsewhere ? 78 : 50, className: "full", contain: true }));
    for (const v of visuals.slice(1, 3)) grid.push(figureFor(v, ctx, half, { widthMm: half, heightMm: bodyElsewhere ? 56 : 40, contain: true }));
  }
  const team = ctx.media(bdd?.teamPhotoMediaId) ?? heroMedia(article, ctx, page);
  const box = firstBlockOfType(article, "box");
  const chips = (bdd?.technologies ?? []).map((t) => html`<span class="chip">${t}</span>`);
  const strip = bodyElsewhere
    ? html`<div class="grid" style="align-items:start"><div class="span-5">${when(bdd?.metrics.length || chips.length, () => html`<div class="case-panel">${when(bdd?.metrics.length, () => html`<div class="metrics">${join((bdd?.metrics ?? []).map((m) => html`<div class="metric"><div class="v">${m.value}</div><div class="l">${m.label}</div></div>`))}</div>`)}${when(chips.length, () => html`<div class="item"><span class="label">The methods</span><div class="chips">${join(chips)}</div></div>`)}</div>`)}</div><div class="span-7">${when(bdd?.keyTakeaways.length, () => html`<div class="side-box"><div class="box-title">Key takeaways</div><ul>${join((bdd?.keyTakeaways ?? []).map((t) => html`<li>${t}</li>`))}</ul></div>`)}${when(!bdd?.keyTakeaways.length, () => pullQuoteSide(article))}</div></div>`
    : html`<div class="grid grow" style="min-height:0"><div class="span-5 side">${figureFor(team, ctx, colWidth(5), { widthMm: colWidth(5), minMm: 36, maxMm: 50 })}${sideBox(box)}${when(chips.length, () => html`<div class="chips">${join(chips)}</div>`)}</div><div class="span-7 fill">${flowRegion(page, article, ctx, { cols: 2, className: "compact", exclude: new Set([box?.id, bdd?.keyTakeaways.length ? undefined : pullQuoteBlockId(article)].filter((id): id is string => !!id)) })}</div></div>`;
  const body = html`${bddTop(article, ctx, page, "sm")}
<div class="visual-grid">${join(grid)}</div>
${strip}`;
  return { body, className: "bdd bdd-visual" };
}

export function bddHeadlineClass(article: DocumentArticle): string {
  return headlineClass(article);
}

export type { DocumentBdd };
