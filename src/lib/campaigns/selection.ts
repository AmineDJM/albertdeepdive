/**
 * Deterministic contributor selection for a campaign.
 *
 * Eligible contributors are active members of at least one selected group. Per campus (and
 * for school-wide contributors under the "school" key) the requested number is taken from the
 * pool ranked by response rate, then number of past submissions, then least recently invited,
 * then a stable seeded shuffle so ties are broken fairly but reproducibly.
 */

export const SCHOOL_TARGET_KEY = "school";

export type SelectableContributor = {
  id: string;
  campusId: string | null;
  groupIds: readonly string[];
  isActive: boolean;
  responseRate: number | null;
  lastInvitedAt: Date | string | null;
  submissionsCount: number;
};

/** campusId (or "school" for contributors without a campus) → number of contributors to invite. */
export type SelectionTargets = Record<string, number>;

export type SelectionResult = {
  selected: string[];
  /** Number selected per target key. */
  byCampus: Record<string, number>;
  /** Missing contributors per target key when the pool is smaller than the target. */
  shortfall: Record<string, number>;
  /** Size of the eligible pool per target key (including keys without a target). */
  pool: Record<string, number>;
};

/** Unknown response rate (never invited) ranks between responsive and non-responsive contributors. */
export const UNKNOWN_RESPONSE_RATE = 0.5;

/** FNV-1a 32-bit hash — small, fast and stable across platforms. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function invitedTime(value: Date | string | null): number {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function rankContributors<T extends SelectableContributor>(pool: readonly T[], seed: string): T[] {
  const tie = new Map(pool.map((c) => [c.id, hash32(`${seed}:${c.id}`)]));
  return [...pool].sort((a, b) => {
    const rate = (b.responseRate ?? UNKNOWN_RESPONSE_RATE) - (a.responseRate ?? UNKNOWN_RESPONSE_RATE);
    if (rate !== 0) return rate;
    const subs = b.submissionsCount - a.submissionsCount;
    if (subs !== 0) return subs;
    const invited = invitedTime(a.lastInvitedAt) - invitedTime(b.lastInvitedAt);
    if (invited !== 0) return invited;
    const t = (tie.get(a.id) ?? 0) - (tie.get(b.id) ?? 0);
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function targetKeyFor(contributor: Pick<SelectableContributor, "campusId">) {
  return contributor.campusId ?? SCHOOL_TARGET_KEY;
}

export function selectContributors<T extends SelectableContributor>(input: {
  contributors: readonly T[];
  groupIds: readonly string[];
  targets: SelectionTargets;
  seed?: string;
}): SelectionResult {
  const groups = new Set(input.groupIds);
  const seed = input.seed ?? "";
  const eligible = input.contributors.filter((c) => c.isActive && c.groupIds.some((g) => groups.has(g)));

  const buckets = new Map<string, T[]>();
  for (const c of eligible) {
    const key = targetKeyFor(c);
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }

  const selected: string[] = [];
  const byCampus: Record<string, number> = {};
  const shortfall: Record<string, number> = {};
  const pool: Record<string, number> = {};
  for (const [key, list] of buckets) pool[key] = list.length;

  const keys = Object.keys(input.targets).sort();
  for (const key of keys) {
    const target = Math.max(0, Math.floor(Number(input.targets[key]) || 0));
    if (target === 0) continue;
    const ranked = rankContributors(buckets.get(key) ?? [], seed);
    const take = ranked.slice(0, target);
    selected.push(...take.map((c) => c.id));
    byCampus[key] = take.length;
    shortfall[key] = Math.max(0, target - take.length);
    if (!(key in pool)) pool[key] = 0;
  }

  return { selected, byCampus, shortfall, pool };
}
