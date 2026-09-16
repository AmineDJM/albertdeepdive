/**
 * Pure text helpers shared by the print templates, the DOCX renderer and the pagination pass.
 * No DOM, no database: everything here is deterministic and unit-testable.
 */

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function monthName(month: number): string {
  return MONTH_NAMES[Math.min(12, Math.max(1, Math.round(month))) - 1];
}

/** "Special issue N°1" / "Issue N°5" — the label printed on the cover and in the running header. */
export function issueLabelFor(issueNumber: number, isSpecialIssue: boolean): string {
  return `${isSpecialIssue ? "Special issue" : "Issue"} N°${issueNumber}`;
}

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "no",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "jr",
  "sr",
  "inc",
  "ltd",
  "co",
  "approx",
  "fig",
  "p",
  "pp",
  "vol",
]);

/**
 * Splits a paragraph into sentences. Terminators are kept with their sentence; whitespace between
 * sentences is dropped (callers re-join with a single space). Common abbreviations, initials and
 * decimal numbers do not end a sentence.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[.!?…]+["”’»)\]]*\s+(?=["“‘«(\[]?[A-ZÀ-ÝÆŒ0-9])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const before = text.slice(last, m.index).trimEnd();
    const lastWord = before.split(/\s+/).pop() ?? "";
    const bare = lastWord.toLowerCase().replace(/[^a-z.]/g, "").replace(/\.$/, "");
    const isInitial = /^[A-ZÀ-Ý]$/.test(lastWord.replace(/[^A-Za-zÀ-ÿ]/g, ""));
    if (ABBREVIATIONS.has(bare) || (isInitial && lastWord.length <= 2)) continue;
    const sentence = text.slice(last, end).trim();
    if (sentence) out.push(sentence);
    last = end;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push(rest);
  return out;
}

/** Keeps the first `keep` sentences in `head` and returns the remainder in `tail` (empty when nothing is left). */
export function splitParagraphAtSentence(text: string, keep: number): { head: string; tail: string } {
  const sentences = splitSentences(text);
  const k = Math.max(0, Math.min(keep, sentences.length));
  return { head: sentences.slice(0, k).join(" "), tail: sentences.slice(k).join(" ") };
}

export function countTextWords(text: string | null | undefined): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** "A, B and C" */
export function humanList(items: readonly string[]): string {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Turns "Carrefour – B2 Paris" into a file-name friendly slug. */
export function fileSlug(input: string, max = 60): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** Removes a leading/trailing pair of straight or curly double quotes (headlines are often quotes). */
export function stripOuterQuotes(text: string): string {
  return text.replace(/^["“”«]\s*/, "").replace(/\s*["“”»]$/, "");
}

/** Numeric "bucket" used to derive stable pseudo-random choices from ids (never Math.random in renderers). */
export function stableIndex(seed: string, modulo: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return modulo > 0 ? h % modulo : 0;
}

export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${monthName(d.getUTCMonth() + 1)} ${d.getUTCFullYear()}`;
}
