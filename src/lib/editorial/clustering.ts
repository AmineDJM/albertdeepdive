/**
 * Deterministic story clustering: groups submissions that describe the same event or topic.
 *
 * similarity(a, b) = wText · cosine(TF-IDF(a), TF-IDF(b))
 *                  + wEntities · fuzzyJaccard(names(a), names(b))
 *                  + boosts (same story type, overlapping campuses, same event date)
 *
 * followed by average-linkage agglomerative grouping with a fixed threshold. Pure, no I/O.
 */
import { buildIdf, cosine, tfidfVector, type TermVector } from "./similarity";
import { contentTokens, extractDates, normalizeName, sameNameLoose } from "./text";

export type ClusterInput = {
  id: string;
  title: string;
  text: string;
  storyType: string;
  campusIds: string[];
  people: string[];
  organisations: string[];
  /** Normalised event date key ("2025-04-04" or "4 april"), or null. */
  eventDate: string | null;
};

export type ClusterWeights = {
  text: number;
  entities: number;
  sameStoryType: number;
  compatibleStoryType: number;
  sameCampus: number;
  sameEventDate: number;
  titleOverlap: number;
  /** Penalty when both texts name cohorts (B1, B2, MSc…) and none is shared. */
  differentCohort: number;
  /** Penalty when both carry an event date and they differ. */
  differentEventDate: number;
};

export type ClusterOptions = {
  threshold?: number;
  weights?: Partial<ClusterWeights>;
};

export const DEFAULT_CLUSTER_WEIGHTS: ClusterWeights = {
  text: 0.55,
  entities: 0.25,
  sameStoryType: 0.08,
  compatibleStoryType: 0.04,
  sameCampus: 0.05,
  sameEventDate: 0.1,
  titleOverlap: 0.08,
  differentCohort: 0.15,
  differentEventDate: 0.08,
};

export const DEFAULT_CLUSTER_THRESHOLD = 0.4;

export type PairBreakdown = { total: number; text: number; entities: number; boosts: number };

const EVENT_TYPES = new Set(["EVENT_RECAP", "UPCOMING_EVENT"]);
const UNIVERSAL_TYPES = new Set(["PHOTO_STORY", "OTHER"]);

function storyTypeBoost(a: string, b: string, w: ClusterWeights): number {
  if (a === b) return w.sameStoryType;
  if (UNIVERSAL_TYPES.has(a) || UNIVERSAL_TYPES.has(b)) return w.compatibleStoryType;
  if (EVENT_TYPES.has(a) && EVENT_TYPES.has(b)) return w.compatibleStoryType;
  return 0;
}

/** Jaccard over names where near-identical spellings count as the same entity. */
export function fuzzyNameJaccard(a: string[], b: string[]): number {
  const { inter, sizeA, sizeB } = fuzzyIntersection(a, b);
  if (!sizeA && !sizeB) return 0;
  return inter / (sizeA + sizeB - inter);
}

function fuzzyIntersection(a: string[], b: string[]): { inter: number; sizeA: number; sizeB: number } {
  const sa = [...new Set(a.map(normalizeName).filter(Boolean))];
  const sb = [...new Set(b.map(normalizeName).filter(Boolean))];
  const matchedB = new Set<number>();
  let inter = 0;
  for (const x of sa) {
    const j = sb.findIndex((y, idx) => !matchedB.has(idx) && (x === y || sameNameLoose(x, y)));
    if (j >= 0) {
      matchedB.add(j);
      inter += 1;
    }
  }
  return { inter, sizeA: sa.length, sizeB: sb.length };
}

/**
 * Entity similarity: half Jaccard, half overlap coefficient (|A∩B| / min(|A|,|B|)) so that a short
 * photo submission naming two people of a long report still scores high. The overlap half only
 * counts when the smaller set has at least two names.
 */
export function entitySimilarity(a: string[], b: string[]): number {
  const { inter, sizeA, sizeB } = fuzzyIntersection(a, b);
  if (!sizeA || !sizeB) return 0;
  const jac = inter / (sizeA + sizeB - inter);
  const smaller = Math.min(sizeA, sizeB);
  const overlap = smaller >= 2 ? inter / smaller : jac;
  return 0.5 * jac + 0.5 * overlap;
}

const COHORT_RE = /\b(b1|b2|b3|m1|m2|msc|ibba|mba)\b/gi;

function cohortTokens(text: string): Set<string> {
  return new Set([...text.matchAll(COHORT_RE)].map((m) => m[1].toLowerCase()));
}

function titleOverlap(a: string, b: string): number {
  const ta = new Set(contentTokens(a));
  const tb = new Set(contentTokens(b));
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n += 1;
  return n / Math.min(ta.size, tb.size);
}

export function pairSimilarity(a: ClusterInput, b: ClusterInput, va: TermVector, vb: TermVector, weights: ClusterWeights): PairBreakdown {
  const text = cosine(va, vb);
  const entities = entitySimilarity([...a.people, ...a.organisations], [...b.people, ...b.organisations]);
  let boosts = storyTypeBoost(a.storyType, b.storyType, weights);
  if (a.campusIds.some((c) => b.campusIds.includes(c))) boosts += weights.sameCampus;
  if (a.eventDate && b.eventDate) boosts += a.eventDate === b.eventDate ? weights.sameEventDate : -weights.differentEventDate;
  boosts += weights.titleOverlap * titleOverlap(a.title, b.title);
  const ca = cohortTokens(`${a.title} ${a.text}`);
  const cb = cohortTokens(`${b.title} ${b.text}`);
  if (ca.size && cb.size && ![...ca].some((c) => cb.has(c))) boosts -= weights.differentCohort;
  const total = weights.text * text + weights.entities * entities + boosts;
  return { total: Math.max(0, Math.min(1, total)), text, entities, boosts };
}

export function buildSimilarityMatrix(inputs: ClusterInput[], options: ClusterOptions = {}): PairBreakdown[][] {
  const weights = { ...DEFAULT_CLUSTER_WEIGHTS, ...options.weights };
  const docs = inputs.map((i) => contentTokens(`${i.title}\n${i.text}`));
  const idf = buildIdf(docs);
  const vectors = docs.map((d) => tfidfVector(d, idf));
  return inputs.map((a, i) =>
    inputs.map((b, j) => (i === j ? { total: 1, text: 1, entities: 1, boosts: 0 } : pairSimilarity(a, b, vectors[i], vectors[j], weights))),
  );
}

export type ClusterGroup = {
  ids: string[];
  /** The member with the highest total similarity to the others (or the longest text for singletons). */
  primaryId: string;
  /** Average similarity of each member to the rest of the group (1 for singletons). */
  similarities: Record<string, number>;
};

/** Average-linkage agglomerative clustering with deterministic tie-breaking (ids sorted). */
export function clusterSubmissions(inputs: ClusterInput[], options: ClusterOptions = {}): ClusterGroup[] {
  const threshold = options.threshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const ordered = [...inputs].sort((a, b) => a.id.localeCompare(b.id));
  const matrix = buildSimilarityMatrix(ordered, options);

  let clusters: number[][] = ordered.map((_, i) => [i]);

  const linkage = (a: number[], b: number[]) => {
    let sum = 0;
    for (const i of a) for (const j of b) sum += matrix[i][j].total;
    return sum / (a.length * b.length);
  };

  while (clusters.length > 1) {
    let best = -1;
    let bestPair: [number, number] | null = null;
    for (let x = 0; x < clusters.length; x += 1) {
      for (let y = x + 1; y < clusters.length; y += 1) {
        const score = linkage(clusters[x], clusters[y]);
        if (score > best + 1e-9) {
          best = score;
          bestPair = [x, y];
        }
      }
    }
    if (!bestPair || best < threshold) break;
    const [x, y] = bestPair;
    const merged = [...clusters[x], ...clusters[y]].sort((a, b) => a - b);
    clusters = clusters.filter((_, idx) => idx !== x && idx !== y);
    clusters.push(merged);
    clusters.sort((a, b) => a[0] - b[0]);
  }

  return clusters.map((members) => {
    const similarities: Record<string, number> = {};
    let primary = members[0];
    let primaryScore = -1;
    for (const i of members) {
      const others = members.filter((j) => j !== i);
      const avg = others.length ? others.reduce((s, j) => s + matrix[i][j].total, 0) / others.length : 1;
      similarities[ordered[i].id] = Math.round(avg * 1000) / 1000;
      const score = others.length ? avg : ordered[i].text.length;
      if (score > primaryScore) {
        primaryScore = score;
        primary = i;
      }
    }
    if (members.length > 1) {
      // Centrality alone favours short generic notes (a photo-only submission is "similar to
      // everything"), so among the members that clearly belong to the story we pick the richest
      // text: that is the submission an editor wants as the lead source.
      const top = members.filter((i) => Math.abs(similarities[ordered[i].id] - similarities[ordered[primary].id]) < 0.15);
      primary = top.sort((a, b) => ordered[b].text.length - ordered[a].text.length)[0];
    }
    return { ids: members.map((i) => ordered[i].id), primaryId: ordered[primary].id, similarities };
  });
}

/** Names that are spelled differently across inputs (edit distance 1–2), e.g. "Sarfaty" vs "Serfaty". */
export function findSpellingConflicts(inputs: { id: string; names: string[] }[]): { a: string; b: string; ids: [string, string] }[] {
  const out: { a: string; b: string; ids: [string, string] }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < inputs.length; i += 1) {
    for (let j = i + 1; j < inputs.length; j += 1) {
      for (const a of inputs[i].names) {
        for (const b of inputs[j].names) {
          if (a.toLowerCase() === b.toLowerCase()) continue;
          if (!sameNameLoose(a, b) && !nearSurname(a, b)) continue;
          const key = [a.toLowerCase(), b.toLowerCase()].sort().join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ a, b, ids: [inputs[i].id, inputs[j].id] });
        }
      }
    }
  }
  return out;
}

function nearSurname(a: string, b: string): boolean {
  const wa = a.split(/\s+/);
  const wb = b.split(/\s+/);
  if (wa.length !== wb.length || wa.length < 2) return false;
  let diffs = 0;
  for (let i = 0; i < wa.length; i += 1) {
    if (wa[i].toLowerCase() === wb[i].toLowerCase()) continue;
    if (!sameNameLoose(wa[i], wb[i]) && !(wa[i].length >= 5 && Math.abs(wa[i].length - wb[i].length) <= 1 && wa[i][0].toLowerCase() === wb[i][0].toLowerCase())) return false;
    diffs += 1;
  }
  return diffs === 1;
}

/**
 * Comparable key for an event date: "4 april" for "Friday 4th April", "4 April 2025" or 2025-04-04,
 * so submissions about the same day match regardless of how precisely the date was written.
 */
export function eventDateKey(input: { iso?: string | null; text?: string | null }): string | null {
  if (input.iso) {
    const m = input.iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]}`;
    }
  }
  if (input.text) {
    const found = extractDates(input.text)[0];
    if (found?.iso) return eventDateKey({ iso: found.iso });
    if (found) {
      const cleaned = found.text
        .toLowerCase()
        .replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+/, "")
        .replace(/(\d)(st|nd|rd|th)\b/, "$1")
        .replace(/\s+\d{4}$/, "")
        .trim();
      return cleaned || null;
    }
  }
  return null;
}
