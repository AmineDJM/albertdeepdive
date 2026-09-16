/**
 * Pure analytics helpers (no database): ratios, averages, date bucketing, histograms.
 */
import { zonedParts } from "@/lib/campaigns/schedule";

export function safeRatio(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

/** Share of invited contributors who submitted, 0..1 (0 when nobody was invited). */
export function responseRate(invited: number, responded: number): number {
  return Math.min(1, safeRatio(responded, invited));
}

/** Mean of the non-null values, or null when there is nothing to average. */
export function averageOf(values: readonly (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function hoursBetween(from: Date | string, to: Date | string): number {
  const a = from instanceof Date ? from : new Date(from);
  const b = to instanceof Date ? to : new Date(to);
  return (b.getTime() - a.getTime()) / 3_600_000;
}

export type DayBucket = { day: string; label: string; count: number; cumulative: number };

const MAX_DAYS = 62;

function dayKey(date: Date | string, timezone: string) {
  const p = zonedParts(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function dayLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Zero-filled daily buckets (in the school's timezone) covering `range`, extended to include any
 * point outside it. Points can be pre-aggregated (`{ day: "YYYY-MM-DD", count }`) or raw instants.
 */
export function bucketByDay(
  points: readonly ({ at: Date | string; count?: number } | { day: string; count: number })[],
  range: { start: Date | string; end: Date | string } | null,
  timezone = "Europe/Paris",
): DayBucket[] {
  const counts = new Map<string, number>();
  for (const p of points) {
    const key = "day" in p ? p.day : dayKey(p.at, timezone);
    counts.set(key, (counts.get(key) ?? 0) + ("count" in p && typeof p.count === "number" ? p.count : 1));
  }
  const keys = [...counts.keys()].sort();
  let start = range ? dayKey(range.start, timezone) : keys[0];
  let end = range ? dayKey(range.end, timezone) : keys[keys.length - 1];
  if (!start || !end) return [];
  if (keys[0] && keys[0] < start) start = keys[0];
  if (keys[keys.length - 1] && keys[keys.length - 1] > end) end = keys[keys.length - 1];
  const out: DayBucket[] = [];
  const [y, m, d] = start.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  let cumulative = 0;
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    const count = counts.get(key) ?? 0;
    cumulative += count;
    out.push({ day: key, label: dayLabel(key), count, cumulative });
    if (key >= end) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export type HistogramBucket = { label: string; from: number; to: number; count: number };

/** Counts values into [from, to) buckets; the last bucket is closed so 1.0 lands in "75–100%". */
export function histogram(values: readonly number[], edges: readonly number[] = [0, 0.25, 0.5, 0.75, 1]): HistogramBucket[] {
  const buckets: HistogramBucket[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const from = edges[i];
    const to = edges[i + 1];
    const last = i === edges.length - 2;
    buckets.push({ label: `${Math.round(from * 100)}–${Math.round(to * 100)}%`, from, to, count: values.filter((v) => v >= from && (last ? v <= to : v < to)).length });
  }
  return buckets;
}

export function percentLabel(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function centsToEur(cents: number | null | undefined): number {
  return (cents ?? 0) / 100;
}

/** "1h 45m" / "3d 2h" from a number of hours. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${Math.round(hours - days * 24)}h`;
}
