import { blockText, type ArticleBlock } from "./document";

/**
 * Taking an exact passage out of an article.
 *
 * Asked to delete a named passage — "Enlève cette partie : WHAT DOES YOUR ROLE INVOLVE? I lead data
 * science…" — the studio proposed shortening the article by about forty words. Which is not what was
 * asked: a word count says how much goes, never which words, and a copy editor asked to lose forty
 * words may perfectly well keep that paragraph and cut somewhere else. The person had already done
 * the editorial thinking and quoted the words; all that was left was to obey.
 *
 * So this is arithmetic, not judgement. It finds the words that were quoted and removes exactly
 * those, or it finds nothing and says so. It never removes something approximately similar, and it
 * never falls back to "well, something of about that length".
 */

/**
 * Both strings, reduced to what a person means by "the same words".
 *
 * Case, the shape of the quotes and dashes, and the amount of whitespace are all things that change
 * between a rendered page and a paste into a chat box. Nothing else is touched: the words, their
 * order and their punctuation still have to match.
 */
function fold(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The folded text of a string, with the index in the original each character came from. */
function foldWithMap(text: string): { folded: string; at: number[] } {
  const out: string[] = [];
  const at: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < text.length; i++) {
    const raw = text[i];
    const ch = /\s/.test(raw)
      ? " "
      : raw.replace(/[‘’‛]/, "'").replace(/[“”‟]/, '"').replace(/[‐-―]/, "-");
    if (ch === " ") {
      if (lastWasSpace) continue;
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    out.push(ch.toLowerCase());
    at.push(i);
  }
  while (out.length && out[out.length - 1] === " ") {
    out.pop();
    at.pop();
  }
  return { folded: out.join(""), at };
}

/** The fields a partial cut may be applied to. Anything else is removed whole or left alone. */
function cuttableFields(block: ArticleBlock): ("text" | "question" | "answer")[] {
  switch (block.type) {
    case "paragraph":
    case "crosshead":
    case "pullquote":
    case "testimony":
      return ["text"];
    case "qa":
      return ["question", "answer"];
    default:
      return [];
  }
}

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export type PassageCut = {
  blocks: ArticleBlock[];
  /** Whole blocks taken out. */
  blocksRemoved: number;
  wordsRemoved: number;
};

/**
 * Removes the quoted passage, or returns null having removed nothing.
 *
 * Three shapes, in order of how sure each one is. A run of whole blocks whose text is exactly the
 * passage — the ordinary case, where somebody copied a heading and the paragraph under it. Then the
 * blocks that are each wholly inside the passage, which covers a paste that lost or gained a line
 * break. Then the passage sitting inside one block, where the sentence is cut out and what is left
 * of the block stays.
 */
export function removePassage(blocks: ArticleBlock[], passage: string): PassageCut | null {
  const want = fold(passage);
  if (!want) return null;
  const folded = blocks.map((block) => fold(blockText(block)));

  const dropRun = (from: number, to: number): PassageCut => ({
    blocks: blocks.filter((_, index) => index < from || index > to),
    blocksRemoved: to - from + 1,
    wordsRemoved: blocks.slice(from, to + 1).reduce((total, block) => total + words(blockText(block)), 0),
  });

  // 1. A run of blocks that is exactly the passage.
  for (let start = 0; start < blocks.length; start++) {
    if (!folded[start]) continue;
    let joined = "";
    for (let end = start; end < blocks.length; end++) {
      joined = joined ? `${joined} ${folded[end]}` : folded[end];
      if (joined === want) return dropRun(start, end);
      if (!want.startsWith(joined)) break;
    }
  }

  // 2. Blocks each wholly inside the passage, together covering nearly all of it.
  const inside = blocks.map((_, index) => index).filter((index) => folded[index].length > 0 && want.includes(folded[index]));
  if (inside.length) {
    const covered = inside.reduce((total, index) => total + folded[index].length, 0);
    const contiguous = inside.every((index, i) => i === 0 || index === inside[i - 1] + 1);
    if (contiguous && covered >= want.length * 0.8) return dropRun(inside[0], inside[inside.length - 1]);
  }

  // 3. The passage inside a single block: cut the sentence, keep the block.
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    for (const field of cuttableFields(block)) {
      const value = (block as unknown as Record<string, string>)[field] ?? "";
      const { folded: haystack, at } = foldWithMap(value);
      const found = haystack.indexOf(want);
      if (found < 0) continue;
      const from = at[found];
      const to = at[found + want.length - 1] + 1;
      const kept = `${value.slice(0, from)}${value.slice(to)}`.replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
      const before = words(value);
      // A block whose words have all gone is a block, not an empty paragraph left on the page.
      const next = kept
        ? blocks.map((each, i) => (i === index ? ({ ...each, [field]: kept } as ArticleBlock) : each))
        : blocks.filter((_, i) => i !== index);
      return { blocks: next, blocksRemoved: kept ? 0 : 1, wordsRemoved: before - words(kept) };
    }
  }

  return null;
}
