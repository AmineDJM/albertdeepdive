import { blockText, type ArticleBlock, type DocumentArticle, type DocumentMedia, type EditionDocument } from "@/lib/publication/document";
import { formatIsoDate } from "@/lib/publication/text";
import type { ContentRef, DesignElement } from "@/lib/design/model";
import type { OutputMedium } from "@/lib/design/roles";
import { CROP_SHAPES, cropTo, naturalShape, type CropShape, type FocalPoint, CENTRE } from "@/lib/design/crop";

/**
 * Turning a reference into something a renderer can draw.
 *
 * The design points at content; it never holds any. That is what keeps a correction to an article
 * true in the web edition, the PDF and the inbox at once — and it means every renderer needs the
 * same resolver, or they will disagree about what a reference meant.
 *
 * So there is one, and it is the only place that knows how an `article/body` reference becomes
 * paragraphs, how a `media` reference becomes a URL and a crop, and what to do when the thing being
 * pointed at is no longer there.
 */

export type ResolvedText = { kind: "text"; text: string };
export type ResolvedBlocks = { kind: "blocks"; blocks: ArticleBlock[] };
export type ResolvedPicture = {
  kind: "picture";
  media: DocumentMedia;
  url: string;
  /** The crop for this medium, as a rectangle in the source picture's own pixels. */
  crop: { x: number; y: number; width: number; height: number };
  shape: CropShape;
  alt: string;
  caption: string | null;
  credit: string | null;
};
export type ResolvedNothing = { kind: "nothing"; why: string };
export type Resolved = ResolvedText | ResolvedBlocks | ResolvedPicture | ResolvedNothing;

export type ResolveContext = {
  document: EditionDocument;
  medium: OutputMedium;
  /** Absolute URLs by media id. Signed for the web, embedded for print. */
  urls: Record<string, string>;
  /** Focal points by media id, where anything has worked one out. */
  focals?: Record<string, FocalPoint>;
  /** The publication's own name and the edition's, for the metadata references. */
  masthead?: { title: string; tagline: string | null };
  /**
   * The page this is being drawn on, when the medium has pages.
   *
   * Print is the only medium that can answer `meta/page`, and it can only answer it once the
   * pagination pass has settled — so the reference stays unresolvable everywhere else rather than
   * resolving to a guess that would print the wrong folio.
   */
  page?: { number: number; total: number };
};

export function resolve(ref: ContentRef, ctx: ResolveContext): Resolved {
  const resolved = resolveRef(ref, ctx);
  // Empty is nothing. A heading whose text resolved to "" renders as an empty tag: invisible in a
  // browser, a blank line in a PDF, and a heading with no name to a screen reader.
  if (resolved.kind === "text" && !resolved.text.trim()) return { kind: "nothing", why: "there is nothing to say here" };
  return resolved;
}

function resolveRef(ref: ContentRef, ctx: ResolveContext): Resolved {
  switch (ref.kind) {
    case "text":
      return { kind: "text", text: ref.text };

    case "article": {
      const article = ctx.document.articles.find((candidate) => candidate.id === ref.articleId);
      if (!article) return { kind: "nothing", why: "that article is not in this edition" };
      return resolveArticlePart(article, ref);
    }

    case "media": {
      const media = ctx.document.media.find((candidate) => candidate.id === ref.mediaId);
      if (!media) return { kind: "nothing", why: "that picture is not in this edition" };
      const url = ctx.urls[media.id] ?? media.src.web?.url ?? media.src.print?.url ?? media.src.thumb?.url ?? "";
      if (!url) return { kind: "nothing", why: "that picture has no file behind it" };
      const width = media.src.print?.width ?? media.width ?? 0;
      const height = media.src.print?.height ?? media.height ?? 0;
      const shape = (ref.cropId as CropShape) ?? naturalShape({ width: width || 3, height: height || 2 });
      const focal = ctx.focals?.[media.id] ?? CENTRE;
      const crop = width && height ? cropTo({ width, height }, CROP_SHAPES[shape] ?? CROP_SHAPES.landscape, focal) : { x: 0, y: 0, width: width || 0, height: height || 0 };
      return {
        kind: "picture",
        media,
        url,
        crop,
        shape,
        // An empty alt is a decision an editor should make; a missing one is a failure, so the
        // caption stands in and the QA pass reports it rather than the renderer inventing prose.
        alt: media.altText ?? media.caption ?? "",
        caption: media.caption,
        credit: media.credit ?? media.photographer ?? null,
      };
    }

    case "section": {
      const section = ctx.document.sections.find((candidate) => candidate.id === ref.sectionId);
      if (!section) return { kind: "nothing", why: "that section is not in this edition" };
      if (ref.part === "kicker") return { kind: "text", text: section.kicker ?? "" };
      if (ref.part === "number") return { kind: "text", text: String(ctx.document.sections.indexOf(section) + 1) };
      return { kind: "text", text: section.name };
    }

    case "fact": {
      const article = ctx.document.articles.find((candidate) => candidate.id === ref.articleId);
      const fact = article?.facts?.find((candidate) => candidate.id === ref.factId);
      return fact ? { kind: "text", text: fact.statement } : { kind: "nothing", why: "that fact is no longer in the article" };
    }

    case "meta":
      return resolveMeta(ref.part, ctx);
  }
}

function resolveArticlePart(article: DocumentArticle, ref: Extract<ContentRef, { kind: "article" }>): Resolved {
  switch (ref.part) {
    case "headline":
      return { kind: "text", text: article.headline };
    case "kicker":
      return article.kicker ? { kind: "text", text: article.kicker } : { kind: "nothing", why: "this story has no kicker" };
    case "standfirst":
      return article.standfirst ? { kind: "text", text: article.standfirst } : { kind: "nothing", why: "this story has no standfirst" };
    case "byline":
      return article.byline ? { kind: "text", text: article.byline } : { kind: "nothing", why: "this story is unsigned" };
    case "pullquote": {
      const quote = article.pullQuotes[0] ?? null;
      if (quote) return { kind: "text", text: quote.text };
      const inline = article.body.find((block) => block.type === "pullquote" || block.type === "testimony");
      return inline ? { kind: "text", text: blockText(inline) } : { kind: "nothing", why: "this story has nothing worth pulling out" };
    }
    case "excerpt": {
      // The short form: the standfirst if there is one, otherwise the opening, cut at a sentence.
      const source = article.standfirst ?? article.body.filter((block) => block.type === "paragraph").map(blockText).join(" ");
      return { kind: "text", text: excerpt(source, 240) };
    }
    case "body": {
      const blocks = ref.blockIds?.length ? article.body.filter((block) => ref.blockIds!.includes(block.id)) : article.body;
      return blocks.length ? { kind: "blocks", blocks } : { kind: "nothing", why: "this story has no body yet" };
    }
  }
}

function resolveMeta(part: Extract<ContentRef, { kind: "meta" }>["part"], ctx: ResolveContext): Resolved {
  const { meta } = ctx.document;
  switch (part) {
    case "masthead":
      return { kind: "text", text: ctx.masthead?.title ?? meta.masthead.title };
    case "tagline":
      return meta.masthead.tagline ? { kind: "text", text: meta.masthead.tagline } : { kind: "nothing", why: "this title has no tagline" };
    case "issueLabel":
      return { kind: "text", text: meta.issueLabel };
    case "date":
      // A publication date is stored as an instant and read by a person: "15 May 2025", never
      // "2025-05-15T10:00:00.000Z", which is what a cover printed before anybody looked at one.
      return { kind: "text", text: formatIsoDate(meta.publicationDate) || meta.label };
    case "editorial":
      return meta.editorial ? { kind: "text", text: meta.editorial } : { kind: "nothing", why: "there is no editor's note" };
    case "credits":
      return meta.credits.length ? { kind: "text", text: meta.credits.map((credit) => `${credit.role}: ${credit.name}`).join(" · ") } : { kind: "nothing", why: "nobody is credited" };
    case "contact":
      return meta.contactEmail ? { kind: "text", text: meta.contactEmail } : { kind: "nothing", why: "there is no contact address" };
    case "website":
      return meta.website ? { kind: "text", text: meta.website } : { kind: "nothing", why: "there is no website" };
    case "toc":
      return { kind: "text", text: ctx.document.toc.map((entry) => entry.text).join(" · ") };
    case "page":
      // Only print knows page numbers, and only after the pagination pass has settled.
      return ctx.page ? { kind: "text", text: String(ctx.page.number) } : { kind: "nothing", why: "page numbers belong to print" };
  }
}

/** A trimmed opening that reads as a summary rather than as a sentence cut off. */
export function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** Whether an element has anything to draw, which is what decides if it is drawn at all. */
export function hasContent(element: DesignElement, ctx: ResolveContext): boolean {
  return resolve(element.content, ctx).kind !== "nothing";
}
