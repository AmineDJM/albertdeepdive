import { distance, isLight, safeHex, saturation } from "./colour";
import { PERSONALITY_KEYS, type PersonalityKey } from "./typography";
import { DEFAULT_BRAND_SYSTEM, type BrandSystem, type ImageryTreatment } from "./system";

/**
 * Brand DNA, inferred from what a website already shows.
 *
 * Onboarding reads a customer's site and comes back with some colours and some font names. This
 * turns that into a starting BrandSystem — not a final answer, a first draft good enough that most
 * people will change one thing and move on. Every field records where it came from, so the editor
 * can say "we found this" rather than presenting a guess as a decision.
 *
 * Inference is deliberately conservative. A site that tells us nothing gets the defaults, which look
 * deliberate; a site that tells us one thing gets that one thing honoured and the rest defaulted.
 * Guessing hard from thin evidence is how you end up confidently wrong about somebody's identity.
 */

export type BrandEvidence = {
  /** Colours ranked by prominence, as the site used them. */
  colours: string[];
  /** `font-family` values seen in the page's own CSS, in any order. */
  fonts: string[];
  logoUrl: string | null;
  /** The organisation type onboarding guessed, which carries real signal about tone. */
  type?: string | null;
};

export type BrandOrigin = "discovered" | "default";
export type DiscoveredBrand = {
  system: BrandSystem;
  /** Which parts came from the site, so the editor can mark the rest as ours. */
  origin: Record<"brand" | "accent" | "ink" | "paper" | "personality" | "logo", BrandOrigin>;
  notes: string[];
};

const SERIF_HINTS = ["georgia", "times", "garamond", "playfair", "merriweather", "lora", "freight", "tiempos", "canela", "serif"];
const MONO_HINTS = ["mono", "courier", "consolas", "menlo", "jetbrains", "space mono"];
const GEOMETRIC_HINTS = ["futura", "poppins", "montserrat", "circular", "gilroy", "avenir", "century gothic"];

function familyHints(fonts: string[]): { serif: number; mono: number; geometric: number } {
  const all = fonts.join(" ").toLowerCase();
  const count = (hints: string[]) => hints.reduce((n, hint) => n + (all.includes(hint) ? 1 : 0), 0);
  return { serif: count(SERIF_HINTS), mono: count(MONO_HINTS), geometric: count(GEOMETRIC_HINTS) };
}

/**
 * Which of the four personalities this site is already closest to.
 *
 * Font names first, because they are the strongest evidence a stylesheet offers, then the
 * organisation type as a tiebreak — a university reads editorial, a fund reads modern. Nothing here
 * pretends to more certainty than it has: with no fonts and no type, the answer is the default.
 */
export function inferPersonality(evidence: BrandEvidence): { personality: PersonalityKey; origin: BrandOrigin } {
  const hints = familyHints(evidence.fonts);
  if (hints.mono > 0) return { personality: "technical", origin: "discovered" };
  if (hints.serif > 0) return { personality: hints.serif > 1 ? "editorial" : "warm", origin: "discovered" };
  if (hints.geometric > 0) return { personality: "warm", origin: "discovered" };

  switch (evidence.type) {
    case "UNIVERSITY":
    case "SCHOOL":
    case "MEDIA":
      return { personality: "editorial", origin: "default" };
    case "INVESTOR":
    case "COMPANY":
      return { personality: "modern", origin: "default" };
    case "ASSOCIATION":
    case "COMMUNITY":
      return { personality: "warm", origin: "default" };
    default:
      return { personality: DEFAULT_BRAND_SYSTEM.personality, origin: "default" };
  }
}

/**
 * A brand colour and an accent, from a list of colours a site happened to use.
 *
 * The brand colour is the most saturated prominent one — a site's real colour, not the grey its body
 * text is set in. The accent must be *different*: a brand whose accent is its own brand colour has
 * no accent, and every highlight on every slide would disappear into the background it sits on.
 */
export function pickBrandColours(colours: string[]): { brand: string; accent: string; found: boolean } {
  const usable = colours.map((c) => safeHex(c, "")).filter(Boolean);
  if (!usable.length) return { brand: DEFAULT_BRAND_SYSTEM.colours.brand, accent: DEFAULT_BRAND_SYSTEM.colours.accent, found: false };

  // Prominence is the order we were given; saturation breaks the tie toward the colour a person
  // would actually name. Weighting rather than sorting purely by saturation keeps a muted but
  // genuinely-used navy ahead of a single bright link colour.
  const ranked = usable
    .map((hex, index) => ({ hex, score: saturation(hex) * 0.7 + (1 - index / usable.length) * 0.3 }))
    .sort((a, b) => b.score - a.score);

  const brand = ranked[0].hex;
  const contender = ranked.slice(1).find((c) => distance(c.hex, brand) > 0.22);
  return { brand, accent: contender ? contender.hex : DEFAULT_BRAND_SYSTEM.colours.accent, found: true };
}

function treatmentFor(personality: PersonalityKey): ImageryTreatment {
  switch (personality) {
    case "editorial":
      return "editorial";
    case "technical":
      return "duotone";
    case "modern":
      return "mono";
    default:
      return "natural";
  }
}

export function brandFromEvidence(evidence: BrandEvidence): DiscoveredBrand {
  const notes: string[] = [];
  const { brand, accent, found } = pickBrandColours(evidence.colours);
  const { personality, origin: personalityOrigin } = inferPersonality(evidence);

  if (!found) notes.push("We could not read any colours from your site, so these are ours to start with.");
  else if (accent === DEFAULT_BRAND_SYSTEM.colours.accent) notes.push("Your site uses one strong colour, so we chose a second that works with it.");
  if (personalityOrigin === "default") notes.push("We could not tell which typefaces your site uses, so we chose a personality from what you do.");
  if (!evidence.logoUrl) notes.push("Add your logo and it will appear on everything Briefly publishes.");

  // Ink and paper are ours, always. A site's body text colour is usually a grey chosen for one
  // background; reusing it as the ink of a whole design system is how you get unreadable slides.
  // What the site *does* tell us is whether it runs light or dark, and we honour that.
  const darkSite = evidence.colours.length > 0 && !isLight(evidence.colours[0]) && saturation(evidence.colours[0]) < 0.12;
  const ink = DEFAULT_BRAND_SYSTEM.colours.ink;
  const paper = darkSite ? "#0E1013" : DEFAULT_BRAND_SYSTEM.colours.paper;
  if (darkSite) notes.push("Your site runs dark, so we started there too.");

  return {
    system: {
      ...DEFAULT_BRAND_SYSTEM,
      colours: { brand, accent, ink, paper },
      personality,
      imagery: { ...DEFAULT_BRAND_SYSTEM.imagery, treatment: treatmentFor(personality) },
      logo: { ...DEFAULT_BRAND_SYSTEM.logo, markUrl: evidence.logoUrl },
    },
    origin: {
      brand: found ? "discovered" : "default",
      accent: found && accent !== DEFAULT_BRAND_SYSTEM.colours.accent ? "discovered" : "default",
      ink: "default",
      paper: darkSite ? "discovered" : "default",
      personality: personalityOrigin,
      logo: evidence.logoUrl ? "discovered" : "default",
    },
    notes,
  };
}

/** `font-family` declarations, out of a stylesheet or an inline style block. */
export function extractFontFamilies(css: string): string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(/font-family\s*:\s*([^;}]{3,200})/gi)) {
    for (const part of match[1].split(",")) {
      const name = part.replace(/["']/g, "").trim().toLowerCase();
      if (name && name.length < 40 && !name.startsWith("var(")) found.add(name);
    }
    if (found.size > 40) break;
  }
  return [...found];
}

export const PERSONALITY_OPTIONS = PERSONALITY_KEYS;
