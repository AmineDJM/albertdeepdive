import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { planMotion, type MotionSpec } from "@/lib/creative/motion";
import { holdsForNarration, sceneStarts } from "@/lib/speech/timing";
import type { RenderSpec } from "@/lib/creative/brief";
import { renderFrameLayers, renderSpec } from "./render";
import { createLogger } from "@/server/logger";

const log = createLogger("creative-video");

/**
 * A video, from the same frames the carousel is made of.
 *
 * The scenes are rendered once each by the still renderer — the identical code path, so a Reel's
 * slide is byte-identical to the carousel's slide — and ffmpeg does the rest: holds each still for
 * as long as the words on it take to read, moves the picture if the motion system says to, and joins
 * them.
 *
 * Deliberately not Remotion. Remotion would mean a React composition of every layout, bundled
 * separately, rendered by its own Chromium: a second design system in everything but name, certain
 * to drift from the first, plus a company licence for a for-profit product. What it buys — declarative
 * per-element animation — is not what this needs, because the elements are already composed and the
 * only decision left is time.
 *
 * ffmpeg is a deploy dependency, and an honest one: the binary must exist, with libx264, or the job
 * fails with a message saying exactly that rather than producing a file nobody can post.
 */

/** A scene's files: the picture, and the words on their own when the scene moves. */
export type SceneFiles = { picture: string; type: string | null };

/** H.264 in yuv420p cannot encode an odd dimension, and a scaled-up canvas easily produces one. */
const even = (value: number) => Math.round(value / 2) * 2;

export type EncodedVideo = {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number;
  sha256: string;
};

/**
 * Where the encoder is.
 *
 * `FFMPEG_PATH` first, so a deployment with a system ffmpeg uses it. Then the `ffmpeg-static` build,
 * which ships a full one with libx264 and is why this works on a host that has none. Then the plain
 * name, for a container that put one on the path.
 *
 * Resolved on every call, deliberately. Remembering the first answer looked like an obvious saving —
 * `require` is cached by Node anyway, so it saves almost nothing — and it made the function unable
 * to notice a changed environment: a test that swapped `FFMPEG_PATH` kept getting the old value, and
 * so would a worker whose first resolution happened before the binary finished installing.
 */
export function ffmpegPath(): string {
  const configured = process.env.FFMPEG_PATH || process.env.FFMPEG_BINARY;
  if (configured) return configured;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundled = require("ffmpeg-static") as string | null;
    if (bundled) return bundled;
  } catch {
    // Not installed; fall through to whatever is on the path.
  }
  return "ffmpeg";
}

/**
 * Whether we can encode at all, and what is missing if not.
 *
 * Checked before rendering a single frame. Discovering there is no encoder after two minutes of
 * Chromium is the same failure, found expensively.
 */
export async function encoderReady(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout, code } = await run(ffmpegPath(), ["-hide_banner", "-encoders"]);
    if (code !== 0) return { ok: false, detail: `\`${ffmpegPath()}\` exited ${code}.` };
    if (!stdout.includes("libx264")) {
      return { ok: false, detail: "This ffmpeg has no libx264, so it cannot produce the H.264 every platform requires." };
    }
    return { ok: true, detail: "ready" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `No usable ffmpeg at \`${ffmpegPath()}\` (${message}). Set FFMPEG_PATH.` };
  }
}

/**
 * Render and encode.
 *
 * The filter graph is built rather than templated, because the three motion systems differ in shape
 * and a template with three branches in it is three templates wearing a coat.
 */
export async function renderVideo(
  spec: RenderSpec,
  options: {
    system?: string | null;
    browser?: Browser;
    images?: Map<string, string>;
    fps?: number;
    /**
     * Frames the caller has already rendered, by index.
     *
     * The render job has just drawn every one of these to store as a deliverable. Drawing them again
     * for the encoder is a full Chromium pass per scene for bytes already in hand — so they are
     * passed in, and only a scene that moves (which needs its two layers separately) is re-rendered.
     */
    stills?: Map<number, { bytes: Buffer; mimeType: string }>;
    /**
     * A voice-over, already mastered, with how long it speaks over each scene.
     *
     * A scene is held for its narration when the narration runs longer than the reading time —
     * never the other way round: a voice cut off at a scene change is worse than a long shot, and
     * the words were budgeted to the scene before they were spoken.
     */
    narration?: { path: string; sceneDurations: (number | null)[] } | null;
  },
): Promise<EncodedVideo> {
  const ready = await encoderReady();
  if (!ready.ok) throw new Error(`Cannot encode video. ${ready.detail}`);

  const planned = planMotion(spec, options.system, { fps: options.fps });
  const motion = options.narration ? withNarrationHolds(planned, options.narration.sceneDurations) : planned;
  const directory = await mkdtemp(join(tmpdir(), "briefly-video-"));

  try {
    /*
     * The scenes, as one or two layers each.
     *
     * A scene that moves is rendered twice — the picture, and the words with the background knocked
     * out — because the drift has to move the photograph while the type stays put. Type that slides
     * sideways under a reader's eye is worse than no motion at all, and it is the mistake every
     * "ken burns your slides" tool makes.
     *
     * A scene with no picture, or in a system that does not move, is rendered once. There is nothing
     * behind the words to move, and moving the words is exactly what we are avoiding.
     */
    const scenes: SceneFiles[] = [];
    for (const frame of spec.frames) {
      const moves = motion.scenes[frame.index].zoomFrom !== motion.scenes[frame.index].zoomTo && Boolean(frame.image);
      const stem = join(directory, `scene-${String(frame.index).padStart(2, "0")}`);
      if (moves) {
        const layers = await renderFrameLayers(frame, { browser: options.browser, images: options.images });
        await writeFile(`${stem}-image.png`, layers.image);
        await writeFile(`${stem}-type.png`, layers.type);
        scenes.push({ picture: `${stem}-image.png`, type: `${stem}-type.png` });
      } else {
        const already = options.stills?.get(frame.index);
        const bytes = already?.bytes ?? (await renderSpec({ ...spec, frames: [frame] }, { browser: options.browser, images: options.images }))[0].bytes;
        // The extension has to match the bytes: ffmpeg sniffs the content, but `image2` picks its
        // demuxer from the name first, and a JPEG called .png is a confusing failure.
        const extension = already?.mimeType === "image/jpeg" ? "jpg" : "png";
        await writeFile(`${stem}.${extension}`, bytes);
        scenes.push({ picture: `${stem}.${extension}`, type: null });
      }
    }

    const output = join(directory, "out.mp4");
    const args = encodeArgs(motion, scenes, output, options.narration ? { path: options.narration.path } : null);
    const { code, stderr } = await run(ffmpegPath(), args);
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.split("\n").slice(-4).join(" ").slice(0, 400)}`);

    const bytes = await readFile(output);
    log.info("encoded", { system: motion.system, scenes: motion.scenes.length, seconds: motion.duration, kb: Math.round(bytes.length / 1024) });
    return {
      bytes,
      mimeType: "video/mp4",
      width: motion.width,
      height: motion.height,
      durationSeconds: motion.duration,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The ffmpeg invocation for a timeline.
 *
 * Exported so a test can assert on it without an encoder present: the arithmetic of a filter graph is
 * where this goes wrong, and it is fully checkable as a string.
 */
export function encodeArgs(motion: MotionSpec, scenes: SceneFiles[], output: string, audio: { path: string } | null = null): string[] {
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];

  // Each still becomes a clip of its own length. `-loop 1` plus `-t` is how a still becomes footage.
  // A scene with a separate type layer contributes two inputs, so its indices are tracked rather
  // than assumed — an off-by-one here produces a video of the wrong pictures, silently.
  const inputs: { picture: number; type: number | null }[] = [];
  motion.scenes.forEach((scene, index) => {
    const files = scenes[index];
    const picture = inputs.reduce((total, entry) => total + (entry.type === null ? 1 : 2), 0);
    args.push("-loop", "1", "-t", String(scene.hold), "-i", files.picture);
    if (files.type) args.push("-loop", "1", "-t", String(scene.hold), "-i", files.type);
    inputs.push({ picture, type: files.type ? picture + 1 : null });
  });

  const filters: string[] = [];
  const labels: string[] = [];

  motion.scenes.forEach((scene, index) => {
    const label = `v${index}`;
    const steps: string[] = [];
    const moving = scene.zoomFrom !== scene.zoomTo && scenes[index].type !== null;

    if (moving) {
      /*
       * The drift: scale the picture up by the travel, then walk a fixed crop window across it.
       *
       * `crop` evaluates x and y for every frame and w and h once, so the output size is constant and
       * the encoder is happy. The alternative, `zoompan`, does a full resample per frame and was
       * measured at three minutes for a seven-second clip against this one's 1.2 seconds — a hundred
       * and fifty times the cost for a difference nobody watching a phone can see.
       *
       * The window moves diagonally, which reads as parallax rather than as a slide.
       */
      const travel = Math.abs(scene.zoomTo - scene.zoomFrom);
      const big = { width: even(motion.width * (1 + travel)), height: even(motion.height * (1 + travel)) };
      const forward = scene.zoomTo > scene.zoomFrom;
      const progress = `min(1,t/${scene.hold})`;
      const walk = forward ? progress : `(1-${progress})`;
      steps.push(`scale=${big.width}:${big.height}:flags=bilinear`);
      steps.push(`crop=${motion.width}:${motion.height}:x='(iw-ow)*${walk}':y='(ih-oh)*(1-${walk})'`);
    }

    // Even dimensions: H.264 in yuv420p cannot encode an odd width or height, and our canvases are
    // even, but a crop that rounds down can produce one.
    steps.push("setsar=1", `fps=${motion.fps}`);

    const io = inputs[index];
    if (io.type === null) {
      filters.push(`[${io.picture}:v]${steps.join(",")},format=yuv420p[${label}]`);
    } else {
      // The words go back on top, unmoved. This is the whole point of the split.
      filters.push(`[${io.picture}:v]${steps.join(",")}[p${index}]`);
      filters.push(`[p${index}][${io.type}:v]overlay=0:0:format=auto,format=yuv420p[${label}]`);
    }
    labels.push(label);
  });

  // Joining. A hard cut is a concat; a dissolve or a slide is a chain of xfades, each starting one
  // transition-length before the previous clip ends.
  if (motion.transition === "none" || motion.scenes.length === 1) {
    filters.push(`${labels.map((label) => `[${label}]`).join("")}concat=n=${labels.length}:v=1:a=0[out]`);
  } else {
    const kind = motion.transition === "slide" ? "slideleft" : "fade";
    let previous = labels[0];
    let elapsed = motion.scenes[0].hold;
    for (let index = 1; index < labels.length; index += 1) {
      const next = index === labels.length - 1 ? "out" : `x${index}`;
      const offset = Math.max(0, elapsed - motion.transitionSeconds);
      filters.push(`[${previous}][${labels[index]}]xfade=transition=${kind}:duration=${motion.transitionSeconds}:offset=${offset.toFixed(3)}[${next}]`);
      elapsed = offset + motion.scenes[index].hold;
      previous = next;
    }
  }

  // The voice-over, as one more input after every picture. Padded with silence so the file runs to
  // the last frame, and cut at the video's end so a long tail never lengthens the film.
  const audioIndex = inputs.reduce((total, entry) => total + (entry.type === null ? 1 : 2), 0);
  if (audio) {
    args.push("-i", audio.path);
    filters.push(`[${audioIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad[aout]`);
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[out]");
  if (audio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "160k", "-shortest");
  args.push(
    "-c:v",
    "libx264",
    // A social platform re-encodes whatever it gets, so the job is to hand it something clean rather
    // than something small — but "clean" stops improving well before the encoder stops working. At
    // crf 18/medium a 28-second Reel took four minutes; crf 20/faster is indistinguishable after the
    // platform's own re-encode and a fraction of the time.
    "-crf",
    "20",
    "-preset",
    "faster",
    "-pix_fmt",
    "yuv420p",
    // faststart puts the index at the front, which is what lets a player begin before the whole file
    // has arrived — the difference between a preview that plays and one that spins.
    "-movflags",
    "+faststart",
    "-r",
    String(motion.fps),
    output,
  );
  return args;
}

/** The timeline, with each scene held long enough for what is said over it. */
export function withNarrationHolds(motion: MotionSpec, sceneDurations: (number | null)[]): MotionSpec {
  const { holds } = holdsForNarration(motion.scenes, sceneDurations);
  const starts = sceneStarts(holds, motion.transitionSeconds);
  const scenes = motion.scenes.map((scene, index) => ({ ...scene, hold: holds[index], startsAt: starts[index] }));
  const last = scenes[scenes.length - 1];
  return { ...motion, scenes, duration: last ? Math.round((last.startsAt + last.hold) * 1000) / 1000 : motion.duration };
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}
