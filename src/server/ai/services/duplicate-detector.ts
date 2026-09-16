/**
 * Duplicate detection is pure code (no model): a SHA-256 of the normalised text catches exact
 * re-submissions, a TF-IDF cosine over the edition's texts catches near-copies (≥ 0.85).
 */
import { createHash } from "node:crypto";
import { buildIdf, cosine, jaccard, tfidfVector } from "@/lib/editorial/similarity";
import { contentTokens, stripDiacritics } from "@/lib/editorial/text";

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;
const MIN_TOKENS = 12;

export type DuplicateCandidate = { id: string; text: string };
export type DuplicateMatch = { id: string; similarity: number; exact: boolean };
export type DuplicateResult = { hash: string; duplicateOfId: string | null; similarity: number; exact: boolean; matches: DuplicateMatch[] };

export function normalizeForHash(text: string): string {
  return stripDiacritics(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The text two submissions are compared on: what the contributor actually wrote. Comparing the
 * derived `normalizedText` instead would make detection depend on *when* a row was normalised
 * (a seeded row and a freshly processed one carry different derived forms of the same story).
 */
export function submissionDuplicateText(input: { title?: string | null; description?: string | null }): string {
  return [input.title ?? "", input.description ?? ""].filter(Boolean).join("\n");
}

export function textHash(text: string): string {
  return createHash("sha256").update(normalizeForHash(text)).digest("hex");
}

/** Finds the closest earlier submission; `others` should be the same edition's submissions. */
export function detectDuplicate(candidate: DuplicateCandidate, others: DuplicateCandidate[], threshold = DUPLICATE_SIMILARITY_THRESHOLD): DuplicateResult {
  const hash = textHash(candidate.text);
  const cTokens = contentTokens(candidate.text);
  const docs = [cTokens, ...others.map((o) => contentTokens(o.text))];
  const idf = buildIdf(docs);
  const cVec = tfidfVector(cTokens, idf);
  const matches: DuplicateMatch[] = [];
  for (const [i, other] of others.entries()) {
    if (other.id === candidate.id) continue;
    const exact = textHash(other.text) === hash;
    const oTokens = docs[i + 1];
    let similarity = exact ? 1 : 0;
    if (!exact && cTokens.length >= MIN_TOKENS && oTokens.length >= MIN_TOKENS) {
      const cos = cosine(cVec, tfidfVector(oTokens, idf));
      const jac = jaccard(cTokens, oTokens);
      similarity = Math.max(cos, jac);
    }
    if (similarity >= threshold) matches.push({ id: other.id, similarity: Math.round(similarity * 1000) / 1000, exact });
  }
  matches.sort((a, b) => Number(b.exact) - Number(a.exact) || b.similarity - a.similarity);
  const best = matches[0];
  return { hash, duplicateOfId: best?.id ?? null, similarity: best?.similarity ?? 0, exact: best?.exact ?? false, matches };
}
