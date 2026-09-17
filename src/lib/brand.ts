/**
 * The Briefly platform brand.
 *
 * This is the product's own identity — the one on the sign-in page, the transactional emails and
 * the browser tab. It is deliberately separate from a *customer's* identity: a workspace publishes
 * under its own name, colours and masthead, and on the paid plans Briefly's own marks disappear
 * from what its readers see. Anything a reader of a publication looks at should come from the
 * organisation, not from here.
 */

export const BRAND = {
  name: "Briefly",
  /** The one line that says what the product is. */
  tagline: "Your organization, published.",
  description:
    "Briefly discovers what matters in your organization, turns it into beautiful content, and publishes it across email, web, social and print.",
  /** Near-black rather than pure black: it reads as ink on paper instead of as a screen. */
  ink: "#101014",
  paper: "#FBFBFA",
  /** Used sparingly — a signal colour, not a background. */
  accent: "#E0452B",
  domain: "briefly.press",
} as const;

export const DEFAULT_APP_NAME = BRAND.name;
