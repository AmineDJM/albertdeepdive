import type { FrameSpec, RenderSpec } from "./brief";

/**
 * How a set of composed frames becomes a video.
 *
 * The frames are the same frames. A Reel is not drawn a second way — it is the carousel's slides,
 * pixel for pixel, with time added. That is the property this module exists to preserve: a second
 * renderer for video would be a second design system, and the two would drift until a Reel and a
 * carousel made from the same brief no longer looked like the same work. Everything here is about
 * *when*, never about *what*.
 *
 * Which is also why there is no React composition and no second bundler. The still renderer already
 * produces exact, reproducible frames from a spec; this decides how long each is held, what happens
 * between them, and how the picture moves — and hands that to ffmpeg as arithmetic.
 */

/* ── The laws of holding a shot ───────────────────────────────────────────────────────────── */

/**
 * How fast people read on screen.
 *
 * 180 words per minute, from subtitle practice: the BBC's guidelines put comfortable subtitle rates
 * at 160–180 wpm and Ofcom's at up to 180, and on-screen text is read at much the same rate. It is
 * well below silent reading speed on a page (~250) because the reader is also watching.
 */
export const READING_WPM = 180;

/**
 * The pause before reading starts.
 *
 * A cut gives the eye nothing to fix on for a moment: it has to find the text, saccade to it and
 * fixate before the first word is read. A third of a second is the usual figure, and a scene that
 * does not pay it is a scene whose first word is missed.
 */
export const FIXATION_SECONDS = 0.35;

/**
 * The shortest a scene may be held, whatever is on it.
 *
 * Below about a second and a quarter a shot registers as a flash rather than as something to read —
 * true even of two words. A set that runs shorter is not a fast video, it is an unreadable one.
 */
export const MIN_HOLD_SECONDS = 1.25;

/** And the longest, before a held shot reads as a stall rather than as emphasis. */
export const MAX_HOLD_SECONDS = 7;

/** Words on a frame, counting only what a viewer actually has to read. */
export function wordsOn(frame: FrameSpec): number {
  return frame.text
    .filter((block) => block.layer !== "background")
    .reduce((total, block) => total + block.content.trim().split(/\s+/).filter(Boolean).length, 0);
}

/**
 * How long this frame needs to be on screen.
 *
 * Derived from what is on it rather than assigned a flat number per scene, which is the difference
 * between a video somebody can follow and one where the dense slide flies past and the sparse one
 * sits there. A flat `secondsPerFrame` is what the format offers as a default; this is what the
 * content actually needs.
 */
export function holdFor(frame: FrameSpec): number {
  const needed = FIXATION_SECONDS + wordsOn(frame) / (READING_WPM / 60);
  return Math.round(Math.min(MAX_HOLD_SECONDS, Math.max(MIN_HOLD_SECONDS, needed)) * 100) / 100;
}

/**
 * How long a transition may run.
 *
 * Under 0.2s a dissolve reads as a glitch — the eye registers a discontinuity without registering a
 * change. Over 0.6s it reads as waiting. The band between is where a transition does its job, which
 * is to say "this is the same piece, and here is the next part of it".
 */
export const TRANSITION = { min: 0.2, max: 0.6 } as const;

/* ── The three motion systems ─────────────────────────────────────────────────────────────── */

export const MOTION_SYSTEMS = ["cut", "drift", "wipe"] as const;
export type MotionSystemKey = (typeof MOTION_SYSTEMS)[number];

export type TransitionKind = "none" | "dissolve" | "slide";

export type MotionSystem = {
  key: MotionSystemKey;
  name: string;
  description: string;
  transition: TransitionKind;
  transitionSeconds: number;
  /**
   * How far the picture travels over a whole scene, as a fraction of the frame.
   *
   * 0 is a locked-off shot. Anything above about 0.12 starts to read as a zoom rather than as drift,
   * and a zoom on type means the type changes size while somebody is reading it.
   */
  drift: number;
};

export const MOTION: Record<MotionSystemKey, MotionSystem> = {
  cut: {
    key: "cut",
    name: "Cut",
    description: "Hard cuts, nothing moves. The words are the event, and a still frame holds them best.",
    transition: "none",
    transitionSeconds: 0,
    drift: 0,
  },
  drift: {
    key: "drift",
    name: "Drift",
    description: "A slow push on each scene and a dissolve between. Gives a set of stills the feel of footage.",
    transition: "dissolve",
    transitionSeconds: 0.4,
    drift: 0.08,
  },
  wipe: {
    key: "wipe",
    name: "Wipe",
    description: "Scenes slide in from the side, the way a page turns. Structural, and it reads as one document.",
    transition: "slide",
    transitionSeconds: 0.35,
    drift: 0,
  },
};

export function motionSystem(key: string | null | undefined): MotionSystem {
  return MOTION[(key ?? "") as MotionSystemKey] ?? MOTION.cut;
}

/* ── The spec ─────────────────────────────────────────────────────────────────────────────── */

export type Scene = {
  index: number;
  /** Seconds this scene is on screen, before the transition into the next one. */
  hold: number;
  /** Where this scene starts, in seconds from the top. */
  startsAt: number;
  /** 1 is locked off; above 1 the picture is scaled up over the scene's length. */
  zoomFrom: number;
  zoomTo: number;
};

export type MotionSpec = {
  system: MotionSystemKey;
  width: number;
  height: number;
  fps: number;
  scenes: Scene[];
  transition: TransitionKind;
  transitionSeconds: number;
  /** Total running time, transitions included. */
  duration: number;
};

/**
 * Twenty-five frames a second.
 *
 * Every platform re-encodes whatever it is given, so the only thing frame rate buys is smoothness of
 * the drift, and 25 is where a slow push stops stepping. Higher costs render time and gains nothing
 * a viewer can see on a phone.
 */
export const FPS = 25;

/**
 * Turn composed frames into a timeline.
 *
 * Pure, like the composer, and for the same reason: the same spec must always give the same video,
 * or a re-render is a new video and nothing downstream can be cached or compared.
 *
 * Transitions overlap the scenes they join rather than being inserted between them — a dissolve is
 * two shots on screen at once, not a gap — so the total is the sum of the holds minus one overlap
 * per join.
 */
export function planMotion(spec: RenderSpec, systemKey: string | null | undefined, options: { fps?: number } = {}): MotionSpec {
  const system = motionSystem(systemKey);
  const fps = options.fps ?? FPS;
  const transitionSeconds = Math.min(TRANSITION.max, Math.max(0, system.transitionSeconds));

  let cursor = 0;
  const scenes: Scene[] = spec.frames.map((frame, index) => {
    const hold = Math.max(holdFor(frame), transitionSeconds * 2);
    const scene: Scene = {
      index,
      hold,
      startsAt: Math.round(cursor * 1000) / 1000,
      // Alternating direction, so a set of pushes does not read as one continuous zoom.
      zoomFrom: system.drift === 0 ? 1 : index % 2 === 0 ? 1 : 1 + system.drift,
      zoomTo: system.drift === 0 ? 1 : index % 2 === 0 ? 1 + system.drift : 1,
    };
    cursor += hold - (index < spec.frames.length - 1 ? transitionSeconds : 0);
    return scene;
  });

  return {
    system: system.key,
    width: spec.width,
    height: spec.height,
    fps,
    scenes,
    transition: system.transition,
    transitionSeconds,
    duration: Math.round(cursor * 1000) / 1000,
  };
}

/**
 * What is wrong with a timeline.
 *
 * Reported rather than repaired, like the rest of the QA pass: the fix for a video that runs long is
 * fewer scenes or shorter copy, and both are editorial decisions.
 */
export function inspectMotion(motion: MotionSpec, limitSeconds: number): { code: string; message: string }[] {
  const findings: { code: string; message: string }[] = [];

  if (motion.duration > limitSeconds) {
    findings.push({
      code: "too_long",
      message: `${motion.duration.toFixed(1)}s of reading, and the format allows ${limitSeconds}s. Fewer scenes or shorter lines.`,
    });
  }
  const rushed = motion.scenes.filter((scene) => scene.hold <= MIN_HOLD_SECONDS + 0.001);
  if (rushed.length && motion.scenes.length > 1) {
    findings.push({
      code: "rushed",
      message: `${rushed.length} scene${rushed.length === 1 ? "" : "s"} at the ${MIN_HOLD_SECONDS}s floor. Below that a shot is seen rather than read.`,
    });
  }
  if (motion.scenes.length === 1) {
    findings.push({ code: "single_scene", message: "One scene is a still, not a video. A second gives it somewhere to go." });
  }
  return findings;
}
