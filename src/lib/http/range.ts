/**
 * One byte range, or nothing.
 *
 * Only the single-range form, which is all any player sends. A multipart range response is a
 * different content type and a good deal of machinery for a case that does not arise; an unparseable
 * or multi-range header falls back to the whole file, which is always a correct answer.
 */
export function parseRange(header: string, total: number): { start: number; end: number } | "unsatisfiable" | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || total === 0) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  // `bytes=-500` means the last 500 bytes, not "up to 500".
  const start = rawStart ? Number(rawStart) : Math.max(0, total - Number(rawEnd));
  const end = rawStart ? (rawEnd ? Math.min(Number(rawEnd), total - 1) : total - 1) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) return "unsatisfiable";
  return { start, end };
}
