import { describe, expect, it } from "vitest";
import { compareLabels, nextVersionLabel } from "@/lib/publication/labels";
import { fileSlug, humanList, issueLabelFor, monthName, splitParagraphAtSentence, splitSentences } from "@/lib/publication/text";
import type { EditionDocument } from "@/lib/publication/document";
import { applyMeasurements, rebuildToc, renumberPages, resetLayout, type PageMeasurement } from "@/server/publication/paginate";
import { escapeHtml, html, join, raw } from "@/server/publication/templates/html";
import { checkXmlWellFormed } from "@/server/publication/zip";

describe("sentence splitting", () => {
  it("splits on terminators and keeps abbreviations, initials and decimals together", () => {
    expect(splitSentences("Hello there. How are you? Fine!")).toEqual(["Hello there.", "How are you?", "Fine!"]);
    expect(splitSentences("Dr. Smith arrived at 10.30. He left.")).toEqual(["Dr. Smith arrived at 10.30.", "He left."]);
    expect(splitSentences("Our model predicts +0.4% per shop. It respects constraints.")).toEqual(["Our model predicts +0.4% per shop.", "It respects constraints."]);
    expect(splitSentences("J. Pastore won. Then A. Piron spoke.")).toEqual(["J. Pastore won.", "Then A. Piron spoke."]);
    expect(splitSentences("\"Sign up here!\" she said. Everyone came.")).toEqual(["\"Sign up here!\" she said.", "Everyone came."]);
  });

  it("handles a single sentence and empty text", () => {
    expect(splitSentences("No terminator at all")).toEqual(["No terminator at all"]);
    expect(splitSentences("")).toEqual([]);
  });

  it("splits a paragraph keeping the first N sentences", () => {
    const text = "One. Two. Three. Four.";
    expect(splitParagraphAtSentence(text, 2)).toEqual({ head: "One. Two.", tail: "Three. Four." });
    expect(splitParagraphAtSentence(text, 0)).toEqual({ head: "", tail: "One. Two. Three. Four." });
    expect(splitParagraphAtSentence(text, 9)).toEqual({ head: "One. Two. Three. Four.", tail: "" });
  });
});

describe("labels and text helpers", () => {
  it("sequences draft labels globally and published labels by major", () => {
    expect(nextVersionLabel("DRAFT", [])).toEqual({ label: "v0.1", sequence: 1 });
    const existing = [
      { kind: "DRAFT", sequence: 1, label: "v0.1" },
      { kind: "EDITORIAL_REVIEW", sequence: 2, label: "v0.2" },
    ];
    expect(nextVersionLabel("FINAL_REVIEW", existing)).toEqual({ label: "v0.3", sequence: 3 });
    expect(nextVersionLabel("PUBLISHED", existing)).toEqual({ label: "v1.0", sequence: 3 });
    expect(nextVersionLabel("PUBLISHED", [...existing, { kind: "PUBLISHED", sequence: 3, label: "v1.0" }])).toEqual({ label: "v2.0", sequence: 4 });
    expect(nextVersionLabel("DRAFT", [...existing, { kind: "PUBLISHED", sequence: 3, label: "v1.0" }])).toEqual({ label: "v0.4", sequence: 4 });
  });

  it("compares labels numerically", () => {
    expect(["v0.12", "v1.0", "v0.2"].sort(compareLabels)).toEqual(["v0.2", "v0.12", "v1.0"]);
  });

  it("formats issue labels, months, lists and slugs", () => {
    expect(issueLabelFor(1, true)).toBe("Special issue N°1");
    expect(issueLabelFor(5, false)).toBe("Issue N°5");
    expect(monthName(5)).toBe("May");
    expect(humanList(["A", "B", "C"])).toBe("A, B and C");
    expect(humanList(["A"])).toBe("A");
    expect(fileSlug("Albert's Deep Dive — Special issue N°1 / May 2025")).toBe("albert-s-deep-dive-special-issue-n-1-may-2025");
  });
});

describe("html helper", () => {
  it("escapes interpolated values and keeps raw/nested html", () => {
    const name = "<b>Tom & \"Jerry\"</b>";
    const out = html`<p class="${name}">${name} ${raw("<i>ok</i>")} ${[1, 2].map((n) => html`<span>${n}</span>`)}</p>`.value;
    expect(out).toBe('<p class="&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;">&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt; <i>ok</i> <span>1</span><span>2</span></p>');
    expect(html`${null}${undefined}${false}${true}`.value).toBe("");
    expect(join([html`a`, html`b`], ", ").value).toBe("a, b");
    expect(escapeHtml("'")).toBe("&#39;");
  });
});

describe("xml well-formedness check", () => {
  it("accepts well-formed XML and rejects broken markup", () => {
    expect(checkXmlWellFormed('<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p w:id="1"/><w:p>a &amp; b</w:p></w:body></w:document>').ok).toBe(true);
    expect(checkXmlWellFormed("<a><b></a>").ok).toBe(false);
    expect(checkXmlWellFormed("<a>x & y</a>").ok).toBe(false);
    expect(checkXmlWellFormed("<a/><b/>").ok).toBe(false);
    expect(checkXmlWellFormed("<a>").ok).toBe(false);
  });
});

function layoutDoc(): EditionDocument {
  return {
    schemaVersion: "1",
    meta: {
      editionId: "e",
      versionLabel: "v0.1",
      issueNumber: 1,
      title: "t",
      label: "May 2025",
      month: 5,
      year: 2025,
      isSpecialIssue: false,
      issueLabel: "Issue N°1",
      publicationDate: null,
      generatedAt: "2025-05-01T00:00:00.000Z",
      pageSize: { name: "A4", widthMm: 210, heightMm: 297 },
      masthead: { title: "Albert's Deep Dive", tagline: null },
      cover: { storyId: null, articleId: null, headline: "h", standfirst: null, mediaId: null, teasers: [{ articleId: "a1", line: "A1", page: null }] },
      editorial: null,
      credits: [],
      contactEmail: null,
      website: null,
      campuses: [],
    },
    sections: [{ id: "s", slug: "actus", name: "Actus", kicker: null, colour: null, sortOrder: 0 }],
    articles: [
      {
        id: "a1",
        storyId: "st1",
        sectionId: "s",
        storyType: "SCHOOL_NEWS",
        kicker: null,
        headline: "Headline one",
        standfirst: null,
        byline: null,
        body: [
          { id: "b1", type: "paragraph", text: "First. Second. Third." },
          { id: "b2", type: "crosshead", text: "CROSS" },
          { id: "b3", type: "paragraph", text: "Fourth. Fifth." },
        ],
        pullQuotes: [],
        media: [],
        heroMediaId: null,
        tags: [],
        campuses: [],
        wordCount: 8,
        bdd: null,
        sourceIds: [],
        status: "APPROVED",
        eventDateText: null,
      },
    ],
    media: [],
    pages: [
      { id: "p1", number: 1, template: "COVER_A", sectionId: null, articleIds: [], mediaIds: [], continuationOf: null, isLocked: true, notes: null },
      { id: "p2", number: 2, template: "ARTICLE_TWO_COLUMN", sectionId: "s", articleIds: ["a1"], mediaIds: [], continuationOf: null, isLocked: false, notes: null },
    ],
    toc: [],
    references: [],
    warnings: [],
  };
}

function measurement(pageId: string, number: number, template: string, blocks: PageMeasurement["flows"][number]["blocks"], extentRatio = 1.5): PageMeasurement {
  return {
    pageId,
    number,
    template,
    flows: [{ flow: `${pageId}:a1`, pageId, articleId: "a1", cols: 2, blocks, overflow: blocks.some((b) => !b.fits), fillRatio: 1, extentRatio, fitLevel: 0, slackRatio: 0, orphans: 0, widows: 0 }],
    blank: false,
    textLength: 100,
    imageCount: 0,
    imagesFailed: [],
    density: { occupancy: 0.9, tailGapRatio: 0.05, sheetHeight: 1000, contentBottom: 950 },
  };
}

describe("pagination helpers", () => {
  it("moves overflowing blocks to a continuation page, splitting a paragraph at a sentence boundary", () => {
    const doc = layoutDoc();
    const stats = { moved: 0, split: 0, added: 0, copyfit: 0, generation: 0 };
    const changed = applyMeasurements(
      doc,
      [
        measurement("p2", 2, "ARTICLE_TWO_COLUMN", [
          { id: "b1", type: "paragraph", fits: false, partial: true, sentencesFit: 2, sentenceCount: 3 },
          { id: "b2", type: "crosshead", fits: false, partial: false, sentencesFit: 0, sentenceCount: 0 },
          { id: "b3", type: "paragraph", fits: false, partial: false, sentencesFit: 0, sentenceCount: 0 },
        ]),
      ],
      stats,
    );
    expect(changed).toBe(true);
    expect(stats).toMatchObject({ added: 1, split: 1, moved: 3 });
    renumberPages(doc);
    rebuildToc(doc);
    expect(doc.pages.map((p) => `${p.number}:${p.template}`)).toEqual(["1:COVER_A", "2:ARTICLE_TWO_COLUMN", "3:CONTINUATION"]);
    const source = doc.pages[1].slices![0];
    expect(source.blockIds).toEqual(["b1.1a"]);
    expect(source.fragments![0]).toMatchObject({ type: "paragraph", text: "First. Second." });
    const cont = doc.pages[2];
    expect(cont.continuationOf).toBe(2);
    expect(cont.continuationOfPageId).toBe("p2");
    expect(cont.slices![0].blockIds).toEqual(["b1.1b", "b2", "b3"]);
    expect(cont.slices![0].fragments![0]).toMatchObject({ type: "paragraph", text: "Third." });
    expect(doc.toc).toEqual([{ page: 2, sectionName: "Actus", text: "Headline one", articleId: "a1" }]);
    expect(doc.meta.cover.teasers[0].page).toBe(2);
    // A second, identical run is deterministic and resets cleanly.
    const reset = resetLayout(doc);
    expect(reset.pages).toHaveLength(2);
    expect(reset.pages[1].slices).toBeUndefined();
  });

  it("copyfits small overflows instead of adding pages", () => {
    const doc = layoutDoc();
    const stats = { moved: 0, split: 0, added: 0, copyfit: 0, generation: 0 };
    const blocks = [
      { id: "b1", type: "paragraph", fits: true, partial: false, sentencesFit: 0, sentenceCount: 0 },
      { id: "b2", type: "crosshead", fits: true, partial: false, sentencesFit: 0, sentenceCount: 0 },
      { id: "b3", type: "paragraph", fits: false, partial: true, sentencesFit: 1, sentenceCount: 2 },
    ];
    expect(applyMeasurements(doc, [measurement("p2", 2, "ARTICLE_TWO_COLUMN", blocks, 1.05)], stats)).toBe(true);
    expect(stats.copyfit).toBe(1);
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[1].slices![0]).toMatchObject({ articleId: "a1", blockIds: ["b1", "b2", "b3"], fit: 1 });
  });

  it("keeps a block that fits nowhere on a continuation page instead of looping", () => {
    const doc = layoutDoc();
    doc.pages.push({ id: "cont_p2_1", number: 3, template: "CONTINUATION", sectionId: "s", articleIds: ["a1"], mediaIds: [], continuationOf: 2, isLocked: false, notes: null, continuationOfPageId: "p2", isContinuation: true, slices: [{ articleId: "a1", blockIds: ["b3"] }] });
    const stats = { moved: 0, split: 0, added: 0, copyfit: 0, generation: 0 };
    const changed = applyMeasurements(doc, [measurement("cont_p2_1", 3, "CONTINUATION", [{ id: "b3", type: "paragraph", fits: false, partial: false, sentencesFit: 0, sentenceCount: 0 }], 3)], stats);
    expect(changed).toBe(false);
    expect(doc.pages).toHaveLength(3);
  });
});
