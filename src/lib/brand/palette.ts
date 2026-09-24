/**
 * Briefly's own spectrum.
 *
 * Colourful, in the sense Google's palette is colourful rather than the sense a confetti cannon is
 * (and on Google's own hues where the two meet): every hue means something, and once you have learned what, the colour is telling you where you
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
  // Google's own angles for the four it shares with us — blue, red, yellow, green — so the interface
  // and the logo are one family; violet, magenta and teal fill the gaps between them.
  cobalt: 259,
  violet: 295,
  magenta: 330,
  coral: 27,
  amber: 80,
  green: 150,
  teal: 205,
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
  violet: 0.19,
  magenta: 0.19,
  coral: 0.19,
  amber: 0.15,
  green: 0.155,
  teal: 0.12,
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
  cobalt: "#3581F6",
  violet: "#9167EA",
  magenta: "#C252BB",
  coral: "#E24942",
  amber: "#B47900",
  green: "#279F50",
  teal: "#009C9C",
};

/**
 * Google's four, exactly, and the two that complete them.
 *
 * For the places the identity itself appears — the logo, the sign-in screen, the marketing site, a
 * newsletter's dot in the sidebar — not for the interface, which uses the spectrum above and the
 * neutrals. A product with the whole sweep across its buttons is a toy; a product with it only in
 * its mark is a brand.
 */
export const GOOGLE = {
  blue: "#4285F4",
  red: "#EA4335",
  yellow: "#FBBC04",
  green: "#34A853",
  violet: "#A142F4",
  teal: "#12B5CB",
  ink: "#1D1D1F",
} as const;

/** The Briefly sweep — blue, red, yellow, green — used by the mark and nowhere that needs to be read. */
export const GRADIENT = [GOOGLE.blue, GOOGLE.red, GOOGLE.yellow, GOOGLE.green] as const;

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
