import { describe, expect, it } from "vitest";
import type { DocumentArticle, DocumentMedia, DocumentPage, EditionDocument } from "@/lib/publication/document";
import { ISSUE_CODES, exportBlockers, layoutReportAsValidation, validateEditionDocument } from "@/server/publication/validate";
import type { LayoutReport } from "@/server/publication/paginate";

/** Synthetic documents (no database) exercising every validation rule. */

function media(id: string, overrides: Partial<DocumentMedia> = {}): DocumentMedia {
  const src = { key: `media/${id}/print.jpg`, url: `http://x/${id}`, path: null, width: 2400, height: 1600 };
  return {
    id,
    kind: "photo",
    caption: `Caption ${id}`,
    credit: `© ${id}`,
    altText: null,
    width: 2400,
    height: 1600,
    aspectRatio: 1.5,
    rightsStatus: "GREEN",
    fileName: `${id}.jpg`,
    src: { print: src, web: { ...src, key: `media/${id}/web.webp`, width: 1600, height: 1067 }, thumb: null },
    ...overrides,
  };
}

function article(id: string, overrides: Partial<DocumentArticle> = {}): DocumentArticle {
  return {
    id,
    storyId: `story-${id}`,
    sectionId: "sec-a",
    storyType: "SCHOOL_NEWS",
    kicker: "Kicker",
    headline: `Headline ${id}`,
    standfirst: "Standfirst.",
    byline: "Milan Viallet",
    body: [{ id: `${id}-p1`, type: "paragraph", text: "One sentence. Another sentence here." }],
    pullQuotes: [],
    media: [{ mediaId: "m1", role: "hero", sortOrder: 0 }],
    heroMediaId: "m1",
    tags: [],
    campuses: ["Paris"],
    wordCount: 6,
    bdd: null,
    sourceIds: ["sub-1"],
    status: "APPROVED",
    eventDateText: null,
    storyTitle: `Story ${id}`,
    facts: [],
    ...overrides,
  };
}

function page(id: string, number: number, overrides: Partial<DocumentPage> = {}): DocumentPage {
  return { id, number, template: "ARTICLE_TWO_COLUMN", sectionId: "sec-a", articleIds: [], mediaIds: [], continuationOf: null, isLocked: false, notes: null, ...overrides };
}

function baseDocument(): EditionDocument {
  const a1 = article("a1");
  const a2 = article("a2", { media: [{ mediaId: "m2", role: "hero", sortOrder: 0 }], heroMediaId: "m2", sectionId: "sec-b" });
  return {
    schemaVersion: "1",
    meta: {
      editionId: "ed-1",
      versionLabel: "v0.1",
      issueNumber: 1,
      title: "Test issue",
      label: "May 2025",
      month: 5,
      year: 2025,
      isSpecialIssue: true,
      issueLabel: "Special issue N°1",
      publicationDate: null,
      generatedAt: "2025-05-01T00:00:00.000Z",
      pageSize: { name: "A4", widthMm: 210, heightMm: 297 },
      masthead: { title: "Albert's Deep Dive", tagline: null },
      cover: { storyId: "story-a1", articleId: "a1", headline: "Cover headline", standfirst: null, mediaId: "m1", teasers: [] },
      editorial: null,
      credits: [{ role: "Editor in chief", name: "Milan Viallet" }],
      contactEmail: null,
      website: null,
      campuses: [],
    },
    sections: [
      { id: "sec-cover", slug: "cover", name: "Cover", kicker: null, colour: null, sortOrder: 0 },
      { id: "sec-a", slug: "actus", name: "Albert Actus", kicker: "School news", colour: "#1F6FB2", sortOrder: 1 },
      { id: "sec-b", slug: "campus-life", name: "Campus Life", kicker: null, colour: "#E4572E", sortOrder: 2 },
      { id: "sec-c", slug: "events", name: "Events", kicker: null, colour: null, sortOrder: 3 },
    ],
    articles: [a1, a2],
    media: [media("m1"), media("m2")],
    pages: [
      page("p1", 1, { template: "COVER_A", sectionId: "sec-cover", mediaIds: ["m1"] }),
      page("p2", 2, { articleIds: ["a1"] }),
      page("p3", 3, { articleIds: ["a2"], sectionId: "sec-b" }),
    ],
    toc: [
      { page: 2, sectionName: "Albert Actus", text: "Headline a1", articleId: "a1" },
      { page: 3, sectionName: "Campus Life", text: "Headline a2", articleId: "a2" },
    ],
    references: [],
    warnings: [],
  };
}

const codes = (doc: EditionDocument, kind: "DRAFT" | "FINAL_REVIEW" = "DRAFT") => validateEditionDocument(doc, { kind }).issues.map((i) => `${i.severity}:${i.code}`);

describe("validateEditionDocument", () => {
  it("accepts a clean document (only the empty-section info)", () => {
    const report = validateEditionDocument(baseDocument(), { kind: "FINAL_REVIEW" });
    expect(report.ok).toBe(true);
    expect(report.issues.map((i) => i.code)).toEqual([ISSUE_CODES.SECTION_EMPTY]);
    expect(report.issues[0].entityId).toBe("sec-c");
    expect(report.pageCount).toBe(3);
    expect(report.stats).toMatchObject({ errors: 0, warnings: 0, infos: 1, articles: 2, pages: 3 });
  });

  it("flags RED rights as an error that blocks every kind, YELLOW as a warning", () => {
    const doc = baseDocument();
    doc.media[0].rightsStatus = "RED";
    doc.media[1].rightsStatus = "YELLOW";
    const report = validateEditionDocument(doc, { kind: "DRAFT" });
    expect(codes(doc)).toContain(`error:${ISSUE_CODES.RED_RIGHTS}`);
    expect(codes(doc)).toContain(`warning:${ISSUE_CODES.YELLOW_RIGHTS}`);
    expect(exportBlockers(report, "DRAFT").map((i) => i.code)).toEqual([ISSUE_CODES.RED_RIGHTS]);
  });

  it("reports missing captions, credits, files and low-resolution heroes", () => {
    const doc = baseDocument();
    doc.media[0] = media("m1", { caption: null, credit: null, photographer: null, src: { print: null, web: null, thumb: null } });
    doc.media[1] = media("m2", { src: { print: { key: "k", url: "u", path: null, width: 800, height: 600 }, web: null, thumb: null } });
    const c = codes(doc);
    expect(c).toContain(`warning:${ISSUE_CODES.MISSING_CAPTION}`);
    expect(c).toContain(`info:${ISSUE_CODES.MISSING_CREDIT}`);
    expect(c).toContain(`error:${ISSUE_CODES.MISSING_IMAGE_FILE}`);
    expect(c).toContain(`warning:${ISSUE_CODES.LOW_RES_HERO}`);
  });

  it("treats unapproved articles as warnings for drafts and errors for final review", () => {
    const doc = baseDocument();
    doc.articles[0].status = "IN_EDITING";
    expect(codes(doc, "DRAFT")).toContain(`warning:${ISSUE_CODES.ARTICLE_NOT_APPROVED}`);
    expect(codes(doc, "FINAL_REVIEW")).toContain(`error:${ISSUE_CODES.ARTICLE_NOT_APPROVED}`);
    const final = validateEditionDocument(doc, { kind: "FINAL_REVIEW" });
    expect(exportBlockers(final, "FINAL_REVIEW").length).toBe(1);
    expect(exportBlockers(validateEditionDocument(doc, { kind: "DRAFT" }), "DRAFT").length).toBe(0);
  });

  it("checks article content: empty body, long headline, standfirst, byline, conflicts and sources", () => {
    const doc = baseDocument();
    doc.articles[0] = article("a1", {
      body: [],
      wordCount: 0,
      headline: "x".repeat(95),
      standfirst: null,
      byline: null,
      sourceIds: [],
      facts: [{ id: "f1", statement: "Spelling differs", status: "DISPUTED", confidence: "CONFLICTING", conflictGroup: "g" }],
    });
    const c = codes(doc);
    expect(c).toContain(`error:${ISSUE_CODES.EMPTY_ARTICLE}`);
    expect(c).toContain(`warning:${ISSUE_CODES.HEADLINE_TOO_LONG}`);
    expect(c).toContain(`info:${ISSUE_CODES.MISSING_STANDFIRST}`);
    expect(c).toContain(`info:${ISSUE_CODES.MISSING_BYLINE}`);
    expect(c).toContain(`error:${ISSUE_CODES.UNRESOLVED_CONFLICT}`);
    expect(c).toContain(`warning:${ISSUE_CODES.MISSING_SOURCE}`);
  });

  it("checks pages: empty pages, duplicates, numbering, contents and cover", () => {
    const doc = baseDocument();
    doc.pages.push(page("p4", 5, { articleIds: [] }));
    doc.pages.push(page("p5", 6, { articleIds: ["a1"] }));
    doc.pages.push(page("p6", 7, { articleIds: ["a2"], template: "BDD_VISUAL" }));
    doc.meta.cover.headline = null;
    const issues = validateEditionDocument(doc, { kind: "DRAFT" }).issues;
    const byCode = (code: string) => issues.filter((i) => i.code === code);
    expect(byCode(ISSUE_CODES.PAGE_WITHOUT_CONTENT)).toHaveLength(1);
    expect(byCode(ISSUE_CODES.PAGE_NUMBERS_INCONSISTENT).length).toBeGreaterThan(0);
    expect(byCode(ISSUE_CODES.DUPLICATE_ARTICLE_ON_PAGES).map((i) => i.severity).sort()).toEqual(["info", "warning"]);
    expect(byCode(ISSUE_CODES.COVER_MISSING)).toHaveLength(1);
    doc.toc = [];
    expect(codes(doc)).toContain(`error:${ISSUE_CODES.TOC_MISMATCH}`);
    doc.pages = doc.pages.filter((p) => !p.template.startsWith("COVER"));
    expect(validateEditionDocument(doc, { kind: "DRAFT" }).issues.filter((i) => i.code === ISSUE_CODES.COVER_MISSING).length).toBe(2);
  });

  it("passes builder warnings through with the right severities", () => {
    const doc = baseDocument();
    doc.warnings = [
      { code: "MISSING_MEDIA_FILE", severity: "error", message: "gone", entityId: "m1" },
      { code: "ARTICLE_EXCLUDED", severity: "warning", message: "excluded", entityId: "a9" },
      { code: "STORY_NOT_ON_PLAN", severity: "info", message: "orphan", entityId: "s9" },
    ];
    const draft = codes(doc, "DRAFT");
    expect(draft).toContain(`error:${ISSUE_CODES.MISSING_IMAGE_FILE}`);
    expect(draft).toContain(`warning:${ISSUE_CODES.ARTICLE_EXCLUDED}`);
    expect(draft).toContain(`info:${ISSUE_CODES.STORY_NOT_ON_PLAN}`);
    expect(codes(doc, "FINAL_REVIEW")).toContain(`error:${ISSUE_CODES.ARTICLE_EXCLUDED}`);
  });

  it("orders issues by severity then page", () => {
    const doc = baseDocument();
    doc.media[1].rightsStatus = "YELLOW";
    doc.articles[0].facts = [{ id: "f", statement: "x", status: "DISPUTED", confidence: "CONFLICTING", conflictGroup: null }];
    const issues = validateEditionDocument(doc, { kind: "DRAFT" }).issues;
    expect(issues[0].severity).toBe("error");
    expect(issues[issues.length - 1].severity).toBe("info");
  });
});

describe("layoutReportAsValidation", () => {
  it("maps overflow, blank pages and failed images to errors and underfull continuations to info", () => {
    const report: LayoutReport = {
      ok: false,
      pages: 5,
      plannedPages: 4,
      continuationPagesAdded: 1,
      blocksMoved: 3,
      paragraphsSplit: 1,
      copyfitFlows: 2,
      rounds: 3,
      remainingOverflow: [{ page: 2, pageId: "p2", articleId: "a1", blocks: ["b1"] }],
      blankPages: [4],
      underfilled: [],
      imagesFailed: [{ page: 1, mediaId: "m1" }],
      fit: [{ page: 5, pageId: "c1", template: "CONTINUATION", articleId: "a1", ratio: 0.1 }],
      engine: "test",
    };
    const v = layoutReportAsValidation(report);
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.code)).toEqual([ISSUE_CODES.TEXT_OVERFLOW, ISSUE_CODES.BLANK_PAGE, ISSUE_CODES.IMAGE_FAILED, ISSUE_CODES.CONTINUATION_UNDERFULL]);
    expect(v.stats).toMatchObject({ pages: 5, continuationPagesAdded: 1, copyfitFlows: 2 });
    expect(v.pageCount).toBe(5);
  });
});
