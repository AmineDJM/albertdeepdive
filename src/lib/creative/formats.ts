/**
 * What Creative Studio makes, and the shape of each thing.
 *
 * A format is not a preference, it is a set of constraints: a canvas, a safe area, how many frames
 * are allowed, whether it moves. Everything downstream — the brief the Art Director may write, the
 * spec the composer resolves, the file the renderer produces — is bounded by one of these, which is
 * why they are data rather than scattered magic numbers.
 *
 * The safe areas are the ones that matter in practice. Instagram lays its own interface over the top
 * and bottom of a Story; TikTok puts a caption and a column of buttons over the lower right. Type
 * placed outside the safe area is type somebody else's UI will sit on, and no amount of good design
 * survives that.
 */

export const CREATIVE_FORMATS = ["CAROUSEL", "STORY", "SQUARE_POST", "REEL", "LINKEDIN_VIDEO"] as const;
export type CreativeFormat = (typeof CREATIVE_FORMATS)[number];

export type SafeArea = { top: number; right: number; bottom: number; left: number };

export type FormatDefinition = {
  key: CreativeFormat;
  name: string;
  /** What it is for, in one line, for the person choosing. */
  description: string;
  width: number;
  height: number;
  /** Pixels of the canvas that another app's interface may cover. */
  safeArea: SafeArea;
  /** Frames: a carousel's slides, a video's scenes. */
  minFrames: number;
  maxFrames: number;
  moving: boolean;
  /** Seconds per frame when moving, so a scene count implies a duration. */
  secondsPerFrame?: number;
  /**
   * The longest the platform will take, in seconds.
   *
   * Distinct from `secondsPerFrame`, which is a default pacing. Treating the pacing as the limit
   * reported a perfectly postable 30-second Reel as too long, because six dense scenes take longer
   * to read than six times the default.
   */
  maxSeconds?: number;
  /** Where it is meant to be posted, for the labels and the export names. */
  platforms: string[];
};

/**
 * 1080 wide throughout.
 *
 * Every platform downsizes from something, and 1080 is the width at which Instagram, LinkedIn and
 * TikTok all stop re-encoding. Rendering larger costs time and gains nothing a phone can see;
 * rendering smaller is visible immediately on text.
 */
export const FORMATS: Record<CreativeFormat, FormatDefinition> = {
  CAROUSEL: {
    key: "CAROUSEL",
    name: "Carousel",
    description: "A few slides somebody swipes through. The workhorse — it carries an argument, not just a picture.",
    width: 1080,
    height: 1350,
    safeArea: { top: 24, right: 24, bottom: 24, left: 24 },
    minFrames: 3,
    maxFrames: 10,
    moving: false,
    platforms: ["Instagram", "LinkedIn"],
  },
  STORY: {
    key: "STORY",
    name: "Story",
    description: "One full-screen frame, seen for about three seconds. One idea, large.",
    width: 1080,
    height: 1920,
    // Instagram's own header sits in the top 250px; the reply bar and its gradient own the bottom 320.
    safeArea: { top: 250, right: 40, bottom: 320, left: 40 },
    minFrames: 1,
    maxFrames: 5,
    moving: false,
    platforms: ["Instagram", "LinkedIn"],
  },
  SQUARE_POST: {
    key: "SQUARE_POST",
    name: "Post",
    description: "A single square image. For one number, one quote, one announcement.",
    width: 1080,
    height: 1080,
    safeArea: { top: 24, right: 24, bottom: 24, left: 24 },
    minFrames: 1,
    maxFrames: 1,
    moving: false,
    platforms: ["Instagram", "LinkedIn", "X"],
  },
  REEL: {
    key: "REEL",
    name: "Reel",
    description: "Vertical video. Read in silence, so everything that matters is on screen.",
    width: 1080,
    height: 1920,
    // TikTok's caption block and button column take more room than Instagram's, so the stricter wins.
    safeArea: { top: 220, right: 200, bottom: 420, left: 40 },
    minFrames: 3,
    maxFrames: 8,
    moving: true,
    secondsPerFrame: 3,
    maxSeconds: 90,
    platforms: ["Instagram", "TikTok"],
  },
  LINKEDIN_VIDEO: {
    key: "LINKEDIN_VIDEO",
    name: "LinkedIn video",
    description: "Square video for a feed that autoplays muted. Captions are not optional.",
    width: 1080,
    height: 1080,
    safeArea: { top: 40, right: 40, bottom: 120, left: 40 },
    minFrames: 3,
    maxFrames: 8,
    moving: true,
    secondsPerFrame: 3.5,
    maxSeconds: 600,
    platforms: ["LinkedIn"],
  },
};

/**
 * How much of Briefly is allowed to invent.
 *
 * The distinction is about evidence, not about quality. Authentic uses only what the organisation
 * actually has; nothing on screen is a thing that did not happen. Studio adds compositions Briefly
 * draws itself — type, colour, shape, data — which invent no evidence because they depict nothing.
 * Cinematic adds generated imagery, which is the only mode where a picture on screen was never
 * photographed, and is therefore the only one that needs a decision from a person.
 */
export const CREATIVE_MODES = ["AUTHENTIC", "STUDIO", "CINEMATIC"] as const;
export type CreativeMode = (typeof CREATIVE_MODES)[number];

export type ModeDefinition = {
  key: CreativeMode;
  name: string;
  description: string;
  /** May place the organisation's own photographs. */
  usesOwnMedia: boolean;
  /** May render Briefly's own graphic compositions. */
  usesRenderedGraphics: boolean;
  /** May ask an external provider for imagery or motion. */
  usesGeneratedImagery: boolean;
  /** What the person is warned about before they use it. */
  caution?: string;
};

export const MODES: Record<CreativeMode, ModeDefinition> = {
  AUTHENTIC: {
    key: "AUTHENTIC",
    name: "Authentic",
    description: "Only your own photographs and your own words. Nothing on screen is something that did not happen.",
    usesOwnMedia: true,
    usesRenderedGraphics: true,
    usesGeneratedImagery: false,
  },
  STUDIO: {
    key: "STUDIO",
    name: "Studio",
    description: "Designed compositions — type, colour, shape, figures — drawn by Briefly. No photographs needed.",
    usesOwnMedia: true,
    usesRenderedGraphics: true,
    usesGeneratedImagery: false,
  },
  CINEMATIC: {
    key: "CINEMATIC",
    name: "Cinematic",
    description: "Adds generated imagery and motion for backgrounds and texture.",
    usesOwnMedia: true,
    usesRenderedGraphics: true,
    usesGeneratedImagery: true,
    caution: "Generated imagery is illustrative. It is never used to depict a real event, a real place or a real person.",
  },
};

/** The formats a mode can produce. Motion needs a provider; a still does not. */
export function formatsForMode(mode: CreativeMode): CreativeFormat[] {
  return CREATIVE_FORMATS.filter((format) => !FORMATS[format].moving || MODES[mode].usesGeneratedImagery || mode === "STUDIO");
}

/** Seconds a moving format runs for, given its scene count. Zero for a still. */
export function durationSeconds(format: CreativeFormat, frames: number): number {
  const definition = FORMATS[format];
  if (!definition.moving) return 0;
  return Math.round(frames * (definition.secondsPerFrame ?? 3) * 10) / 10;
}

/** The area type may actually occupy, after the platform's own interface is subtracted. */
export function typeBox(format: CreativeFormat): { x: number; y: number; width: number; height: number } {
  const { width, height, safeArea } = FORMATS[format];
  return {
    x: safeArea.left,
    y: safeArea.top,
    width: width - safeArea.left - safeArea.right,
    height: height - safeArea.top - safeArea.bottom,
  };
}

/** Clamp a requested frame count into what the format allows. */
export function clampFrames(format: CreativeFormat, requested: number): number {
  const { minFrames, maxFrames } = FORMATS[format];
  if (!Number.isFinite(requested)) return minFrames;
  return Math.max(minFrames, Math.min(maxFrames, Math.round(requested)));
}
