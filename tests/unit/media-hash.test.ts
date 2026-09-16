import { describe, expect, it } from "vitest";
import {
  dHashFromGray,
  DUPLICATE_THRESHOLD,
  hammingDistance,
  phashSimilarity,
  SIMILAR_THRESHOLD,
} from "@/server/media/hash";

/** 9×8 grayscale gradient. Increasing: every pixel brighter than its left neighbour → no bit set; decreasing → all bits set. */
function gradient(width = 9, height = 8, direction: "increasing" | "decreasing" = "increasing") {
  const px: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) px.push((direction === "increasing" ? x : width - 1 - x) * 20);
  return px;
}

describe("dHashFromGray", () => {
  it("produces a 16-hex-char (64-bit) hash", () => {
    const hash = dHashFromGray(gradient());
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("sets a bit when the left pixel is brighter than its right neighbour", () => {
    expect(dHashFromGray(gradient(9, 8, "decreasing"))).toBe("ffffffffffffffff");
    expect(dHashFromGray(gradient(9, 8, "increasing"))).toBe("0000000000000000");
    expect(dHashFromGray(new Array(72).fill(128))).toBe("0000000000000000");
  });

  it("is invariant to brightness changes (only relative differences count)", () => {
    const base = gradient();
    const brighter = base.map((v) => Math.min(255, v + 60));
    expect(dHashFromGray(base)).toBe(dHashFromGray(brighter));
  });

  it("changes when the image changes", () => {
    const base = gradient();
    const flipped = [...base];
    // Flip the direction of the first two rows.
    for (let y = 0; y < 2; y++) for (let x = 0; x < 9; x++) flipped[y * 9 + x] = (8 - x) * 20;
    expect(dHashFromGray(flipped)).not.toBe(dHashFromGray(base));
    expect(hammingDistance(dHashFromGray(flipped), dHashFromGray(base))).toBe(16);
  });

  it("rejects buffers that are too small", () => {
    expect(() => dHashFromGray([1, 2, 3])).toThrow(/9x8/);
  });
});

describe("hammingDistance", () => {
  it("is 0 for identical hashes and 64 for complementary ones", () => {
    expect(hammingDistance("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
  });

  it("counts differing bits across hex digits", () => {
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
    expect(hammingDistance("a5a5a5a5a5a5a5a5", "5a5a5a5a5a5a5a5a")).toBe(64);
  });

  it("is infinite for hashes of different lengths", () => {
    expect(hammingDistance("abc", "abcd")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("phashSimilarity and thresholds", () => {
  it("maps distance to a 0..1 similarity", () => {
    expect(phashSimilarity("ffffffffffffffff", "ffffffffffffffff")).toBe(1);
    expect(phashSimilarity("ffffffffffffffff", "0000000000000000")).toBe(0);
    expect(phashSimilarity("0000000000000000", "00000000000000ff")).toBeCloseTo(1 - 8 / 64);
    expect(phashSimilarity("abc", "abcd")).toBe(0);
  });

  it("keeps the near-duplicate threshold tighter than the similar threshold", () => {
    expect(DUPLICATE_THRESHOLD).toBeLessThan(SIMILAR_THRESHOLD);
    expect(DUPLICATE_THRESHOLD).toBe(6);
    expect(SIMILAR_THRESHOLD).toBe(12);
  });
});
