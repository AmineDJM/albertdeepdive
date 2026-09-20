import { html, join, raw, type Html } from "@/server/publication/templates/html";
import { composeHeadline } from "@/lib/design/headline";
import { MEDIUM_BASE, type TypeScale } from "@/lib/design/type-scale";
import { blockFor, type DesignBlock, type DesignElement, type EditionDesign } from "@/lib/design/model";
import type { OutputMedium } from "@/lib/design/roles";
import type { ArticleBlock } from "@/lib/publication/document";
import { blockClasses } from "./css";
import { resolve, type ResolveContext } from "./content";

/**
 * The design, as markup.
 *
 * One renderer for every medium that speaks HTML — the web edition and the printed page, which are
 * the same document with different stylesheets and a pagination pass. Email is the exception and
 * has its own renderer, because tables are not a stylesheet choice.
 *
 * The rules that matter here are boring and load-bearing. Every string goes through the escaping
 * template, because article text comes from contributors. The markup is semantic — an article is an
 * `<article>`, a picture with a caption is a `<figure>`, a headline's level follows its importance —
 * because accessibility is part of design excellence rather than a pass afterwards (§70). And an
 * element with nothing behind it is not drawn at all, which is what stops an empty box with a
 * caption appearing where a photograph was deleted.
 */

export type RenderOptions = {
  medium: OutputMedium;
  content: ResolveContext;
  /** The heading level the edition starts at. A web page's `<h1>` is the masthead. */
  baseLevel?: number;
  /**
   * What the typography engine needs to set a headline rather than pour it in.
   *
   * §7: a display line is composed — broken where the sense breaks, balanced across its lines,
   * and shrunk only when shrinking is what makes it work. Without this the browser breaks it
   * wherever the box ends, which is how "a +0.4% sales uplift" ends up as "a +0.4% sales" and a
   * line reading "uplift".
   */
  typography?: { scale: TypeScale; contentWidth: number };
};

export function renderDesign(design: EditionDesign, options: RenderOptions): Html {
  const sections = design.sections.map((section) => {
    const surfaces = section.surfaces.map((surface) => {
      const blocks = surface.blocks
        .map((block) => blockFor(block, options.medium))
        .filter((block): block is DesignBlock => Boolean(block))
        .map((block) => renderBlock(block, options));
      if (!blocks.length) return null;
      return html`<section class="surface" data-kind="${surface.kind}" data-surface="${surface.id}"${raw(surface.atomic ? ' data-atomic="true"' : "")}>${join(blocks, "\n")}</section>`;
    });
    const kept = surfaces.filter((surface): surface is Html => Boolean(surface));
    if (!kept.length) return null;
    return html`<div class="section" data-section="${section.id}" aria-label="${section.name}">${join(kept, "\n")}</div>`;
  });
  return html`<div class="edition">${join(sections.filter((section): section is Html => Boolean(section)), "\n")}</div>`;
}

export function renderBlock(block: DesignBlock, options: RenderOptions): Html {
  const elements = block.elements.map((element) => renderElement(element, block, options)).filter((element): element is Html => Boolean(element));
  // A block whose every element resolved to nothing is not drawn. An empty frame with a caption
  // under it is worse than a missing picture, because it looks like a mistake nobody noticed.
  if (!elements.length) return html``;

  const classes = blockClasses(block.role, block.composition, [block.style.ruleAbove ? "rule-above" : "", block.style.ruleBelow ? "rule-below" : ""].filter(Boolean));
  const span = Math.round((block.constraints.maxWidth ?? 1) * 12);
  const tag = block.articleId ? "article" : "div";
  const surface = block.style.surface ? ` ${surfaceClass(block.style.surface)}` : "";
  return raw(
    // The id is the anchor: §14 wants one story shareable on its own, and §35's "make this bigger"
    // needs the same handle in the rendered page that it has in the design.
    `<${tag} id="${block.id}" class="${classes}${surface}" data-block="${block.id}" data-role="${block.role}" data-importance="${block.importance}"` +
      `${block.constraints.fullBleed ? ' data-bleed="true"' : ""}` +
      `${block.constraints.keepTogether ? ' data-keep="true"' : ""}` +
      ` style="--span:${span}">${join(elements, "\n").value}</${tag}>`,
  );
}

function surfaceClass(surface: string): string {
  return `s-${surface}`;
}

/**
 * A headline, composed.
 *
 * The engine is asked only where it can be answered: a display line with a width to fit into. It
 * returns where to break, and how much to shrink if shrinking is what makes the line work; the
 * breaks are emitted so the renderer cannot undo them, and the size only when it differs from the
 * scale's, so a headline that already fits carries no inline style at all.
 */
function setHeadline(text: string, element: DesignElement, block: DesignBlock, options: RenderOptions): { markup: string; style: string } {
  const plain = { markup: escape(text), style: "" };
  const typography = options.typography;
  if (!typography) return plain;
  const role = element.style.type ?? "headline";
  const style = typography.scale.roles[role as keyof TypeScale["roles"]];
  if (!style) return plain;

  const width = typography.contentWidth * (block.constraints.maxWidth ?? 1);
  if (width <= 0) return plain;
  const composed = composeHeadline(text, style, {
    maxWidth: width,
    // The element's own limit first: a cover line that may take two lines said so when it was
    // composed, and the block it sits on knows nothing about that.
    maxLines: element.constraints.maxHeadlineLines ?? block.constraints.maxHeadlineLines ?? (block.importance === "COVER" || block.importance === "LEAD" ? 3 : 4),
    locale: options.content.locale,
  });
  // Even when the words cannot be made to fit, the breaks it found beat the ones a box would
  // impose — and the problems it reports are the critic's business, not the renderer's.
  if (composed.lines.length <= 1) return plain;

  const unit = MEDIUM_BASE[options.medium].unit;
  const changed = Math.abs(composed.size - style.size) > 0.01 || Math.abs(composed.tracking - style.tracking) > 0.0001;
  const inline = changed ? ` style="font-size:${composed.size}${unit};letter-spacing:${(composed.tracking * composed.size).toFixed(3)}${unit};line-height:${composed.leading}"` : "";
  return { markup: composed.lines.map(escape).join("<br>"), style: inline };
}

function renderElement(element: DesignElement, block: DesignBlock, options: RenderOptions): Html | null {
  if (element.omitIn.includes(options.medium)) return null;
  const resolved = resolve(element.content, options.content);
  if (resolved.kind === "nothing") return null;

  const typeClass = element.style.type ? ` t-${element.style.type}` : "";
  const level = headingLevel(block.importance, options.baseLevel ?? 1);

  switch (element.role) {
    case "headline": {
      if (resolved.kind !== "text") return null;
      const set = setHeadline(resolved.text, element, block, options);
      return raw(`<h${level} class="headline${typeClass}" data-element="${element.id}"${set.style}>${set.markup}</h${level}>`);
    }
    case "subheadline":
      return resolved.kind === "text" ? raw(`<h${Math.min(6, level + 1)} class="subheadline${typeClass}" data-element="${element.id}">${escape(resolved.text)}</h${Math.min(6, level + 1)}>`) : null;
    case "kicker":
      return resolved.kind === "text" ? html`<p class="kicker${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "deck":
      return resolved.kind === "text" ? html`<p class="deck${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "byline":
      return resolved.kind === "text" ? html`<p class="byline${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "dateline":
    case "label":
    case "page-number":
      return resolved.kind === "text" ? html`<p class="label${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "logo":
      return resolved.kind === "text" ? html`<p class="logo${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "quote":
      return resolved.kind === "text" ? html`<blockquote class="quote${raw(typeClass)}" data-element="${element.id}">${resolved.text}</blockquote>` : null;
    case "attribution":
      return resolved.kind === "text" ? html`<p class="attribution${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "stat-value":
      return resolved.kind === "text" ? html`<p class="stat-value${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "stat-label":
      return resolved.kind === "text" ? html`<p class="stat-label${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "link":
      return resolved.kind === "text" ? html`<p class="link${raw(typeClass)}" data-element="${element.id}"><a href="${linkHref(resolved.text)}">${resolved.text}</a></p>` : null;
    case "excerpt":
      return resolved.kind === "text" ? html`<p class="excerpt${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "credit":
      return resolved.kind === "text" ? html`<p class="credit${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
    case "caption":
      return resolved.kind === "text" ? html`<figcaption class="caption${raw(typeClass)}" data-element="${element.id}">${resolved.text}</figcaption>` : null;

    case "image": {
      if (resolved.kind !== "picture") return null;
      const { media, url, crop, alt, caption, credit } = resolved;
      // The crop travels as an object-position rather than a second file: the original is never
      // modified, and a renderer that wants the real cut (print) can read the same rectangle.
      const width = media.src.print?.width ?? media.width ?? 0;
      const height = media.src.print?.height ?? media.height ?? 0;
      const positionX = width > crop.width ? (crop.x / (width - crop.width)) * 100 : 50;
      const positionY = height > crop.height ? (crop.y / (height - crop.height)) * 100 : 50;
      const ratio = crop.width && crop.height ? `${crop.width} / ${crop.height}` : "3 / 2";
      const figcaption =
        caption || credit
          ? html`<figcaption class="caption t-caption">${caption ?? ""}${caption && credit ? " " : ""}${credit ? html`<span class="credit">${credit}</span>` : ""}</figcaption>`
          : html``;
      return raw(
        `<figure data-element="${element.id}" data-media="${media.id}" data-crop="${resolved.shape}">` +
          `<img src="${escape(url)}" alt="${escape(alt)}" loading="lazy" decoding="async" style="aspect-ratio:${ratio};object-fit:cover;object-position:${positionX.toFixed(1)}% ${positionY.toFixed(1)}%">` +
          figcaption.value +
          `</figure>`,
      );
    }

    case "body":
      return resolved.kind === "blocks" ? html`<div class="body${raw(typeClass)}" data-element="${element.id}">${join(resolved.blocks.map(renderArticleBlock), "\n")}</div>` : null;

    case "list":
      return resolved.kind === "blocks" ? html`<div class="list" data-element="${element.id}">${join(resolved.blocks.map(renderArticleBlock), "\n")}</div>` : null;

    default:
      return resolved.kind === "text" ? html`<p class="${raw(element.role)}${raw(typeClass)}" data-element="${element.id}">${resolved.text}</p>` : null;
  }
}

/**
 * An article's own blocks, drawn as the things they are.
 *
 * A pull quote inside running text is a pull quote, not a paragraph in italics; a list is a list, so
 * a screen reader announces how many items are coming. This is the level at which most editorial
 * markup quietly turns into `<div>`s.
 */
export function renderArticleBlock(block: ArticleBlock): Html {
  switch (block.type) {
    case "paragraph":
      return html`<p data-copy="${block.id}">${block.text}</p>`;
    case "crosshead":
      return html`<h4 class="crosshead t-subheadline" data-copy="${block.id}">${block.text}</h4>`;
    case "pullquote":
      return html`<blockquote class="pull-quote t-deck" data-copy="${block.id}">${block.text}${block.attribution ? html`<cite>${block.attribution}</cite>` : ""}</blockquote>`;
    case "testimony":
      return html`<blockquote class="testimony" data-copy="${block.id}">${block.text}${block.speaker ? html`<cite>${block.speaker}</cite>` : ""}</blockquote>`;
    case "list":
      return block.ordered
        ? html`<ol data-copy="${block.id}">${join(block.items.map((item) => html`<li>${item}</li>`))}</ol>`
        : html`<ul data-copy="${block.id}">${join(block.items.map((item) => html`<li>${item}</li>`))}</ul>`;
    case "box":
      return html`<aside class="box" data-copy="${block.id}">${block.title ? html`<h4 class="t-label">${block.title}</h4>` : ""}${block.text ? html`<p>${block.text}</p>` : ""}${block.items?.length ? html`<ul>${join(block.items.map((item) => html`<li>${item}</li>`))}</ul>` : ""}</aside>`;
    case "qa":
      return html`<div class="qa" data-copy="${block.id}"><p class="question t-subheadline">${block.question}</p><p class="answer">${block.answer}</p></div>`;
    case "image":
      // Pictures inside running text are placed by the design, not by the article's own ordering.
      return html``;
    case "divider":
      return html`<hr data-copy="${block.id}">`;
  }
}

function headingLevel(importance: DesignBlock["importance"], base: number): number {
  switch (importance) {
    case "COVER":
    case "LEAD":
      return Math.min(6, base);
    case "MAJOR":
      return Math.min(6, base + 1);
    case "STANDARD":
      return Math.min(6, base + 2);
    default:
      return Math.min(6, base + 3);
  }
}

function escape(value: string): string {
  return html`${value}`.value;
}

function linkHref(text: string): string {
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[^@\s]+@[^@\s]+$/.test(trimmed)) return `mailto:${trimmed}`;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}
