import { describe, expect, it } from "vitest";
import { applyPronunciations, countWords, isSpelledAcronym, normaliseForSpeech, passagesFrom, scriptTotals, splitAtSentences, stripTags, type SourceBlock } from "@/lib/speech/script";

describe("saying what is written", () => {
  it("says money, percentages and multiples in English", () => {
    const said = normaliseForSpeech("Revenue reached €1.2M, up 40% — a 3x multiple on $40k.", "en");
    expect(said).toContain("1.2 million euros");
    expect(said).toContain("40 percent");
    expect(said).toContain("3 times");
    expect(said).toContain("40 thousand dollars");
  });

  it("says them in French, the French way", () => {
    const said = normaliseForSpeech("Le chiffre d'affaires atteint 1,2 M€, soit +40 % et un multiple de 3x.", "fr");
    expect(said).toContain("1,2 millions euros");
    expect(said).toContain("40 pour cent");
    expect(said).toContain("3 fois");
  });

  it("spells initialisms and leaves words alone", () => {
    expect(isSpelledAcronym("BDD")).toBe(true);
    expect(isSpelledAcronym("CEO")).toBe(true);
    expect(isSpelledAcronym("AI")).toBe(true);
    expect(isSpelledAcronym("NASA")).toBe(false);
    expect(isSpelledAcronym("Data")).toBe(false);
    const said = normaliseForSpeech("The BDD jury met the CEO at NASA.", "en");
    expect(said).toContain("B. D. D.");
    expect(said).toContain("C. E. O.");
    expect(said).toContain("NASA");
  });

  it("reads an address as a domain and nothing else", () => {
    expect(normaliseForSpeech("Apply at https://www.albertschool.com/apply?x=1 or write to hello@albertschool.com.", "en")).toBe("Apply at albertschool dot com or write to hello at albertschool dot com.");
    expect(normaliseForSpeech("Rendez-vous sur www.albertschool.com", "fr")).toContain("albertschool point com");
    expect(normaliseForSpeech("Read the whole story at https://www.albertschool.com/news.", "en")).toBe("Read the whole story at albertschool dot com.");
  });

  it("puts the newsroom's own pronunciations first", () => {
    const entries = [{ term: "Albert School", say: "Albert Scoule" }, { term: "BDD", say: "business deep dive" }];
    expect(applyPronunciations("Albert School runs a BDD every term; albert school is proud.", entries, "en")).toBe("Albert Scoule runs a business deep dive every term; Albert Scoule is proud.");
    // Word boundaries that know about accents: "Sté" inside "Stéphane" is not a match.
    expect(applyPronunciations("Stéphane et la Sté", [{ term: "Sté", say: "société" }], "fr")).toBe("Stéphane et la société");
    // A dictionary entry beats the acronym rule.
    expect(normaliseForSpeech("The BDD", "en", entries)).toBe("The business deep dive");
  });

  it("only applies a pronunciation to the language it was written for", () => {
    expect(applyPronunciations("BDD", [{ term: "BDD", say: "bidédé", language: "fr" }], "en")).toBe("BDD");
  });

  it("drops markup and reads ranges and issue numbers", () => {
    expect(normaliseForSpeech("**Issue N°5** covers 2023–2024, e.g. the *finals*.", "en")).toBe("Issue number 5 covers 2023 to 2024, for example the finals.");
  });
});

describe("cutting into passages", () => {
  it("never cuts inside a sentence", () => {
    const sentence = "Here is a sentence of moderate length that says something. ";
    const text = sentence.repeat(60);
    const pieces = splitAtSentences(text, 400);
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(400);
      expect(piece.endsWith(".")).toBe(true);
    }
    expect(pieces.join(" ").replace(/\s+/g, " ")).toBe(text.trim().replace(/\s+/g, " "));
  });

  it("joins a chapter's paragraphs and lets a second voice take the quotations", () => {
    const blocks: SourceBlock[] = [
      { kind: "heading", text: "The finals", chapter: "The finals", sourceId: "a1" },
      { kind: "paragraph", text: "First paragraph.", chapter: "The finals", sourceId: "a1" },
      { kind: "paragraph", text: "Second paragraph.", chapter: "The finals", sourceId: "a1" },
      { kind: "quote", text: "We learned more in a week than in a year.", speaker: "Lina, winner", chapter: "The finals", sourceId: "a1" },
      { kind: "paragraph", text: "Closing paragraph.", chapter: "The finals", sourceId: "a1" },
      { kind: "heading", text: "Next month", chapter: "Next month", sourceId: "a2" },
      { kind: "paragraph", text: "Another article.", chapter: "Next month", sourceId: "a2" },
    ];
    const passages = passagesFrom(blocks, { secondVoice: true });
    expect(passages.map((passage) => passage.sourceType)).toEqual(["headline", "body", "quote", "body", "headline", "body"]);
    expect(passages[1].text).toBe("First paragraph.\n\nSecond paragraph.");
    expect(passages[2].speaker).toBe("second");
    expect(passages.map((passage) => passage.index)).toEqual([0, 1, 2, 3, 4, 5]);
    // Without a second voice the narrator reads the quotation too.
    expect(passagesFrom(blocks, { secondVoice: false })[2].speaker).toBe("narrator");
  });

  it("counts words without the tags", () => {
    expect(stripTags("[softly] Hello there , friend.")).toBe("Hello there, friend.");
    expect(countWords("[confident] Three words here")).toBe(3);
    expect(scriptTotals([{ index: 0, speaker: "narrator", text: "[calmly] One two", plain: "One two", sourceType: "body" }]).words).toBe(2);
  });
});
