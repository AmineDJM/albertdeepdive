/**
 * In-memory sliding-window rate limiter for the public endpoints.
 *
 * Keyed by `${tokenHash}:${ipHash}` so one leaked link cannot be hammered from many IPs
 * without each IP being limited, and one IP cannot enumerate tokens. State lives in the
 * process (per instance); a shared store can replace `store` without touching callers.
 */
import { AppError } from "@/lib/action-result";

export type RateLimitRule = { limit: number; windowMs: number };

export const RATE_LIMITS = {
  /** Reads, autosaves, submit. */
  general: { limit: 60, windowMs: 10 * 60_000 },
  /** File uploads. */
  upload: { limit: 40, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number; limit: number };

const store = new Map<string, number[]>();
const MAX_KEYS = 50_000;
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000 && store.size < MAX_KEYS) return;
  lastSweep = now;
  for (const [key, hits] of store) {
    const cutoff = now - RATE_LIMITS.general.windowMs;
    const kept = hits.filter((t) => t > cutoff);
    if (kept.length) store.set(key, kept);
    else store.delete(key);
  }
}

export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  sweep(now);
  const cutoff = now - rule.windowMs;
  const hits = (store.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= rule.limit) {
    const oldest = hits[0] ?? now;
    store.set(key, hits);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)), limit: rule.limit };
  }
  hits.push(now);
  store.set(key, hits);
  return { allowed: true, remaining: rule.limit - hits.length, retryAfterSeconds: 0, limit: rule.limit };
}

export class RateLimitError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many requests — please slow down a little", "RATE_LIMITED", 429);
    this.name = "RateLimitError";
  }
}

/** Throws a 429 `RateLimitError` when the rule is exceeded. */
export function enforceRateLimit(key: string, rule: RateLimitRule, now = Date.now()) {
  const result = checkRateLimit(key, rule, now);
  if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
  return result;
}

/** Test hook. */
export function resetRateLimits() {
  store.clear();
}
