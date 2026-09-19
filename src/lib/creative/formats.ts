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

export const CREATIVE_FORMATS = ["CAROUSEL", "STORY", "SQUARE_POST", "REEL", "LANDSCAPE_VIDEO", "LINKEDIN_VIDEO"] as const;
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
  /**
   * A shape that can still be rendered but is no longer offered.
   *
   * Square video was how LinkedIn wanted video in 2019. It now plays vertical and landscape
   * natively, so the square is a worse crop of both — and a third video choice beside "vertical"
   * and "landscape" is a question with no good answer. Packs already made in it keep working; the
   * shape is simply not on the menu any more.
   */
  legacy?: boolean;
};

/**
 * 1080 on the short edge throughout.
 *
 * Every platform downsizes from something, and 1080 is where Instagram, LinkedIn, TikTok and
 * YouTube all stop re-encoding. Rendering larger costs time and gains nothing a phone can see;
 * rendering smaller is visible immediately on text. The still and vertical shapes are 1080 wide;
 * landscape video is 1920 x 1080, which is the same 1080 turned on its side — the delivery size
 * YouTube has wanted since it stopped being the size of a postage stamp.
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
    // Not "Story": the interface's dictionary is keyed by the English, and a story is also what
    // this newsroom calls a piece of journalism. One word, two meanings, one French translation.
    name: "Full-screen story",
    description: "One full-screen frame, seen for about three seconds. One idea, large.",
    width: 1080,
    height: 1920,
    // Instagram's own header sits in the top 250px; the reply bar and its gradient own the bottom 320.
    safeArea: { top: 250, right: 40, bottom: 320, left: 40 },
    minFrames: 1,
    maxFrames: 5,
    moving: false,
    // LinkedIn stopped carrying stories in 2021; the same file is what Facebook and WhatsApp want.
    platforms: ["Instagram", "Facebook"],
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
    name: "Vertical video",
    description: "Reels, Shorts, TikTok. Held in one hand, watched in silence — everything that matters is on the screen.",
    width: 1080,
    height: 1920,
    // TikTok's caption block and button column take more room than Instagram's, so the stricter wins.
    safeArea: { top: 220, right: 200, bottom: 420, left: 40 },
    minFrames: 3,
    maxFrames: 8,
    moving: true,
    secondsPerFrame: 3,
    // 90s is Instagram's Reel ceiling. Shorts and TikTok both take longer now, but a cut that runs
    // everywhere is worth more than ninety extra seconds on two of the three.
    maxSeconds: 90,
    platforms: ["Instagram", "TikTok", "YouTube Shorts"],
  },
  LANDSCAPE_VIDEO: {
    key: "LANDSCAPE_VIDEO",
    name: "Landscape video",
    description: "YouTube, and anywhere played wide. Room for a longer argument, and sound is likelier — but it still has to read muted.",
    width: 1920,
    height: 1080,
    /*
     * The player's own furniture, at 1080p.
     *
     * The control bar and its progress line own the bottom of the frame whenever somebody moves the
     * mouse or taps, which on a phone is constantly; the title overlay comes back across the top at
     * the same moment. Top right carries the channel chip on an embed, and the end-screen cards
     * land on the right in the last twenty seconds. Type outside this box is type the player sits
     * on, and no amount of good design survives a progress bar through a headline.
     */
    safeArea: { top: 100, right: 100, bottom: 140, left: 100 },
    minFrames: 3,
    maxFrames: 12,
    moving: true,
    // A wide frame is read from further away and carries more per scene, so it earns a longer beat.
    secondsPerFrame: 4,
    // What an unverified YouTube account may upload. Nothing this engine makes comes near it.
    maxSeconds: 900,
    platforms: ["YouTube", "LinkedIn"],
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
    legacy: true,
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

/** The shapes on the menu today. A legacy shape still renders; it is simply not offered any more. */
export const OFFERED_FORMATS: CreativeFormat[] = CREATIVE_FORMATS.filter((key) => !FORMATS[key].legacy);

/** Stills: swiped, scrolled past, screenshotted. */
export const STILL_FORMATS: CreativeFormat[] = OFFERED_FORMATS.filter((key) => !FORMATS[key].moving);

/**
 * Video is two shapes, and choosing between them is the first decision, not a detail.
 *
 * They are not crops of each other. A vertical cut is held in one hand, thumbed past in a second
 * and watched muted, so it is short, large and captioned to the edge. A landscape cut is played on
 * a screen somebody is already looking at, often with sound, and can carry an argument that takes a
 * minute. The same words set for the wrong one of those is the commonest way a good film reads
 * badly, which is why the choice is offered as two shapes rather than as one "video" with a
 * dimension box.
 */
export const VIDEO_FORMATS: CreativeFormat[] = OFFERED_FORMATS.filter((key) => FORMATS[key].moving);

/** Which way round it is. The renderer needs the numbers; everything else needs this word. */
export function orientationOf(format: CreativeFormat): "portrait" | "landscape" | "square" {
  const { width, height } = FORMATS[format];
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

/** The formats a mode can produce. Motion needs a provider; a still does not. */
export function formatsForMode(mode: CreativeMode): CreativeFormat[] {
  return OFFERED_FORMATS.filter((format) => !FORMATS[format].moving || MODES[mode].usesGeneratedImagery || mode === "STUDIO");
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
