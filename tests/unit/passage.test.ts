import { describe, expect, it } from "vitest";
import { removePassage } from "@/lib/publication/passage";
import { countWords, type ArticleBlock } from "@/lib/publication/document";

/**
 * "Enlève cette partie", answered exactly.
 *
 * The studio met this as a request to shorten the article by about forty words, which is a
 * different instruction: a word count says how much goes, never which words. These are the shapes
 * a person's quotation actually arrives in, and the one case that matters most — words nobody can
 * find — which must remove nothing at all.
 */
const ROLE = "WHAT DOES YOUR ROLE INVOLVE?";
const ANSWER =
  "I lead data science at an agri-tech startup, where my focus is on forecasting crop yields for cooperatives in three countries. We use satellite imagery to inform our predictions, helping farmers and organisations make better decisions.";

const article = (): ArticleBlock[] => [
  { id: "b1", type: "paragraph", text: "Clara Vasseur left Albert School in 2023." },
  { id: "b2", type: "crosshead", text: ROLE },
  { id: "b3", type: "paragraph", text: ANSWER },
  { id: "b4", type: "paragraph", text: "She is hiring two more people this spring." },
];

describe("removing a passage somebody quoted", () => {
  it("takes out the heading and the paragraph under it, and nothing else", () => {
    const cut = removePassage(article(), `${ROLE}\n${ANSWER}`);
    expect(cut).toBeTruthy();
    expect(cut!.blocks.map((block) => block.id)).toEqual(["b1", "b4"]);
    expect(cut!.blocksRemoved).toBe(2);
    expect(cut!.wordsRemoved).toBe(countWords([article()[1], article()[2]]));
  });

  it("forgives the things that change between a page and a paste", () => {
    // Curly quotes, a different dash, doubled spaces, a stray capital.
    const messy = `   what does your role INVOLVE?\n\n   ${ANSWER.replace(/'/g, "’").replace(/-/g, "—")}  `;
    const cut = removePassage(article(), messy);
    expect(cut?.blocks.map((block) => block.id)).toEqual(["b1", "b4"]);
  });

  it("cuts one sentence out of a paragraph and keeps the rest", () => {
    const blocks: ArticleBlock[] = [{ id: "b1", type: "paragraph", text: "She left in 2023. The company is hiring. Her cat is called Pixel." }];
    const cut = removePassage(blocks, "The company is hiring.");
    expect(cut?.blocks).toHaveLength(1);
    expect((cut!.blocks[0] as { text: string }).text).toBe("She left in 2023. Her cat is called Pixel.");
    expect(cut!.blocksRemoved).toBe(0);
    expect(cut!.wordsRemoved).toBe(4);
  });

  it("removes a block whose every word was the passage", () => {
    const blocks: ArticleBlock[] = [
      { id: "b1", type: "paragraph", text: "Keep me." },
      { id: "b2", type: "paragraph", text: "Take me out." },
    ];
    expect(removePassage(blocks, "Take me out.")!.blocks.map((b) => b.id)).toEqual(["b1"]);
  });

  it("finds a passage inside a question and answer", () => {
    const blocks: ArticleBlock[] = [{ id: "b1", type: "qa", question: ROLE, answer: ANSWER }];
    expect(removePassage(blocks, ROLE)!.blocks).toHaveLength(0);
  });

  it("removes nothing at all when the words are not there", () => {
    // The whole point. An approximate match here deletes a paragraph nobody pointed at.
    const before = article();
    expect(removePassage(before, "A sentence this article has never contained.")).toBeNull();
    expect(removePassage(before, "   ")).toBeNull();
    expect(before.map((block) => block.id)).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("does not mutate the blocks it was given", () => {
    const before = article();
    const snapshot = JSON.stringify(before);
    removePassage(before, `${ROLE}\n${ANSWER}`);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
