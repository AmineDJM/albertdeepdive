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

export const BYLINE_BLOCK_ID = "__byline";

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
  options: { widthMm: number; minMm?: number; maxMm?: number; heightMm?: number; contain?: boolean; caption?: boolean; captionOnImage?: boolean; className?: string; position?: string } = { widthMm: 100 },
): Html {
  if (!media) return EMPTY;
  const src = resolver.src(media);
  const aspect = media.aspectRatio && media.aspectRatio > 0 ? media.aspectRatio : 1.5;
  const natural = options.widthMm / aspect;
  const height = options.heightMm ?? Math.min(options.maxMm ?? 120, Math.max(options.minMm ?? 30, natural));
  const contain = options.contain ?? (media.kind === "logo" || media.kind === "chart" || media.kind === "diagram" || media.kind === "screenshot");
  const caption = options.caption === false ? EMPTY : captionHtml(media.caption, creditLine(media), options.captionOnImage ? "on-image" : "");
  const img = src
    ? html`<img src="${src}" alt="${media.altText ?? media.caption ?? ""}" data-media="${media.id}" style="object-position:${options.position ?? "50% 40%"}" />`
    : html`<div class="missing-image" data-media="${media.id}"></div>`;
  return html`<div class="figure-block ${options.className ?? ""}"><div class="figure ${contain ? "contain tinted" : ""}" style="height:${height.toFixed(1)}mm">${img}${options.captionOnImage ? caption : EMPTY}</div>${options.captionOnImage ? EMPTY : caption}</div>`;
}

export function renderBlock(block: ArticleBlock, resolver: MediaResolver, opts: { previousType?: string } = {}): Html {
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
    case "testimony": {
      const repeat = opts.previousType === "testimony";
      return html`<div class="blk testimony" data-block="${id}" data-type="testimony">${sentenceSpans(block.text)}${when(block.speaker, () => html`<span class="speaker ${repeat ? "repeat" : ""}">— ${block.speaker}</span>`)}</div>`;
    }
    case "divider":
      return html`<div class="blk divider" data-block="${id}" data-type="divider"></div>`;
  }
}

export function bylineBlock(article: DocumentArticle): Html {
  if (!article.byline) return EMPTY;
  return html`<div class="blk byline" data-block="${BYLINE_BLOCK_ID}" data-type="byline">Article : ${article.byline}</div>`;
}

/** Renders a list of blocks in order (crossheads keep their next block attached where possible). */
export function renderBlocks(blocks: readonly ArticleBlock[], resolver: MediaResolver, options: { dropCap?: boolean } = {}): Html {
  const out: Html[] = [];
  let previous: string | undefined;
  let dropped = false;
  for (const block of blocks) {
    let rendered = renderBlock(block, resolver, { previousType: previous });
    if (options.dropCap && !dropped && block.type === "paragraph") {
      rendered = raw(rendered.value.replace('class="blk para"', 'class="blk para drop"'));
      dropped = true;
    }
    out.push(rendered);
    previous = block.type;
  }
  return join(out);
}

/** Blocks the flowing part of a template should show: either the page slice or the whole body minus `exclude`. */
export function flowBlocks(article: DocumentArticle, slice: { blockIds: string[]; fragments?: ArticleBlock[] } | undefined, exclude: Set<string> = new Set()): { blocks: ArticleBlock[]; byline: boolean } {
  if (!slice) {
    return { blocks: article.body.filter((b) => !exclude.has(b.id)), byline: !!article.byline };
  }
  const lookup = new Map<string, ArticleBlock>();
  for (const b of article.body) lookup.set(b.id, b);
  for (const f of slice.fragments ?? []) lookup.set(f.id, f);
  const blocks: ArticleBlock[] = [];
  let byline = false;
  for (const id of slice.blockIds) {
    if (id === BYLINE_BLOCK_ID) byline = true;
    const b = lookup.get(id);
    if (b) blocks.push(b);
  }
  return { blocks, byline };
}

/** Finds the first block of a given type (used by templates to lift a box or pull quote into a sidebar). */
export function firstBlockOfType<T extends ArticleBlock["type"]>(article: DocumentArticle, type: T): Extract<ArticleBlock, { type: T }> | undefined {
  return article.body.find((b): b is Extract<ArticleBlock, { type: T }> => b.type === type);
}
