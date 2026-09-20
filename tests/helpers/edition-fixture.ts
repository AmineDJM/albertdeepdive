import type { DocumentArticle, DocumentMedia, EditionDocument } from "@/lib/publication/document";

/**
 * A believable edition, made in one line.
 *
 * The renderers are tested against a document rather than against a mock, because what breaks a
 * renderer is real material: a story with no standfirst, a picture with no alt text, a headline a
 * contributor pasted from a word processor. Every test that needs an edition builds one here, so
 * fixing the shape of a document fixes it everywhere at once.
 */

export function fixtureMedia(id: string, extra: Partial<DocumentMedia> = {}): DocumentMedia {
  const width = extra.width ?? 2400;
  const height = extra.height ?? 1600;
  return {
    id,
    kind: "PHOTO",
    caption: "A caption",
    credit: "A. Photographer",
    altText: "What is in the picture",
    width,
    height,
    aspectRatio: width / height,
    rightsStatus: "GREEN",
    src: { print: { key: id, url: `https://example.test/${id}.jpg`, path: null, width, height }, web: null, thumb: null },
    ...extra,
  };
}

export function fixtureArticle(id: string, extra: Partial<DocumentArticle> = {}): DocumentArticle {
  return {
    id,
    storyId: `st-${id}`,
    sectionId: "s1",
    storyType: "NEWS",
    kicker: "News",
    headline: `Headline ${id}`,
    standfirst: "A standfirst that says what happened.",
    byline: "A. Writer",
    body: [
      { id: `${id}-b1`, type: "paragraph", text: "The first paragraph of the story." },
      { id: `${id}-b2`, type: "crosshead", text: "A crosshead" },
      { id: `${id}-b3`, type: "list", items: ["One", "Two"] },
    ],
    pullQuotes: [{ text: "A line worth pulling out", attribution: "Somebody" }],
    media: [],
    heroMediaId: null,
    tags: [],
    campuses: [],
    wordCount: 600,
    bdd: null,
    sourceIds: [],
    status: "APPROVED",
    eventDateText: null,
    ...extra,
  };
}

export function fixtureEdition(articles: DocumentArticle[], mediaItems: DocumentMedia[] = [], coverArticleId: string | null = null): EditionDocument {
  return {
    schemaVersion: "1",
    meta: {
      editionId: "ed1",
      versionLabel: "v1",
      issueNumber: 1,
      title: "The Review",
      label: "May 2026",
      month: 5,
      year: 2026,
      isSpecialIssue: false,
      issueLabel: "Issue N°1",
      publicationDate: null,
      generatedAt: new Date().toISOString(),
      pageSize: { name: "A4", widthMm: 210, heightMm: 297 },
      masthead: { title: "The Review", tagline: "Every month" },
      cover: { storyId: null, articleId: coverArticleId, headline: null, standfirst: null, mediaId: null, teasers: [] },
      editorial: null,
      credits: [{ role: "Editor", name: "E. Chief" }],
      contactEmail: "hello@example.test",
      website: "example.test",
      campuses: [],
    },
    sections: [{ id: "s1", slug: "news", name: "News", kicker: null, colour: null, sortOrder: 0 }],
    articles,
    media: mediaItems,
    pages: [],
    toc: [],
    references: [],
    warnings: [],
  };
}
