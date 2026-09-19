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
   * How attention behaves in this shape. Only the moving ones have it.
   *
   * This is the part that makes a vertical cut a different film rather than a shorter one.
   */
  attention?: AttentionModel;
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
 * What holds attention, which is not the same question in a feed and on a screen somebody chose.
 *
 * A vertical cut is not a landscape one with the sides taken off. It is watched with a thumb
 * resting on the glass, in a feed the viewer is already leaving, and the decision to stay is made
 * in the first second and a half — before any context can be established. So it opens on the
 * sharpest thing there is, turns over faster, pays off earlier, and resets attention on every
 * shot. A landscape cut is played on a screen somebody has already chosen to look at, often with
 * sound; it can take a beat to set something up and be trusted to arrive.
 *
 * These are the numbers that difference reduces to, kept as data because they have to reach three
 * separate places that must not disagree: the brief the art director writes, the timeline the
 * motion planner lays out, and the check that reports a film too slow to hold anybody.
 */
export type AttentionModel = {
  /** Seconds the opening shot has to earn the second one. */
  hookSeconds: number;
  /** The pause after a cut before reading starts. A feed viewer is already scanning. */
  fixation: number;
  /** The shortest and longest a shot may be held, whatever is on it. */
  minHold: number;
  maxHold: number;
  /** Words a minute the viewer is assumed to read at, in this context. */
  readingWpm: number;
  /** Multiplier on the motion system's drift: how hard the picture resets attention per shot. */
  driftScale: number;
  /** The beats a set of this shape runs through, in order, for the art director to fill. */
  beats: string[];
  /** What this shape rewards, in one paragraph, for the art director. */
  note: string;
};

/** The most words the opening shot may carry and still be read inside the hook. */
export function hookWords(attention: AttentionModel): number {
  return Math.max(1, Math.floor(((attention.hookSeconds - attention.fixation) * attention.readingWpm) / 60));
}

/**
 * Vertical: attention engineering for a feed.
 *
 * 240 words a minute sits between subtitle practice (160–180, where the reader is also watching a
 * scene) and silent reading on a page (~250). A Reel's type is four or five very large words with
 * nothing else moving, which is read closer to the page rate than the subtitle rate — and the
 * fixation is shorter because the type is full-screen, so the eye has nowhere else to land.
 */
const FEED_ATTENTION: AttentionModel = {
  hookSeconds: 1.5,
  fixation: 0.2,
  minHold: 1,
  maxHold: 4,
  readingWpm: 240,
  // A bigger push per shot than a classic film would take, because the reset is the point: a
  // vertical frame that sits still for two seconds has already been scrolled past.
  driftScale: 1.6,
  beats: [
    "hook — the sharpest thing you have, in about five words",
    "the curiosity or the problem it opens",
    "escalation: the number, the quote, the turn that makes it matter",
    "the payoff, earlier than feels comfortable",
    "one line of what to do next, if it earns its shot",
  ],
  note:
    "Vertical, held in one hand, in a feed somebody is already leaving. The first second and a half decides everything: open on curiosity, tension, surprise or a number nobody expects — never on a label, a logo, a greeting or a slow set-up. Every shot after it has to earn its place, so cut anything that is only there to get to the next thing. Higher information density than a classic film, shorter lines, shorter pauses, the payoff earlier than feels comfortable, and a tight ending rather than a fade. Fast is not chaotic: each shot still says one whole thing, and the set still reads as this organisation's work.",
};

/** Landscape: a screen somebody chose to look at, and usually with the sound on. */
const SCREEN_ATTENTION: AttentionModel = {
  // Five seconds, not a Reel's second and a half. Somebody who pressed play on a wide video has
  // already decided to watch something; the opening shot has to reward that, not fight for it.
  hookSeconds: 5,
  fixation: 0.35,
  minHold: 1.6,
  maxHold: 7,
  readingWpm: 180,
  driftScale: 1,
  beats: [
    "the claim, stated plainly",
    "what it rests on",
    "the evidence: the figure, the quote, the comparison",
    "what follows from it",
    "the close, and where to read the whole thing",
  ],
  note:
    "Wide, played on a screen the viewer is already watching, often with sound. A shot can carry a sentence and the figure that proves it, and the set can take a beat to set something up and be trusted to arrive. It still has to read muted, and it still opens on a claim rather than a title card — but it is an argument with room, not a scramble.",
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
    minFrames: 4,
    // More shots, each shorter: at this pace twelve of them still come in under a minute, and
    // eight long ones is the shape of a film rather than of a Short.
    maxFrames: 12,
    moving: true,
    // Two seconds a shot, not three: the turnover is part of what makes it a Short.
    secondsPerFrame: 2,
    // 90s is Instagram's Reel ceiling. Shorts and TikTok both take longer now, but a cut that runs
    // everywhere is worth more than ninety extra seconds on two of the three.
    maxSeconds: 90,
    platforms: ["Instagram", "TikTok", "YouTube Shorts"],
    attention: FEED_ATTENTION,
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
    attention: SCREEN_ATTENTION,
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
    attention: SCREEN_ATTENTION,
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
