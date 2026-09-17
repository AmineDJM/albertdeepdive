import { describe, expect, it } from "vitest";
import { analyzePages, QUALITY_THRESHOLDS } from "@/server/publication/page-quality";
import type { PageMeasurement } from "@/server/publication/paginate";
import type { EditionDocument } from "@/lib/publication/document";

function page(id: string, number: number, template: string, extra: Partial<EditionDocument["pages"][number]> = {}): EditionDocument["pages"][number] {
  return { id, number, template, sectionId: null, articleIds: [], mediaIds: [], continuationOf: null, isLocked: false, notes: null, ...extra };
}

function doc(pages: EditionDocument["pages"], media: EditionDocument["media"] = []): EditionDocument {
  return {
    schemaVersion: "1",
    meta: {
      editionId: "e1", versionLabel: "v", issueNumber: 1, title: "T", label: "L", month: 1, year: 2026, isSpecialIssue: false,
      issueLabel: "Issue N°1", publicationDate: null, generatedAt: new Date().toISOString(),
      pageSize: { name: "A4", widthMm: 210, heightMm: 297 }, masthead: { title: "T", tagline: null },
      cover: { storyId: null, articleId: null, headline: null, standfirst: null, mediaId: null, teasers: [] },
      editorial: null, credits: [], contactEmail: null, website: null, campuses: [],
    },
    sections: [], articles: [], media, pages, toc: [], references: [], warnings: [],
  };
}

function measure(pageId: string, number: number, template: string, opts: { occupancy: number; tailGap?: number; fill?: number | null; overflow?: boolean; orphans?: number; widows?: number; blank?: boolean }): PageMeasurement {
  const fill = opts.fill === undefined ? 1 : opts.fill;
  return {
    pageId, number, template,
    flows:
      fill === null
        ? []
        : [{ flow: `${pageId}:a`, pageId, articleId: "a", cols: 2, blocks: [], overflow: !!opts.overflow, fillRatio: fill, extentRatio: 1, fitLevel: 0, slackRatio: 1 - fill, orphans: opts.orphans ?? 0, widows: opts.widows ?? 0 }],
    blank: !!opts.blank,
    textLength: 500,
    imageCount: 0,
    imagesFailed: [],
    density: { occupancy: opts.occupancy, tailGapRatio: opts.tailGap ?? 0, sheetHeight: 1000, contentBottom: 1000 * (1 - (opts.tailGap ?? 0)) },
  };
}

describe("page quality analysis", () => {
  it("passes a dense editorial page with no issues", () => {
    const report = analyzePages(doc([page("p1", 1, "ARTICLE_TWO_COLUMN")]), [measure("p1", 1, "ARTICLE_TWO_COLUMN", { occupancy: 0.9 })]);
    expect(report.ok).toBe(true);
    expect(report.pages[0].issues).toHaveLength(0);
    expect(report.pages[0].emptySpaceRatio).toBeCloseTo(0.1, 5);
  });

  it("hard-fails a sparse continuation page even when its flow reports full", () => {
    // The real defect: a continuation's balanced flow shrinks to its content and reads 100 % full.
    const report = analyzePages(
      doc([page("c1", 2, "CONTINUATION", { isContinuation: true, continuationOfPageId: "p1" })]),
      [measure("c1", 2, "CONTINUATION", { occupancy: 0.22, tailGap: 0.74, fill: 1 })],
    );
    expect(report.ok).toBe(false);
    expect(report.pages[0].issues.map((i) => i.code)).toContain("SPARSE_CONTINUATION");
    expect(report.failingPages).toEqual([2]);
  });

  it("hard-fails overflow and blank pages", () => {
    const report = analyzePages(
      doc([page("p1", 1, "ARTICLE_TWO_COLUMN"), page("p2", 2, "ARTICLE_TWO_COLUMN")]),
      [measure("p1", 1, "ARTICLE_TWO_COLUMN", { occupancy: 0.9, overflow: true }), measure("p2", 2, "ARTICLE_TWO_COLUMN", { occupancy: 0, blank: true, fill: null })],
    );
    expect(report.hardFailures).toBe(2);
    expect(report.overflowPages).toEqual([1]);
    expect(report.pages[1].issues.map((i) => i.code)).toContain("BLANK_PAGE");
  });

  it("exempts pages that are sparse by design", () => {
    const report = analyzePages(
      doc([page("p1", 1, "COVER_A"), page("p2", 2, "QUOTE_PAGE"), page("p3", 3, "SECTION_OPENER")]),
      [
        measure("p1", 1, "COVER_A", { occupancy: 0.3, tailGap: 0.6, fill: null }),
        measure("p2", 2, "QUOTE_PAGE", { occupancy: 0.2, tailGap: 0.7, fill: null }),
        measure("p3", 3, "SECTION_OPENER", { occupancy: 0.25, tailGap: 0.65, fill: null }),
      ],
    );
    expect(report.ok).toBe(true);
    expect(report.softWarnings).toBe(0);
  });

  it("hard-fails an accidentally empty editorial page and an under-set flow", () => {
    const report = analyzePages(
      doc([page("p1", 1, "SHORTS")]),
      [measure("p1", 1, "SHORTS", { occupancy: 0.5, tailGap: 0.4, fill: 0.6 })],
    );
    const codes = report.pages[0].issues.map((i) => i.code);
    expect(codes).toContain("UNDERFULL_PAGE");
    expect(codes).toContain("UNDERSET_FLOW");
    expect(report.ok).toBe(false);
  });

  it("downgrades density to a warning on pages allowed to breathe", () => {
    // A back page or contents page may run loose without failing the issue.
    const report = analyzePages(
      doc([page("p1", 1, "BACK_PAGE")]),
      [measure("p1", 1, "BACK_PAGE", { occupancy: 0.6, tailGap: 0.35, fill: 0.95 })],
    );
    expect(report.ok).toBe(true);
    expect(report.pages[0].issues.map((i) => i.code)).toContain("LOOSE_PAGE");
  });

  it("warns about a run of identical templates and repeated images", () => {
    const pages = [1, 2, 3].map((n) => page(`p${n}`, n, "ARTICLE_TWO_COLUMN", { mediaIds: ["m1"] }));
    const media = [{ id: "m1", kind: "photo", caption: null, credit: null, altText: null, width: 800, height: 600, aspectRatio: 1.33, rightsStatus: "GREEN" as const, src: { print: null, web: null, thumb: null } }];
    const report = analyzePages(doc(pages, media), pages.map((p) => measure(p.id, p.number, "ARTICLE_TWO_COLUMN", { occupancy: 0.9 })));
    const third = report.pages[2].issues.map((i) => i.code);
    expect(third).toContain("REPEATED_TEMPLATE");
    expect(third).toContain("REPEATED_IMAGE");
    expect(third).toContain("LOW_RES_IMAGE");
  });

  it("averages occupancy over editorial pages only", () => {
    const report = analyzePages(
      doc([page("p1", 1, "COVER_A"), page("p2", 2, "ARTICLE_TWO_COLUMN")]),
      [measure("p1", 1, "COVER_A", { occupancy: 0.2, fill: null }), measure("p2", 2, "ARTICLE_TWO_COLUMN", { occupancy: 0.9 })],
    );
    expect(report.averageOccupancy).toBeCloseTo(0.9, 3);
    expect(QUALITY_THRESHOLDS.targetOccupancy.min).toBe(0.8);
  });
});
