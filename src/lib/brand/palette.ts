/**
 * Briefly's own spectrum.
 *
 * Colourful, in the sense Google's palette is colourful rather than the sense a confetti cannon is:
 * every hue means something, and once you have learned what, the colour is telling you where you
 * are before you have read a word. Amber is always money. Teal is always audience. Cobalt is always
 * the product speaking as itself.
 *
 * The craft is in the sameness. All seven hues sit at the same lightness and chroma in OKLCH, which
 * is a perceptual space, so no colour shouts over its neighbours and a row of them reads as one
 * family rather than as seven decisions. That is the whole trick behind a palette that looks
 * designed: pick the hues freely, then hold everything else absolutely constant.
 *
 * Four steps per hue, and each is for one job:
 *   solid — a filled chip, a chart series, an icon that must carry at distance
 *   soft  — a background wash, always with `deep` or `ink` on top
 *   deep  — text or an icon on `soft`, and the solid step in dark mode
 *   dark  — the soft step in dark mode
 */

export const HUES = ["cobalt", "violet", "magenta", "coral", "amber", "green", "teal"] as const;
export type Hue = (typeof HUES)[number];

/** Degrees in OKLCH. Chosen for even spacing by eye, not by arithmetic — 60° steps put two greens next to each other. */
const ANGLE: Record<Hue, number> = {
  // Read off the logo: its indigo corner is the product's own colour, the rest of its sweep gives
  // the others their angle. Green is the one hue the logo does not carry; "done" still needs it.
  cobalt: 275,
  violet: 292,
  magenta: 328,
  coral: 18,
  amber: 86,
  green: 150,
  teal: 190,
};

/**
 * Chroma per hue, and why it is not one number.
 *
 * sRGB cannot hold the same chroma at every angle — ask for 0.16 at 148° and you get a green that
 * clips to something muddier than the blue beside it. These are the highest chroma each hue can
 * actually reach at L 0.62 while staying in gamut, which is what keeps them looking equally vivid
 * rather than equally *specified*.
 */
const CHROMA: Record<Hue, number> = {
  cobalt: 0.19,
  violet: 0.18,
  magenta: 0.18,
  coral: 0.17,
  amber: 0.145,
  green: 0.145,
  teal: 0.125,
};

type Step = "solid" | "soft" | "deep" | "dark";

const LIGHTNESS: Record<Step, number> = { solid: 0.62, soft: 0.955, deep: 0.45, dark: 0.29 };
const CHROMA_SCALE: Record<Step, number> = { solid: 1, soft: 0.22, deep: 0.92, dark: 0.45 };

export function oklch(hue: Hue, step: Step): string {
  return `oklch(${LIGHTNESS[step]} ${(CHROMA[hue] * CHROMA_SCALE[step]).toFixed(3)} ${ANGLE[hue]})`;
}

export const PALETTE = Object.fromEntries(
  HUES.map((hue) => [hue, { solid: oklch(hue, "solid"), soft: oklch(hue, "soft"), deep: oklch(hue, "deep"), dark: oklch(hue, "dark") }]),
) as Record<Hue, Record<Step, string>>;

/**
 * Hex, for the places CSS cannot reach.
 *
 * Email clients, `ImageResponse`, the favicon and anything sent to a printer need a value they can
 * parse today. Converted from the same OKLCH rather than picked by eye, so the mark in a browser tab
 * is the mark in the product.
 */
export const HEX: Record<Hue, string> = {
  cobalt: "#5F63F2",
  violet: "#8A5CEB",
  magenta: "#D64FB0",
  coral: "#E85F5A",
  amber: "#BE8B12",
  green: "#2E9B5F",
  teal: "#2496A8",
};

/**
 * The logo's own colours, exactly as sampled from it.
 *
 * For the places the identity itself appears — the sign-in screen, the marketing site, an
 * illustration — not for the interface, which uses the one indigo and the neutrals. A product with
 * the whole sweep across its buttons is a toy; a product with it only in its mark is a brand.
 */
export const LOGO_COLOURS = {
  indigo: "#5F6AF6",
  purple: "#8276F5",
  blue: "#60B4F1",
  teal: "#6CDED1",
  yellow: "#F6DC8E",
  pink: "#F5A8B8",
  magenta: "#D970DD",
  ink: "#181820",
} as const;

/**
 * What each hue is for.
 *
 * Written down because a palette without assignments becomes decoration within a month: somebody
 * needs a second colour on a chart, reaches for violet, and now violet means nothing.
 */
export const HUE_MEANING: Record<Hue, string> = {
  cobalt: "Briefly itself — the product speaking, and anything about the whole workspace",
  violet: "Publications and editions: the things being made",
  magenta: "Creative and design: brand, layout, anything visual",
  coral: "Attention — errors, overdue work, content waiting for a decision, things that will not publish",
  amber: "Money: plans, invoices, usage against a limit, AI spend",
  green: "Done, sent, published, healthy",
  teal: "Audience: subscribers, contributors, the people on the other end",
};

/** The Briefly gradient, used by the mark and nowhere that needs to be read. */
export const GRADIENT = [LOGO_COLOURS.indigo, LOGO_COLOURS.teal, LOGO_COLOURS.pink] as const;
