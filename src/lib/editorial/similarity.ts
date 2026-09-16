/**
 * Vector-space similarity helpers (TF-IDF cosine, Jaccard, word-level LCS). Pure and deterministic.
 */
import { contentTokens, tokenize } from "./text";

export type TermVector = Map<string, number>;

export function termFrequencies(tokens: string[]): TermVector {
  const tf: TermVector = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Smoothed inverse document frequency over a corpus of token lists. */
export function buildIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log((n + 1) / (d + 1)) + 1);
  return idf;
}

/** L2-normalised (1 + log tf) · idf vector. Unknown terms get idf 1. */
export function tfidfVector(tokens: string[], idf?: Map<string, number>): TermVector {
  const tf = termFrequencies(tokens);
  const vec: TermVector = new Map();
  let norm = 0;
  for (const [t, f] of tf) {
    const w = (1 + Math.log(f)) * (idf?.get(t) ?? 1);
    vec.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
}

export function cosine(a: TermVector, b: TermVector): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const v = large.get(t);
    if (v) dot += w * v;
  }
  let na = 0;
  let nb = 0;
  for (const w of a.values()) na += w * w;
  for (const w of b.values()) nb += w * w;
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size && !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/** Pairwise text similarity: cosine of content-token TF vectors (idf is uniform for two documents). */
export function textSimilarity(a: string, b: string): number {
  return cosine(tfidfVector(contentTokens(a)), tfidfVector(contentTokens(b)));
}

/** Corpus-aware similarity matrix (TF-IDF cosine) for n texts. */
export function similarityMatrix(texts: string[]): number[][] {
  const docs = texts.map(contentTokens);
  const idf = buildIdf(docs);
  const vectors = docs.map((d) => tfidfVector(d, idf));
  return vectors.map((a) => vectors.map((b) => cosine(a, b)));
}

/** Length of the longest common subsequence of two token lists (O(n·m) time, O(m) memory). */
export function lcsLength(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[b.length];
}

/**
 * Word-level similarity between two texts in [0, 1]: the share of the longer text kept in the
 * longest common subsequence. 1 − this value is the "manual edit ratio" of an article revision.
 */
export function editSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length && !tb.length) return 1;
  const longest = Math.max(ta.length, tb.length);
  return lcsLength(ta, tb) / longest;
}
