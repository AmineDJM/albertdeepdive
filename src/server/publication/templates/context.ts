import type { DocumentArticle, DocumentMedia, DocumentPage, EditionDocument } from "@/lib/publication/document";
import { monthName } from "@/lib/publication/text";
import type { MediaResolver } from "./blocks";

/**
 * Everything a page template needs besides the page itself: the document, lookups, the media
 * source resolver (data URIs for the PDF pass, signed URLs for the on-screen preview) and the
 * page-number index used for jump lines, contents and cover teasers.
 */
export type AssetMode = "print" | "preview";

export type TemplateContext = {
  doc: EditionDocument;
  mode: AssetMode;
  article: (id: string) => DocumentArticle | undefined;
  articlesOf: (page: DocumentPage) => DocumentArticle[];
  media: (id: string | null | undefined) => DocumentMedia | undefined;
  section: (id: string | null | undefined) => EditionDocument["sections"][number] | undefined;
  sectionOfPage: (page: DocumentPage) => EditionDocument["sections"][number] | undefined;
  /** First page number on which an article appears. */
  pageOfArticle: (articleId: string) => number | null;
  /** Number of the page that continues a given page (if any). */
  continuationOf: (pageId: string) => DocumentPage | undefined;
  pageById: (pageId: string) => DocumentPage | undefined;
  resolver: MediaResolver;
  /** Src for an <img> (data URI or URL) — null when the file is unavailable. */
  src: (media: DocumentMedia | undefined) => string | null;
  monthLabel: string;
  /** Pages of the same article that are "flowing" templates (used to avoid repeating a body). */
  flowPagesOfArticle: (articleId: string) => DocumentPage[];
  /** Media ids rendered so far (pages render in order, so a continuation page knows what its source page showed). */
  used: Set<string>;
};

export type AssetSource = (media: DocumentMedia) => string | null;

export const FLOW_TEMPLATES = new Set([
  "ARTICLE_HERO",
  "ARTICLE_TWO_COLUMN",
  "ARTICLE_THREE_COLUMN",
  "INTERVIEW",
  "PROFILE",
  "BDD_CASE",
  "NEWS_GRID",
  "SHORTS",
  "EVENT",
  "BACK_PAGE",
  "CONTINUATION",
  "PHOTO_STORY",
]);

export function createTemplateContext(doc: EditionDocument, mode: AssetMode, assetSource: AssetSource): TemplateContext {
  const articleById = new Map(doc.articles.map((a) => [a.id, a]));
  const mediaById = new Map(doc.media.map((m) => [m.id, m]));
  const sectionById = new Map(doc.sections.map((s) => [s.id, s]));
  const pageById = new Map(doc.pages.map((p) => [p.id, p]));
  const firstPage = new Map<string, number>();
  const pagesOfArticle = new Map<string, DocumentPage[]>();
  for (const page of doc.pages) {
    for (const id of page.articleIds) {
      if (!firstPage.has(id)) firstPage.set(id, page.number);
      pagesOfArticle.set(id, [...(pagesOfArticle.get(id) ?? []), page]);
    }
  }
  const continuation = new Map<string, DocumentPage>();
  for (const page of doc.pages) {
    if (page.continuationOfPageId && !continuation.has(page.continuationOfPageId)) continuation.set(page.continuationOfPageId, page);
  }
  const src = (media: DocumentMedia | undefined) => (media ? assetSource(media) : null);
  const resolver: MediaResolver = { media: (id) => mediaById.get(id), src: (media) => assetSource(media) };
  return {
    doc,
    mode,
    article: (id) => articleById.get(id),
    articlesOf: (page) => page.articleIds.map((id) => articleById.get(id)).filter((a): a is DocumentArticle => !!a),
    media: (id) => (id ? mediaById.get(id) : undefined),
    section: (id) => (id ? sectionById.get(id) : undefined),
    sectionOfPage: (page) => {
      if (page.sectionId && sectionById.has(page.sectionId)) return sectionById.get(page.sectionId);
      const first = page.articleIds.map((id) => articleById.get(id)).find((a) => a?.sectionId);
      return first?.sectionId ? sectionById.get(first.sectionId) : undefined;
    },
    pageOfArticle: (id) => firstPage.get(id) ?? null,
    continuationOf: (pageId) => continuation.get(pageId),
    pageById: (id) => pageById.get(id),
    resolver,
    src,
    monthLabel: `${monthName(doc.meta.month)} ${doc.meta.year}`,
    flowPagesOfArticle: (id) => (pagesOfArticle.get(id) ?? []).filter((p) => FLOW_TEMPLATES.has(p.template)),
    used: new Set<string>(),
  };
}
