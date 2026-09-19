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
  /**
   * Contributors invited to the previous edition. By default they are held back so the rota moves
   * through the pool. If excluding them leaves a campus short of its target, the freshest of them
   * are topped up (never inventing anyone) — unless `strictExclude` forbids even that.
   */
  excludeIds?: Iterable<string>;
  strictExclude?: boolean;
}): SelectionResult {
  const groups = new Set(input.groupIds);
  const seed = input.seed ?? "";
  const excluded = new Set(input.excludeIds ?? []);
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
    const fresh = ranked.filter((c) => !excluded.has(c.id));
    const held = ranked.filter((c) => excluded.has(c.id));
    // Fresh contributors first; only if a campus is still short and strictExclude is off do we
    // bring the previous edition's people back, freshest-first.
    const order = input.strictExclude ? fresh : [...fresh, ...held];
    const take = order.slice(0, target);
    selected.push(...take.map((c) => c.id));
    byCampus[key] = take.length;
    shortfall[key] = Math.max(0, target - take.length);
    if (!(key in pool)) pool[key] = 0;
  }

  return { selected, byCampus, shortfall, pool };
}

/**
 * The simple draw: "six of these twenty-eight", ignoring which campus anybody is at.
 *
 * The per-campus version above exists because a school newsroom wants two voices from each site.
 * Most newsletters do not: they have a pool of people and want a handful of them this month, and
 * expressing that as a campus target is a costume the idea has to wear for no reason.
 *
 * Same ranking, same exclusion, same seed — so the two modes differ only in how the pool is
 * divided, and a draw is reproducible: asking twice gives the same six, which is what makes it
 * possible to show somebody who was drawn before the invitations go out.
 */
export function drawFromPool<T extends SelectableContributor>(input: {
  contributors: readonly T[];
  groupIds: readonly string[];
  count: number;
  seed?: string;
  excludeIds?: Iterable<string>;
  strictExclude?: boolean;
}): SelectionResult {
  const groups = new Set(input.groupIds);
  const excluded = new Set(input.excludeIds ?? []);
  const eligible = input.contributors.filter((c) => c.isActive && (groups.size === 0 || c.groupIds.some((g) => groups.has(g))));
  const count = Math.max(0, Math.floor(Number(input.count) || 0));

  const ranked = rankContributors(eligible, input.seed ?? "");
  const fresh = ranked.filter((c) => !excluded.has(c.id));
  const held = ranked.filter((c) => excluded.has(c.id));
  // Whoever has not been asked lately comes first; last edition's people are only brought back
  // when the pool is too small to fill the number and the rota rule allows it.
  const order = input.strictExclude ? fresh : [...fresh, ...held];
  const take = order.slice(0, count);

  return {
    selected: take.map((c) => c.id),
    byCampus: { [SCHOOL_TARGET_KEY]: take.length },
    shortfall: { [SCHOOL_TARGET_KEY]: Math.max(0, count - take.length) },
    pool: { [SCHOOL_TARGET_KEY]: eligible.length },
  };
}

/** How a campaign decides who to ask. */
export const SELECTION_MODES = ["DRAW", "GROUP", "PEOPLE"] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

export function isSelectionMode(value: unknown): value is SelectionMode {
  return typeof value === "string" && (SELECTION_MODES as readonly string[]).includes(value);
}
