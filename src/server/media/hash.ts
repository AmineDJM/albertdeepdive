/** Perceptual hashing helpers (pure functions, unit-tested). */

/** dHash: 9x8 grayscale → 64-bit hash as 16 hex chars. `pixels` are row-major grayscale values of a 9x8 image. */
export function dHashFromGray(pixels: ArrayLike<number>, width = 9, height = 8): string {
  if (pixels.length < width * height) throw new Error("dHash expects a 9x8 grayscale buffer");
  let bits = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = pixels[y * width + x];
      const right = pixels[y * width + x + 1];
      bits += left > right ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Similarity 0..1 from the hamming distance of two 64-bit hashes. */
export function phashSimilarity(a: string, b: string): number {
  const d = hammingDistance(a, b);
  if (!Number.isFinite(d)) return 0;
  return 1 - d / 64;
}

export const DUPLICATE_THRESHOLD = 6; // ≤ 6 bits: near-duplicate
export const SIMILAR_THRESHOLD = 12; // ≤ 12 bits: visually similar
