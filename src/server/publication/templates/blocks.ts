import type { ArticleBlock, DocumentArticle, DocumentMedia } from "@/lib/publication/document";
import { splitSentences } from "@/lib/publication/text";
import { EMPTY, html, join, paragraphs, raw, when, type Html } from "./html";

/**
 * Shared block rendering used by every template (paragraph, crosshead, pullquote, list, image,
 * box, qa, testimony, divider). Blocks carry `data-block` ids so the pagination pass can measure
 * and move them; paragraph sentences are wrapped in spans so a long paragraph can be split at a
 * sentence boundary when it does not fit.
 */

export type MediaResolver = {
  media: (id: string) => DocumentMedia | undefined;
  src: (media: DocumentMedia) => string | null;
};

export function sentenceSpans(text: string): Html {
  return join(
    splitSentences(text).map((s) => html`<span class="s">${s}</span>`),
    " ",
  );
}

function paragraphHtml(text: string): Html {
  const parts = paragraphs(text);
  if (parts.length <= 1) return sentenceSpans(text);
  return join(
    parts.map((p) => html`<p>${sentenceSpans(p)}</p>`),
    "",
  );
}

export function captionHtml(caption: string | null | undefined, credit: string | null | undefined, extraClass = ""): Html {
  if (!caption && !credit) return EMPTY;
  return html`<div class="caption ${extraClass}">${caption ?? ""}${when(credit, () => html`<span class="credit">${credit}</span>`)}</div>`;
}

export function creditLine(media: DocumentMedia | undefined): string | null {
  if (!media) return null;
  if (media.credit) return media.credit;
  if (media.photographer) return `© ${media.photographer}`;
  return null;
}

/** Renders a figure with a fixed slot height (mm) computed from the media aspect ratio, clamped. */
export function figure(
  media: DocumentMedia | undefined,
  resolver: MediaResolver,
  options: { widthMm: number; minMm?: number; maxMm?: number; heightMm?: number; contain?: boolean; caption?: boolean; captionOnImage?: boolean; className?: string; position?: string; scale?: number } = { widthMm: 100 },
): Html {
  if (!media) return EMPTY;
  const src = resolver.src(media);
  const aspect = media.aspectRatio && media.aspectRatio > 0 ? media.aspectRatio : 1.5;
  const natural = options.widthMm / aspect;
  const base = options.heightMm ?? Math.min(options.maxMm ?? 120, Math.max(options.minMm ?? 30, natural));
  // The page's image-scale lever moves the figure inside its band. It may shrink a little past the
  // template's own minimum to win back text area, but never below 70 % of it — a picture that small
  // stops being a picture, and the layout pass is expected to change the page instead.
  const scale = options.scale ?? 1;
  const floor = (options.minMm ?? 30) * 0.7;
  const height = scale === 1 ? base : Math.max(floor, Math.min(options.maxMm ?? 120, base * scale));
  const contain = options.contain ?? (media.kind === "logo" || media.kind === "chart" || media.kind === "diagram" || media.kind === "screenshot");
  const caption = options.caption === false ? EMPTY : captionHtml(media.caption, creditLine(media), options.captionOnImage ? "on-image" : "");
  const img = src
    ? html`<img src="${src}" alt="${media.altText ?? media.caption ?? ""}" data-media="${media.id}" style="object-position:${options.position ?? "50% 40%"}" />`
    : html`<div class="missing-image" data-media="${media.id}"></div>`;
  return html`<div class="figure-block ${options.className ?? ""}"><div class="figure ${contain ? "contain tinted" : ""}" style="height:${height.toFixed(1)}mm">${img}${options.captionOnImage ? caption : EMPTY}</div>${options.captionOnImage ? EMPTY : caption}</div>`;
}

export function renderBlock(block: ArticleBlock, resolver: MediaResolver, opts: { hideSpeaker?: boolean } = {}): Html {
  const id = block.id;
  switch (block.type) {
    case "paragraph":
      return html`<div class="blk para" data-block="${id}" data-type="paragraph">${paragraphHtml(block.text)}</div>`;
    case "crosshead":
      return html`<div class="blk crosshead" data-block="${id}" data-type="crosshead">${block.text}</div>`;
    case "pullquote":
      return html`<div class="blk pullquote" data-block="${id}" data-type="pullquote">“${block.text.replace(/^["“]|["”]$/g, "")}”${when(block.attribution, () => html`<span class="attr">${block.attribution}</span>`)}</div>`;
    case "list":
      return html`<${raw(block.ordered ? "ol" : "ul")} class="blk list ${block.ordered ? "ordered" : ""}" data-block="${id}" data-type="list">${join(block.items.map((item) => html`<li>${item}</li>`))}</${raw(block.ordered ? "ol" : "ul")}>`;
    case "image": {
      const media = resolver.media(block.assetId);
      const src = media ? resolver.src(media) : null;
      const size = block.size ?? "inline";
      const caption = captionHtml(block.caption ?? media?.caption, block.credit ?? creditLine(media));
      return html`<div class="blk figure ${size}" data-block="${id}" data-type="image">${src ? html`<img src="${src}" alt="${block.caption ?? media?.altText ?? ""}" data-media="${block.assetId}" />` : EMPTY}${caption}</div>`;
    }
    case "box":
      return html`<div class="blk box" data-block="${id}" data-type="box">${when(block.title, () => html`<div class="box-title">${block.title}</div>`)}${when(block.text, () => html`<p>${block.text}</p>`)}${when(block.items?.length, () => html`<ul>${join((block.items ?? []).map((i) => html`<li>${i}</li>`))}</ul>`)}</div>`;
    case "qa":
      return html`<div class="blk qa" data-block="${id}" data-type="qa"><div class="q">${block.question}</div><div class="a">${paragraphHtml(block.answer)}</div></div>`;
    case "testimony":
      return html`<div class="blk testimony" data-block="${id}" data-type="testimony">${sentenceSpans(block.text)}${when(block.speaker && !opts.hideSpeaker, () => html`<span class="speaker">— ${block.speaker}</span>`)}</div>`;
    case "divider":
      return html`<div class="blk divider" data-block="${id}" data-type="divider"></div>`;
  }
}

/** Renders a list of blocks in order; a run of testimonies by the same speaker is signed once, at its end. */
export function renderBlocks(blocks: readonly ArticleBlock[], resolver: MediaResolver, options: { dropCap?: boolean } = {}): Html {
  const out: Html[] = [];
  let dropped = false;
  blocks.forEach((block, i) => {
    const next = blocks[i + 1];
    const hideSpeaker = block.type === "testimony" && next?.type === "testimony" && (next.speaker ?? "") === (block.speaker ?? "");
    let rendered = renderBlock(block, resolver, { hideSpeaker });
    if (options.dropCap && !dropped && block.type === "paragraph") {
      rendered = raw(rendered.value.replace('class="blk para"', 'class="blk para drop"'));
      dropped = true;
    }
    out.push(rendered);
  });
  return join(out);
}

/** Blocks the flowing part of a template should show: either the page slice or the whole body minus `exclude`. */
export function flowBlocks(article: DocumentArticle, slice: { blockIds: string[]; fragments?: ArticleBlock[] } | undefined, exclude: Set<string> = new Set()): ArticleBlock[] {
  if (!slice) return article.body.filter((b) => !exclude.has(b.id));
  const lookup = new Map<string, ArticleBlock>();
  for (const b of article.body) lookup.set(b.id, b);
  for (const f of slice.fragments ?? []) lookup.set(f.id, f);
  return slice.blockIds.map((id) => lookup.get(id)).filter((b): b is ArticleBlock => !!b);
}

/** Finds the first block of a given type (used by templates to lift a box or pull quote into a sidebar). */
export function firstBlockOfType<T extends ArticleBlock["type"]>(article: DocumentArticle, type: T): Extract<ArticleBlock, { type: T }> | undefined {
  return article.body.find((b): b is Extract<ArticleBlock, { type: T }> => b.type === type);
}
