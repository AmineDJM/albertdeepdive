/**
 * What each destination requires, in one place and versioned with the rest of the standard.
 *
 * The numbers that differ between a screen PDF and a printer's PDF are not thresholds in the
 * quality rules; they belong to the destination. A printer that asks for 240 PPI and 5mm of bleed
 * is not failing a standard, it has a different one — so the rule says "reach the profile's
 * minimum" and the profile says what the minimum is.
 *
 * Scattered constants are how the alternative goes wrong: a page size in the renderer, a bleed in a
 * template, a PPI floor in a validator, and no way to change a printer without finding all three.
 */

export type ColorSpace = "RGB" | "CMYK";

export type OutputProfile = {
  id: string;
  title: string;
  kind: "paged" | "email" | "web" | "fixed-image" | "video";
  /** Trim size in millimetres, for anything paged. */
  trimMm?: { width: number; height: number };
  bleedMm?: number;
  safeMarginMm?: number;
  /** The floor an image must reach at the size it is placed. */
  minimumPpi?: number;
  /** Below this, a warning rather than a failure. */
  warnPpi?: number;
  requiredColorSpace?: ColorSpace;
  /** PDF conformance the artefact claims, where one applies. */
  pdfStandard?: string;
  /** Viewport in pixels, for anything rendered to a screen. */
  viewportPx?: { width: number; height: number };
  /** Canvas in pixels, for fixed-image outputs. */
  canvasPx?: { width: number; height: number };
  notes: string;
};

const A4 = { width: 210, height: 297 };

export const PROFILES: Record<string, OutputProfile> = {
  /** A PDF to be read on a screen: no bleed, no colour conversion, a lower resolution floor. */
  PDF_SCREEN: {
    id: "PDF_SCREEN",
    title: "PDF for reading on screen",
    kind: "paged",
    trimMm: A4,
    bleedMm: 0,
    safeMarginMm: 10,
    minimumPpi: 144,
    warnPpi: 200,
    requiredColorSpace: "RGB",
    notes: "The default export. Read at 100% on a laptop, so 144 PPI is the floor and 200 the comfortable band.",
  },

  /**
   * A commercial print run. 300 PPI and 3mm of bleed are the usual ask in Europe, which is why they
   * are the defaults — not because they are universal. A printer with other requirements gets
   * another profile rather than an argument.
   */
  PRINT: {
    id: "PRINT",
    title: "Commercial print",
    kind: "paged",
    trimMm: A4,
    bleedMm: 3,
    safeMarginMm: 5,
    minimumPpi: 300,
    warnPpi: 350,
    requiredColorSpace: "CMYK",
    pdfStandard: "PDF/X-4",
    notes: "3mm bleed on A4 means a 216×303mm document. Anything important stays 5mm inside the trim.",
  },

  EMAIL: {
    id: "EMAIL",
    title: "Email",
    kind: "email",
    viewportPx: { width: 375, height: 812 },
    minimumPpi: 72,
    notes: "375px is the narrow phone every newsletter is read on. Nothing may scroll sideways there.",
  },

  WEB: {
    id: "WEB",
    title: "Web edition",
    kind: "web",
    viewportPx: { width: 390, height: 844 },
    notes: "Rendered when it is read, so the checks are about metadata, links and indexing rather than geometry.",
  },

  CAROUSEL: { id: "CAROUSEL", title: "Carousel", kind: "fixed-image", canvasPx: { width: 1080, height: 1350 }, notes: "4:5, the tallest a feed shows without cropping." },
  STORY: { id: "STORY", title: "Story", kind: "fixed-image", canvasPx: { width: 1080, height: 1920 }, notes: "9:16 full bleed." },
  SOCIAL_POST: { id: "SOCIAL_POST", title: "Post", kind: "fixed-image", canvasPx: { width: 1080, height: 1080 }, notes: "Square." },
  VIDEO_VERTICAL: { id: "VIDEO_VERTICAL", title: "Vertical video", kind: "video", canvasPx: { width: 1080, height: 1920 }, notes: "9:16." },
  VIDEO_HORIZONTAL: { id: "VIDEO_HORIZONTAL", title: "Landscape video", kind: "video", canvasPx: { width: 1920, height: 1080 }, notes: "16:9." },
};

export const DEFAULT_PROFILE = "PDF_SCREEN";

export function profile(id: string): OutputProfile {
  const found = PROFILES[id];
  if (!found) throw new Error(`Unknown output profile "${id}". Profiles are ${Object.keys(PROFILES).join(", ")}.`);
  return found;
}

/** Millimetres to PDF points, which is what a page box is measured in. */
export const mmToPt = (mm: number): number => (mm / 25.4) * 72;
export const ptToMm = (pt: number): number => (pt / 72) * 25.4;

/** The document size a paged profile expects: trim plus bleed on every edge. */
export function documentSizeMm(p: OutputProfile): { width: number; height: number } {
  const trim = p.trimMm ?? A4;
  const bleed = p.bleedMm ?? 0;
  return { width: trim.width + bleed * 2, height: trim.height + bleed * 2 };
}

/**
 * Effective resolution of an image at the size it is actually placed.
 *
 * The file's own dimensions say nothing on their own: a 4000px photograph is 400 PPI across a
 * half-page and 130 across a spread. This is the only figure worth checking, and it needs the
 * layout to compute.
 */
export function effectivePpi(sourcePixels: number, placedMm: number): number {
  if (placedMm <= 0) return 0;
  return sourcePixels / (placedMm / 25.4);
}
