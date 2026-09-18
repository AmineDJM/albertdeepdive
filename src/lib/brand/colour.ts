/**
 * Colour, as arithmetic rather than as taste.
 *
 * Everything Briefly renders is drawn from a customer's own colours, and a customer's own colours
 * are whatever their website happened to use — a yellow, a near-white, two greys that are almost the
 * same grey. A design system that trusts those values produces unreadable slides. So nothing here
 * takes a colour on faith: a foreground is only used once it has been checked, and nudged if it
 * fails, against the surface it will actually sit on.
 *
 * WCAG relative luminance and contrast ratio, in sRGB, with no dependency. The maths is fixed by the
 * spec, so the same brand always compiles to the same tokens — which is what makes a rendered
 * carousel reproducible and a golden test meaningful.
 */

export type Rgb = { r: number; g: number; b: number };

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(value: string): Rgb | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const digits = match[1];
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** A hex string we are sure of, or the fallback. Callers never have to guard. */
export function safeHex(value: string | null | undefined, fallback: string): string {
  const parsed = value ? parseHex(value) : null;
  return parsed ? toHex(parsed) : fallback;
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(colour: string | Rgb): number {
  const rgb = typeof colour === "string" ? parseHex(colour) : colour;
  if (!rgb) return 0;
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  const [light, dark] = x > y ? [x, y] : [y, x];
  return (light + 0.05) / (dark + 0.05);
}

export function isLight(colour: string): boolean {
  return relativeLuminance(colour) > 0.42;
}

export function mix(a: string, b: string, amount: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  const t = Math.max(0, Math.min(1, amount));
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

export const lighten = (colour: string, amount: number) => mix(colour, "#FFFFFF", amount);
export const darken = (colour: string, amount: number) => mix(colour, "#000000", amount);

/** Whichever candidate reads best on this background. Ties go to the first, so it stays stable. */
export function readableOn(background: string, candidates: string[]): string {
  let best = candidates[0];
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio + 1e-9) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/**
 * The same colour, dark enough (or light enough) to be read on that background.
 *
 * Walks toward black or white — whichever of the two actually reads better on this background —
 * until the ratio is met, keeping as much of the original hue as the requirement allows. A brand
 * yellow stays recognisably the brand yellow; it just stops being invisible on white.
 *
 * The direction is measured, not guessed from lightness. A mid-tone terracotta looks dark enough to
 * want white type and is not: black beats white on it by half again. Picking the wrong end is how
 * you produce white-on-tan and call it accessible.
 *
 * Because the better of black and white is never worse than about 4.58:1 against any colour — the
 * two curves cross at luminance 0.179 — a 4.5 minimum is always reachable. Higher minimums may not
 * be, so the search is bounded and returns the extreme rather than looping.
 */
export function ensureContrast(foreground: string, background: string, minimum = 4.5): string {
  if (contrastRatio(foreground, background) >= minimum) return foreground;
  const target = readableOn(background, ["#000000", "#FFFFFF"]);
  if (contrastRatio(target, background) < minimum) return target;

  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i += 1) {
    const middle = (low + high) / 2;
    if (contrastRatio(mix(foreground, target, middle), background) >= minimum) high = middle;
    else low = middle;
  }
  return mix(foreground, target, high);
}

/**
 * How far apart two colours are perceptually, 0–1.
 *
 * Weighted sRGB distance — not CIEDE2000, but enough to answer the only question asked of it: are
 * these two brand colours actually different, or did the site use the same blue twice?
 */
export function distance(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return 1;
  const rMean = (x.r + y.r) / 2;
  const dr = x.r - y.r;
  const dg = x.g - y.g;
  const db = x.b - y.b;
  const weighted = (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
  return Math.min(1, Math.sqrt(weighted) / 764.83);
}

/**
 * Hue in degrees, 0–360. Red is 0, green 120, blue 240.
 *
 * HSL rather than OKLCH: the question asked of it is "how far apart on the wheel", and for that the
 * cheap answer and the expensive one agree to within a few degrees. Grey has no hue and returns 0,
 * which callers must not read as red — every one of them checks saturation first.
 */
export function hue(colour: string): number {
  const rgb = parseHex(colour);
  if (!rgb) return 0;
  const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const chroma = max - min;
  const raw = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return ((raw * 60) % 360 + 360) % 360;
}

/** Saturation in HSL terms, 0 (grey) to 1. Used to prefer a brand colour over a background wash. */
export function saturation(colour: string): number {
  const rgb = parseHex(colour);
  if (!rgb) return 0;
  const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  return lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}
