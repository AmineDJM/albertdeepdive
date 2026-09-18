import { describe, expect, it } from "vitest";
import { encodeArgs, withNarrationHolds } from "@/server/creative/video";
import type { MotionSpec } from "@/lib/creative/motion";

const motion: MotionSpec = {
  system: "cut",
  width: 1080,
  height: 1920,
  fps: 25,
  transition: "none",
  transitionSeconds: 0,
  duration: 6,
  scenes: [
    { index: 0, hold: 3, startsAt: 0, zoomFrom: 1, zoomTo: 1 },
    { index: 1, hold: 3, startsAt: 3, zoomFrom: 1, zoomTo: 1 },
  ],
};

describe("a film with its voice-over", () => {
  it("holds each scene for what is said over it", () => {
    const held = withNarrationHolds(motion, [2, 5.2]);
    expect(held.scenes[0].hold).toBe(3);
    expect(held.scenes[1].hold).toBeCloseTo(5.8, 2);
    expect(held.scenes[1].startsAt).toBe(3);
    expect(held.duration).toBeCloseTo(8.8, 2);
  });

  it("adds the audio as the last input and stops when the picture ends", () => {
    const args = encodeArgs(motion, [{ picture: "/tmp/s0.png", type: null }, { picture: "/tmp/s1.png", type: null }], "/tmp/out.mp4", { path: "/tmp/voice.mp3" });
    const inputs = args.reduce<string[]>((found, arg, index) => (arg === "-i" ? [...found, args[index + 1]] : found), []);
    expect(inputs).toEqual(["/tmp/s0.png", "/tmp/s1.png", "/tmp/voice.mp3"]);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[2:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad[aout]");
    expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual(["-map", "[out]", "-map", "[aout]"]);
    expect(args).toContain("-shortest");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
  });

  it("encodes silent, exactly as before, without a narration", () => {
    const args = encodeArgs(motion, [{ picture: "/tmp/s0.png", type: null }, { picture: "/tmp/s1.png", type: null }], "/tmp/out.mp4");
    expect(args).not.toContain("-shortest");
    expect(args).not.toContain("-c:a");
    expect(args.filter((arg) => arg === "-map")).toEqual(["-map"]);
  });
});
