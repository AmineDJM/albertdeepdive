import { parseHex, type Rgb } from "./colour";

/**
 * How different two colours look to a person, in the unit colourists actually argue in.
 *
 * `distance()` next door answers "are these two the same colour or two different ones" and is
 * deliberately cheap. This answers a harder question — *how far off* is a colour that is nearly
 * right — and cheap is not good enough for it. Weighted sRGB distance says a navy and a slightly
 * different navy are close, which is true, and gives a number nobody can put a tolerance on.
 *
 * ΔE00 (CIE 142-2001) is the number the printing trade already has tolerances for: under 1 nobody
 * can see it, under 2 is a match in commercial work, 2–5 is visible side by side, over 5 is a
 * different colour. Those are the thresholds the quality engine quotes, which is the whole reason
 * for implementing the expensive formula rather than a proxy for it.
 *
 * The chain is sRGB → linear → CIE XYZ (D65) → CIE L*a*b* → ΔE00, with kL = kC = kH = 1 (graphic
 * arts). Everything here is pure arithmetic on numbers, so it is testable against the published
 * Sharma–Wu–Dalal pairs rather than against anybody's eye.
 */

export type Lab = { L: number; a: number; b: number };

/** D65, the white point sRGB is defined against. */
const WHITE = { x: 0.95047, y: 1.0, z: 1.08883 };

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);

export function srgbToLab({ r, g, b }: Rgb): Lab {
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / WHITE.x;
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / WHITE.y;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / WHITE.z;
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Lab for a hex colour, or null when it is not one. */
export function labOf(colour: string): Lab | null {
  const rgb = parseHex(colour);
  return rgb ? srgbToLab(rgb) : null;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (angle: number) => (angle < 0 ? angle + 360 : angle >= 360 ? angle - 360 : angle);

/**
 * ΔE00 between two Lab colours, the CIE 142-2001 formula in full.
 *
 * The parts nobody can skip: the `G` term that stretches a* so near-neutrals are not over-rated,
 * the hue difference that has to be taken the short way round the wheel, and `RT`, which corrects
 * the blue region where the ellipses rotate. Dropping any of them gives a plausible number that is
 * wrong exactly where a brand colour is most likely to be — blues and near-greys.
 */
export function deltaE00Lab(one: Lab, two: Lab, weights: { kL?: number; kC?: number; kH?: number } = {}): number {
  const { kL = 1, kC = 1, kH = 1 } = weights;

  const c1 = Math.hypot(one.a, one.b);
  const c2 = Math.hypot(two.a, two.b);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));

  const a1 = (1 + g) * one.a;
  const a2 = (1 + g) * two.a;
  const c1p = Math.hypot(a1, one.b);
  const c2p = Math.hypot(a2, two.b);
  const h1p = a1 === 0 && one.b === 0 ? 0 : wrap(deg(Math.atan2(one.b, a1)));
  const h2p = a2 === 0 && two.b === 0 ? 0 : wrap(deg(Math.atan2(two.b, a2)));

  const dL = two.L - one.L;
  const dC = c2p - c1p;

  const chroma = c1p * c2p;
  let dh = 0;
  if (chroma !== 0) {
    const raw = h2p - h1p;
    dh = Math.abs(raw) <= 180 ? raw : raw > 180 ? raw - 360 : raw + 360;
  }
  const dH = 2 * Math.sqrt(chroma) * Math.sin(rad(dh) / 2);

  const lBar = (one.L + two.L) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar: number;
  if (chroma === 0) hBar = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBar = (h1p + h2p) / 2;
  else hBar = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;

  const t = 1 - 0.17 * Math.cos(rad(hBar - 30)) + 0.24 * Math.cos(rad(2 * hBar)) + 0.32 * Math.cos(rad(3 * hBar + 6)) - 0.2 * Math.cos(rad(4 * hBar - 63));
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -Math.sin(rad(2 * dTheta)) * rC;

  const l = dL / (kL * sL);
  const c = dC / (kC * sC);
  const h = dH / (kH * sH);
  return Math.sqrt(l * l + c * c + h * h + rT * c * h);
}

/**
 * ΔE00 between two hex colours. Returns null when either is not a colour, because a missing brand
 * colour is a different problem from a wrong one and must not be reported as a distance of zero.
 */
export function deltaE00(a: string, b: string): number | null {
  const one = labOf(a);
  const two = labOf(b);
  if (!one || !two) return null;
  return deltaE00Lab(one, two);
}

/** The tolerances the trade uses, so a number can be turned into a sentence. */
export const DELTA_E_MATCH = 2;
export const DELTA_E_VISIBLE = 5;

export function describeDeltaE(value: number): string {
  if (value < 1) return "indistinguishable";
  if (value <= DELTA_E_MATCH) return "a commercial match";
  if (value <= DELTA_E_VISIBLE) return "visibly different side by side";
  return "a different colour";
}
