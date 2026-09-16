import { z } from "zod";

/**
 * Canonical publication model. Built once from the database (`buildEditionDocument`) and consumed by
 * BOTH the PDF (HTML/CSS + Chromium) and the DOCX renderers. Content and layout are separated:
 * articles carry typed blocks; pages carry the plan (template + what goes on the page).
 */

export const articleBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("paragraph"), text: z.string(), sources: z.array(z.string()).optional() }),
  z.object({ id: z.string(), type: z.literal("crosshead"), text: z.string() }),
  z.object({ id: z.string(), type: z.literal("pullquote"), text: z.string(), attribution: z.string().optional(), sources: z.array(z.string()).optional() }),
  z.object({ id: z.string(), type: z.literal("list"), items: z.array(z.string()), ordered: z.boolean().optional(), sources: z.array(z.string()).optional() }),
  z.object({ id: z.string(), type: z.literal("image"), assetId: z.string(), caption: z.string().optional(), credit: z.string().optional(), size: z.enum(["inline", "wide", "full"]).optional() }),
  z.object({ id: z.string(), type: z.literal("box"), title: z.string().optional(), items: z.array(z.string()).optional(), text: z.string().optional(), sources: z.array(z.string()).optional() }),
  z.object({ id: z.string(), type: z.literal("qa"), question: z.string(), answer: z.string(), sources: z.array(z.string()).optional() }),
  z.object({ id: z.string(), type: z.literal("testimony"), text: z.string(), speaker: z.string().optional(), sources: z.array(z.string()).optional() }),
  z.object({ id: z.string(), type: z.literal("divider") }),
]);
export type ArticleBlock = z.infer<typeof articleBlockSchema>;

export const documentMediaSchema = z.object({
  id: z.string(),
  kind: z.string(),
  caption: z.string().nullable(),
  credit: z.string().nullable(),
  altText: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  aspectRatio: z.number().nullable(),
  rightsStatus: z.enum(["GREEN", "YELLOW", "RED"]),
  fileName: z.string().optional(),
  photographer: z.string().nullable().optional(),
  src: z.object({
    print: z.object({ key: z.string(), url: z.string(), path: z.string().nullable(), width: z.number(), height: z.number() }).nullable(),
    web: z.object({ key: z.string(), url: z.string(), path: z.string().nullable(), width: z.number(), height: z.number() }).nullable(),
    thumb: z.object({ key: z.string(), url: z.string(), path: z.string().nullable(), width: z.number(), height: z.number() }).nullable(),
  }),
});
export type DocumentMedia = z.infer<typeof documentMediaSchema>;

export const documentBddSchema = z.object({
  companyName: z.string(),
  cohortLabel: z.string().nullable(),
  dateText: z.string().nullable(),
  theCase: z.string().nullable(),
  theData: z.string().nullable(),
  theChallenge: z.string().nullable(),
  theApproach: z.string().nullable(),
  theMethods: z.string().nullable(),
  theSolution: z.string().nullable(),
  theResults: z.string().nullable(),
  keyTakeaways: z.array(z.string()),
  winningTeam: z.array(z.object({ name: z.string(), program: z.string().optional(), campus: z.string().optional() })),
  finalists: z.array(z.array(z.object({ name: z.string(), program: z.string().optional(), campus: z.string().optional() }))),
  jury: z.array(z.object({ name: z.string(), role: z.string().optional(), organisation: z.string().optional() })),
  technologies: z.array(z.string()),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })),
  logoMediaId: z.string().nullable(),
  teamPhotoMediaId: z.string().nullable(),
  dashboardMediaId: z.string().nullable(),
  diagramMediaId: z.string().nullable(),
});
export type DocumentBdd = z.infer<typeof documentBddSchema>;

/** Fact statuses travel with the article so that validation can flag unresolved conflicts (additive). */
export const documentFactSchema = z.object({
  id: z.string(),
  statement: z.string(),
  status: z.string(), // ACTIVE | DISPUTED | RESOLVED | REJECTED
  confidence: z.string(),
  conflictGroup: z.string().nullable(),
});
export type DocumentFact = z.infer<typeof documentFactSchema>;

/** Event satellite (WHY / WITH WHOM / WHERE AND WHEN pages, community listings). */
export const documentEventSchema = z.object({
  title: z.string(),
  dateText: z.string().nullable(),
  location: z.string().nullable(),
  organiser: z.string().nullable(),
  signupUrl: z.string().nullable(),
  isUpcoming: z.boolean(),
});
export type DocumentEvent = z.infer<typeof documentEventSchema>;

/**
 * Which blocks of an article are placed on a page once the layout pass has run. `fragments` holds
 * derived blocks (a long paragraph split at a sentence boundary) whose ids appear in `blockIds`;
 * the canonical article body is never modified by layout.
 */
export const pageSliceSchema = z.object({
  articleId: z.string(),
  blockIds: z.array(z.string()),
  fragments: z.array(articleBlockSchema).optional(),
  /** Copyfit level (0–3): each step shrinks the flow's type by 2.5% before text spills to a continuation page. */
  fit: z.number().optional(),
});
export type PageSlice = z.infer<typeof pageSliceSchema>;

export const documentArticleSchema = z.object({
  id: z.string(),
  storyId: z.string(),
  sectionId: z.string().nullable(),
  storyType: z.string(),
  kicker: z.string().nullable(),
  headline: z.string(),
  standfirst: z.string().nullable(),
  byline: z.string().nullable(),
  body: z.array(articleBlockSchema),
  pullQuotes: z.array(z.object({ text: z.string(), attribution: z.string().nullable() })),
  media: z.array(z.object({ mediaId: z.string(), role: z.string(), sortOrder: z.number() })),
  heroMediaId: z.string().nullable(),
  tags: z.array(z.string()),
  campuses: z.array(z.string()),
  wordCount: z.number(),
  bdd: documentBddSchema.nullable(),
  sourceIds: z.array(z.string()),
  status: z.string(),
  eventDateText: z.string().nullable(),
  // ── additive (optional) ──
  storyTitle: z.string().optional(),
  storySlug: z.string().optional(),
  storyStatus: z.string().optional(),
  facts: z.array(documentFactSchema).optional(),
  event: documentEventSchema.nullable().optional(),
});
export type DocumentArticle = z.infer<typeof documentArticleSchema>;

export const documentPageSchema = z.object({
  id: z.string(),
  number: z.number(),
  template: z.string(),
  sectionId: z.string().nullable(),
  articleIds: z.array(z.string()),
  mediaIds: z.array(z.string()),
  continuationOf: z.number().nullable(),
  isLocked: z.boolean(),
  notes: z.string().nullable(),
  // ── additive (optional) ──
  continuationOfPageId: z.string().nullable().optional(),
  isContinuation: z.boolean().optional(),
  storyIds: z.array(z.string()).optional(),
  slices: z.array(pageSliceSchema).optional(),
});
export type DocumentPage = z.infer<typeof documentPageSchema>;

export const editionDocumentSchema = z.object({
  schemaVersion: z.literal("1"),
  meta: z.object({
    editionId: z.string(),
    versionLabel: z.string(),
    issueNumber: z.number(),
    title: z.string(),
    label: z.string(),
    month: z.number(),
    year: z.number(),
    isSpecialIssue: z.boolean(),
    issueLabel: z.string(), // e.g. "Special issue N°1" or "Issue N°5"
    publicationDate: z.string().nullable(),
    generatedAt: z.string(),
    pageSize: z.object({ name: z.string(), widthMm: z.number(), heightMm: z.number() }),
    masthead: z.object({ title: z.string(), tagline: z.string().nullable() }),
    cover: z.object({
      storyId: z.string().nullable(),
      articleId: z.string().nullable(),
      headline: z.string().nullable(),
      standfirst: z.string().nullable(),
      mediaId: z.string().nullable(),
      teasers: z.array(z.object({ articleId: z.string(), line: z.string(), page: z.number().nullable() })),
    }),
    editorial: z.string().nullable(),
    credits: z.array(z.object({ role: z.string(), name: z.string() })),
    contactEmail: z.string().nullable(),
    website: z.string().nullable(),
    campuses: z.array(z.object({ id: z.string(), name: z.string() })),
    // ── additive (optional) ──
    social: z.object({ instagram: z.string().nullable() }).optional(),
    editionStatus: z.string().optional(),
    planId: z.string().nullable().optional(),
    planStatus: z.string().nullable().optional(),
    slug: z.string().optional(),
    layout: z
      .object({ paginatedAt: z.string(), continuationPages: z.number(), engine: z.string() })
      .optional(),
  }),
  sections: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), kicker: z.string().nullable(), colour: z.string().nullable(), sortOrder: z.number() })),
  articles: z.array(documentArticleSchema),
  media: z.array(documentMediaSchema),
  pages: z.array(documentPageSchema),
  toc: z.array(z.object({ page: z.number(), sectionName: z.string(), text: z.string(), articleId: z.string() })),
  references: z.array(z.object({ articleId: z.string(), url: z.string(), label: z.string().nullable() })),
  warnings: z.array(z.object({ code: z.string(), severity: z.enum(["error", "warning", "info"]), message: z.string(), page: z.number().optional(), entityId: z.string().optional() })),
});

export type EditionDocument = z.infer<typeof editionDocumentSchema>;

export const PAGE_SIZES = {
  A4: { name: "A4", widthMm: 210, heightMm: 297 },
  TABLOID: { name: "Tabloid", widthMm: 279, heightMm: 432 },
  LETTER: { name: "Letter", widthMm: 216, heightMm: 279 },
} as const;

export function blockText(block: ArticleBlock): string {
  switch (block.type) {
    case "paragraph":
    case "crosshead":
    case "pullquote":
    case "testimony":
      return block.text;
    case "list":
      return block.items.join(" ");
    case "box":
      return [block.title, block.text, ...(block.items ?? [])].filter(Boolean).join(" ");
    case "qa":
      return `${block.question} ${block.answer}`;
    case "image":
      return block.caption ?? "";
    case "divider":
      return "";
  }
}

export function countWords(blocks: ArticleBlock[]): number {
  return blocks.reduce((n, b) => n + (blockText(b).trim() ? blockText(b).trim().split(/\s+/).length : 0), 0);
}

export function plainText(blocks: ArticleBlock[]): string {
  return blocks.map(blockText).filter(Boolean).join("\n\n");
}

export function newBlockId() {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

/** Split plain text (paragraphs separated by blank lines) into paragraph blocks. */
export function paragraphsToBlocks(text: string, sources?: string[]): ArticleBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ id: newBlockId(), type: "paragraph" as const, text: p, sources }));
}
