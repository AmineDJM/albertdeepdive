import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ffmpegPath } from "@/server/creative/video";

/**
 * From passages to a programme.
 *
 * The provider hands back one file per passage. What a listener gets is one file: the passages in
 * order with a breath between them — or, for a film, each at the second its scene begins — brought
 * to a broadcast loudness, faded in and out, and, when there is a bed, with the music ducked under
 * the voice. ffmpeg does all of it from one filter graph, built here as arithmetic so a test can
 * read the graph without an encoder present.
 */

export type MasterPlan = {
  /** Paths to the passages, in order. */
  segments: string[];
  /** Their measured lengths, in seconds, in the same order. */
  durations: number[];
  output: string;
  /** Silence between consecutive passages when they simply follow each other. */
  gapSeconds?: number;
  /** For a film: the second each passage starts at. Overrides the gaps. */
  placements?: number[];
  /** Integrated loudness. -16 LUFS is the podcast norm; -14 suits a social video. */
  targetLufs?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  /** A music bed, looped under the voice and ducked while it speaks. */
  music?: { path: string; levelDb?: number } | null;
  metadata?: Record<string, string>;
};

const DEFAULT_GAP = 0.65;
const TAIL = 0.7;

/** The starts of every passage, from the plan. */
export function passageStarts(plan: Pick<MasterPlan, "durations" | "gapSeconds" | "placements">): number[] {
  if (plan.placements) return plan.placements.map((start) => Math.max(0, start));
  const gap = plan.gapSeconds ?? DEFAULT_GAP;
  let cursor = 0;
  return plan.durations.map((duration) => {
    const start = cursor;
    cursor += duration + gap;
    return Math.round(start * 1000) / 1000;
  });
}

export function masterArgs(plan: MasterPlan): { args: string[]; totalSeconds: number } {
  if (!plan.segments.length || plan.segments.length !== plan.durations.length) throw new Error("A master needs one duration per segment.");
  const starts = passageStarts(plan);
  const totalSeconds = Math.round((Math.max(...starts.map((start, index) => start + plan.durations[index])) + TAIL) * 100) / 100;
  const fadeIn = plan.fadeInSeconds ?? 0.15;
  const fadeOut = plan.fadeOutSeconds ?? 0.8;
  const lufs = plan.targetLufs ?? -16;

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const segment of plan.segments) args.push("-i", segment);
  const musicIndex = plan.music ? plan.segments.length : null;
  if (plan.music) args.push("-stream_loop", "-1", "-i", plan.music.path);

  const filters: string[] = [];
  plan.segments.forEach((_, index) => {
    const delay = Math.round(starts[index] * 1000);
    filters.push(`[${index}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=${delay}|${delay}[s${index}]`);
  });
  const inputs = plan.segments.map((_, index) => `[s${index}]`).join("");
  filters.push(`${inputs}amix=inputs=${plan.segments.length}:normalize=0:dropout_transition=0,apad=pad_dur=${TAIL}[voice]`);

  let mixed = "[voice]";
  if (musicIndex !== null) {
    const level = plan.music?.levelDb ?? -18;
    filters.push(`[${musicIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=${level}dB,atrim=0:${totalSeconds}[bed]`);
    filters.push(`[voice]asplit=2[v1][v2]`);
    filters.push(`[bed][v2]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=500[duck]`);
    filters.push(`[v1][duck]amix=inputs=2:duration=first:normalize=0[mix]`);
    mixed = "[mix]";
  }
  const fadeStart = Math.max(0, totalSeconds - fadeOut);
  filters.push(`${mixed}loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=44100,afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOut}[out]`);

  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-id3v2_version", "3");
  for (const [key, value] of Object.entries(plan.metadata ?? {})) args.push("-metadata", `${key}=${value.replace(/[\r\n]/g, " ")}`);
  args.push(plan.output);
  return { args, totalSeconds };
}

export type AudioMeasure = { durationSeconds: number; meanVolumeDb: number | null; maxVolumeDb: number | null };

function parseTime(stamp: string): number {
  const [h, m, sec] = stamp.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(sec);
}

/** What ffmpeg says about a file when asked to play it into nowhere. */
export function parseMeasure(stderr: string): AudioMeasure {
  const times = [...stderr.matchAll(/time=(\d+:\d{2}:\d{2}\.\d+)/g)].map((match) => parseTime(match[1]));
  const declared = stderr.match(/Duration: (\d+:\d{2}:\d{2}\.\d+)/);
  const durationSeconds = times.length ? Math.max(...times) : declared ? parseTime(declared[1]) : 0;
  const mean = stderr.match(/mean_volume: (-?\d+(?:\.\d+)?) dB/);
  const max = stderr.match(/max_volume: (-?\d+(?:\.\d+)?) dB/);
  return { durationSeconds: Math.round(durationSeconds * 100) / 100, meanVolumeDb: mean ? Number(mean[1]) : null, maxVolumeDb: max ? Number(max[1]) : null };
}

export function runFfmpeg(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/** Length and level of a file. Measured, because a provider's "success" says nothing about either. */
export async function measureAudio(path: string): Promise<AudioMeasure> {
  const { code, stderr } = await runFfmpeg(["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"]);
  if (code !== 0) throw new Error(`Could not read the audio: ${stderr.split("\n").slice(-3).join(" ").slice(0, 300)}`);
  return parseMeasure(stderr);
}

export type Mastered = { bytes: Buffer; durationSeconds: number; sha256: string; mimeType: string };

export async function masterNarration(plan: MasterPlan): Promise<Mastered> {
  const { args } = masterArgs(plan);
  const { code, stderr } = await runFfmpeg(args);
  if (code !== 0) throw new Error(`Mastering failed: ${stderr.split("\n").slice(-4).join(" ").slice(0, 400)}`);
  const bytes = await readFile(plan.output);
  const measure = await measureAudio(plan.output);
  return { bytes, durationSeconds: measure.durationSeconds, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "audio/mpeg" };
}
