import { describe, expect, it } from "vitest";
import { deltaE00, deltaE00Lab, describeDeltaE, labOf, srgbToLab } from "@/lib/brand/deltae";

/**
 * The published CIEDE2000 test pairs.
 *
 * Sharma, Wu and Dalal's thirty-four pairs exist precisely because the formula is easy to get
 * plausibly wrong: drop the `G` term and near-neutrals come out flattering; take the hue difference
 * the long way round the wheel and pairs 9–16 double; leave out `RT` and every blue is wrong by a
 * unit or two. Anything that passes all thirty-four to four decimals has all three.
 *
 * Source: Sharma, Wu & Dalal, "The CIEDE2000 Color-Difference Formula", Color Research &
 * Application 30(1), 2005, Table 1.
 */
const PAIRS: [number[], number[], number][] = [
  [[50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485], 2.0425],
  [[50.0, 3.1571, -77.2803], [50.0, 0.0, -82.7485], 2.8615],
  [[50.0, 2.8361, -74.02], [50.0, 0.0, -82.7485], 3.4412],
  [[50.0, -1.3802, -84.2814], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, -1.1848, -84.8006], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, -0.9009, -85.5211], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, 0.0, 0.0], [50.0, -1.0, 2.0], 2.3669],
  [[50.0, -1.0, 2.0], [50.0, 0.0, 0.0], 2.3669],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0009], 7.1792],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.001], 7.1792],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0011], 7.2195],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0012], 7.2195],
  [[50.0, -0.001, 2.49], [50.0, 0.0009, -2.49], 4.8045],
  [[50.0, -0.001, 2.49], [50.0, 0.001, -2.49], 4.8045],
  [[50.0, -0.001, 2.49], [50.0, 0.0011, -2.49], 4.7461],
  [[50.0, 2.5, 0.0], [50.0, 0.0, -2.5], 4.3065],
  [[50.0, 2.5, 0.0], [73.0, 25.0, -18.0], 27.1492],
  [[50.0, 2.5, 0.0], [61.0, -5.0, 29.0], 22.8977],
  [[50.0, 2.5, 0.0], [56.0, -27.0, -3.0], 31.903],
  [[50.0, 2.5, 0.0], [58.0, 24.0, 15.0], 19.4535],
  [[50.0, 2.5, 0.0], [50.0, 3.1736, 0.5854], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 3.2972, 0.0], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 1.8634, 0.5757], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 3.2592, 0.335], 1.0],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
];

const lab = ([L, a, b]: number[]) => ({ L, a, b });

describe("CIEDE2000", () => {
  it("reproduces all thirty-four published pairs to four decimals", () => {
    for (const [one, two, expected] of PAIRS) {
      expect(deltaE00Lab(lab(one), lab(two))).toBeCloseTo(expected, 4);
    }
  });

  it("is symmetric", () => {
    for (const [one, two] of PAIRS) {
      expect(deltaE00Lab(lab(one), lab(two))).toBeCloseTo(deltaE00Lab(lab(two), lab(one)), 10);
    }
  });

  it("is zero between a colour and itself", () => {
    for (const hex of ["#000000", "#FFFFFF", "#2BAFE0", "#C2603C", "#7B7B7B"]) {
      expect(deltaE00(hex, hex)).toBe(0);
    }
  });

  it("puts sRGB primaries where Lab says they are", () => {
    expect(srgbToLab({ r: 255, g: 255, b: 255 }).L).toBeCloseTo(100, 4);
    expect(srgbToLab({ r: 0, g: 0, b: 0 }).L).toBeCloseTo(0, 4);
    // A neutral is neutral to the precision the white point is published at: D65 is quoted as
    // 0.95047/1.08883, so asking for more decimals than that measures the rounding, not the maths.
    const grey = srgbToLab({ r: 128, g: 128, b: 128 });
    expect(grey.a).toBeCloseTo(0, 4);
    expect(grey.b).toBeCloseTo(0, 4);
  });

  it("refuses to answer for something that is not a colour", () => {
    expect(labOf("teal")).toBeNull();
    expect(deltaE00("#2BAFE0", "not a colour")).toBeNull();
  });

  it("calls a hair's difference a match and a different hue a different colour", () => {
    // #2BAFE0 against itself nudged by one step of blue: invisible.
    const nudged = deltaE00("#2BAFE0", "#2BAFE1")!;
    expect(nudged).toBeLessThan(1);
    expect(describeDeltaE(nudged)).toBe("indistinguishable");
    // The brand's blue against the brand's orange.
    const far = deltaE00("#2BAFE0", "#C2603C")!;
    expect(far).toBeGreaterThan(5);
    expect(describeDeltaE(far)).toBe("a different colour");
  });
});
