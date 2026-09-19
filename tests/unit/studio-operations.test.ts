import { describe as group, expect, it } from "vitest";
import { asksFirst, describe, editionOperationSchema, summarise, supersedes, type EditionOperation } from "@/server/editorial/edition-studio/operations";
import { UI_FR } from "@/lib/i18n/ui-fr";

const ARTICLE = "11111111-1111-4111-8111-111111111111";
const OTHER_ARTICLE = "22222222-2222-4222-8222-222222222222";
const PAGE = "33333333-3333-4333-8333-333333333333";
const STORY = "44444444-4444-4444-8444-444444444444";

const names = { articles: { [ARTICLE]: "The quiet year at Volvo" }, stories: { [STORY]: "Jonquille Run" }, pages: { [PAGE]: 13 } };

group("what the vocabulary allows", () => {
  it("refuses an operation it does not know", () => {
    expect(editionOperationSchema.safeParse({ kind: "delete_edition", editionId: ARTICLE }).success).toBe(false);
  });

  it("refuses an id that is not one", () => {
    expect(editionOperationSchema.safeParse({ kind: "remove_page", pageId: "page 13" }).success).toBe(false);
  });

  it("marks re-planning and removing a page as worth reading twice", () => {
    expect(asksFirst({ kind: "regenerate_layout" })).toBe(true);
    expect(asksFirst({ kind: "remove_page", pageId: PAGE })).toBe(true);
    expect(asksFirst({ kind: "copyfit" })).toBe(false);
  });
});

group("writing an operation for the person paying for it", () => {
  it("names the article rather than its id", () => {
    const phrase = describe({ kind: "shorten_article", articleId: ARTICLE, targetWords: 400 }, names);
    expect(phrase.text).toBe("Shorten “{headline}” to about {words} words");
    expect(phrase.values).toEqual({ headline: "The quiet year at Volvo", words: 400 });
  });

  it("keeps the sentence and its values apart, so the list can be translated", () => {
    // The English is the dictionary key; a finished string could not be looked up.
    const phrase = describe({ kind: "remove_page", pageId: PAGE }, names);
    expect(phrase.text).toContain("{page}");
    expect(phrase.values).toEqual({ page: 13 });
  });

  it("switches to a whole sentence when the id is no longer in the issue", () => {
    // Not "Raccourcir « an article »": values are substituted after the dictionary lookup, so an
    // unnamed thing needs its own line rather than an English word dropped into a French one.
    const phrase = describe({ kind: "shorten_article", articleId: OTHER_ARTICLE, targetWords: 200 }, names);
    expect(phrase.text).toBe("Shorten an article to about {words} words");
    expect(phrase.values).toEqual({ words: 200 });
    expect(UI_FR[phrase.text]).toBe("Raccourcir un article à environ {words} mots");
  });

  it("writes every operation the vocabulary has", () => {
    const every: EditionOperation[] = [
      { kind: "set_extent", mode: "fixed", pages: 28 },
      { kind: "set_extent", mode: "auto", pages: null },
      { kind: "regenerate_layout" },
      { kind: "copyfit" },
      { kind: "shorten_article", articleId: ARTICLE, targetWords: 400 },
      { kind: "expand_article", articleId: ARTICLE, targetWords: 900 },
      { kind: "rewrite_headline", articleId: ARTICLE, instruction: null },
      { kind: "set_headline", articleId: ARTICLE, headline: "A new one" },
      { kind: "set_standfirst", articleId: ARTICLE, standfirst: null },
      { kind: "attach_photos", storyId: STORY, mediaIds: [PAGE], role: "gallery" },
      { kind: "add_picture_page", afterPageId: PAGE, storyId: STORY },
      { kind: "set_page_template", pageId: PAGE, template: "NEWS_GRID" },
      { kind: "move_page", pageId: PAGE, direction: "up" },
      { kind: "add_page", afterPageId: null, template: null },
      { kind: "remove_page", pageId: PAGE },
      { kind: "set_page_story", pageId: PAGE, storyId: null },
      { kind: "set_page_notes", pageId: PAGE, notes: "Check the caption" },
    ];
    for (const op of every) {
      const phrase = describe(op, names);
      expect(phrase.text.length, op.kind).toBeGreaterThan(0);
      expect(summarise(op).length, op.kind).toBeGreaterThan(0);
      // The dictionary scan only sees `tr("…")` literals, and these are data; nothing else would
      // report a line of the list that reads in English to a French newsroom.
      expect(UI_FR[phrase.text], `no French for ${phrase.text}`).toBeTruthy();
    }
  });
});

group("changing your mind inside one revision", () => {
  it("replaces an extent asked for twice", () => {
    expect(supersedes({ kind: "set_extent", mode: "fixed", pages: 24 }, { kind: "set_extent", mode: "fixed", pages: 28 })).toBe(true);
  });

  it("replaces a second headline for the same article, and not for another one", () => {
    const a: EditionOperation = { kind: "set_headline", articleId: ARTICLE, headline: "Second try" };
    expect(supersedes(a, { kind: "set_headline", articleId: ARTICLE, headline: "First try" })).toBe(true);
    expect(supersedes(a, { kind: "set_headline", articleId: OTHER_ARTICLE, headline: "First try" })).toBe(false);
  });

  it("leaves two photographs asked for separately as two lines", () => {
    // Adding pictures twice means twice as many pictures. Replacing would quietly drop the first lot.
    const a: EditionOperation = { kind: "attach_photos", storyId: STORY, mediaIds: [PAGE], role: null };
    expect(supersedes(a, a)).toBe(false);
  });

  it("does not confuse two different kinds", () => {
    expect(supersedes({ kind: "copyfit" }, { kind: "regenerate_layout" })).toBe(false);
  });
});
