import { describe, expect, it } from "vitest";
import { MAX_HOLD_STRETCH, estimateSeconds, fitToScene, holdsForNarration, sceneStarts, wordsThatFit } from "@/lib/speech/timing";

describe("how long words take", () => {
  it("estimates from the rate, the pace and the breaths", () => {
    const words = Array.from({ length: 150 }, () => "word").join(" ") + ".";
    const natural = estimateSeconds(words, "en", "natural");
    expect(natural).toBeGreaterThan(58);
    expect(natural).toBeLessThan(64);
    expect(estimateSeconds(words, "en", "slow")).toBeGreaterThan(natural);
    expect(estimateSeconds(words, "en", "fast")).toBeLessThan(natural);
    expect(estimateSeconds(words, "fr", "natural")).toBeLessThan(natural);
  });

  it("says how many words a scene can carry", () => {
    expect(wordsThatFit(4, "en")).toBe(9);
    expect(wordsThatFit(0.2, "en")).toBe(0);
  });

  it("tells a scene's words to be cut before the voice is paid for", () => {
    const fits = fitToScene("Ten new companies joined this term.", 3, "en");
    expect(fits.fits).toBe(true);
    const long = fitToScene(Array.from({ length: 40 }, () => "word").join(" ") + ".", 3, "en");
    expect(long.fits).toBe(false);
    expect(long.maxWords).toBeLessThan(40);
    expect(long.overBySeconds).toBeGreaterThan(0);
  });

  it("holds a scene for its narration, and reports the ones held too long", () => {
    const { holds, overruns } = holdsForNarration([{ hold: 3 }, { hold: 3 }, { hold: 3 }], [2, 6, null]);
    expect(holds[0]).toBe(3);
    expect(holds[1]).toBeCloseTo(6.6, 1);
    expect(holds[2]).toBe(3);
    expect(overruns).toEqual([1]);
    expect(6.6).toBeGreaterThan(3 * MAX_HOLD_STRETCH);
  });

  it("starts scenes where the joins overlap", () => {
    expect(sceneStarts([3, 4, 2], 0.4)).toEqual([0, 2.6, 6.2]);
    expect(sceneStarts([3, 4], 0)).toEqual([0, 3]);
  });
});
