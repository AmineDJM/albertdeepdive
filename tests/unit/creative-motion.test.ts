import { describe, expect, it } from "vitest";
import {
  FIXATION_SECONDS,
  holdFor,
  inspectMotion,
  MAX_HOLD_SECONDS,
  MIN_HOLD_SECONDS,
  MOTION,
  MOTION_SYSTEMS,
  motionSystem,
  planMotion,
  READING_WPM,
  TRANSITION,
  wordsOn,
} from "@/lib/creative/motion";
import { encodeArgs, type SceneFiles } from "@/server/creative/video";
import { composeSpec } from "@/lib/creative/compose";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { FORMATS } from "@/lib/creative/formats";
import { localBrief } from "@/server/ai/services/art-director";
import type { FrameSpec } from "@/lib/creative/brief";

const ALBERT: BrandSystem = { ...DEFAULT_BRAND_SYSTEM, colours: { brand: "#10203A", accent: "#2BAFE0", ink: "#17191C", paper: "#FFFFFF" } };
const tokens = compileBrandSystem(ALBERT);

const STORIES = [
  {
    id: "s1",
    headline: "The alum turning satellite images into crop forecasts",
    standfirst: "Three years after graduating, Nadia Chevalier is selling weather risk models to insurers who used to guess.",
    figures: ["€1.2M"],
    quotes: [{ text: "We were told the data was too noisy. It was not noisy, it was unlabelled.", attribution: "Nadia Chevalier, class of 2023" }],
  },
  { id: "s2", headline: "Marseille opens its second data lab" },
  { id: "s3", headline: "Six students place in the national AI olympiad" },
];

const reel = () =>
  composeSpec(localBrief({ format: "REEL", mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES }), tokens, {
    brandVersion: "v",
    system: "poster",
    organizationName: "Albert School",
  });

const frameWith = (content: string): FrameSpec => ({
  index: 0,
  layout: "statement",
  width: 1080,
  height: 1920,
  background: "#FFFFFF",
  shapes: [],
  alt: "x",
  text: [
    { role: "display", content, x: 0, y: 0, width: 1000, fontSize: 90, fontFamily: "a", fontWeight: 700, letterSpacing: 0, lineHeight: 1.1, colour: "#000", transform: "none", align: "left", lines: 1 },
  ],
});

describe("how long a scene is held", () => {
  it("counts the words a viewer has to read, and ignores texture", () => {
    const frame = frameWith("one two three four five");
    expect(wordsOn(frame)).toBe(5);
    // A ghosted numeral is seen, not read, and must not buy the scene extra seconds.
    frame.text.push({ ...frame.text[0], content: "01", layer: "background" });
    expect(wordsOn(frame)).toBe(5);
  });

  it("holds for as long as the words take to read, plus the time to find them", () => {
    const words = 21; // 7 seconds at 180 wpm
    const frame = frameWith(Array.from({ length: words }, (_, i) => `w${i}`).join(" "));
    const expected = FIXATION_SECONDS + words / (READING_WPM / 60);
    expect(holdFor(frame)).toBeCloseTo(Math.min(MAX_HOLD_SECONDS, expected), 1);
  });

  it("never rushes a short scene past reading and never stalls on a long one", () => {
    expect(holdFor(frameWith("Go"))).toBe(MIN_HOLD_SECONDS);
    expect(holdFor(frameWith("word ".repeat(400)))).toBe(MAX_HOLD_SECONDS);
  });

  it("gives a dense scene more time than a sparse one, which a flat seconds-per-frame cannot", () => {
    const sparse = holdFor(frameWith("Two words"));
    const dense = holdFor(frameWith("Three years after graduating she is selling weather risk models to insurers who used to guess"));
    expect(dense).toBeGreaterThan(sparse);
  });
});

describe("planning a timeline", () => {
  it("is pure: the same spec always gives the same timeline", () => {
    expect(planMotion(reel(), "drift")).toEqual(planMotion(reel(), "drift"));
  });

  it("overlaps transitions rather than inserting gaps", () => {
    const spec = reel();
    const plan = planMotion(spec, "drift");
    const holds = plan.scenes.reduce((total, scene) => total + scene.hold, 0);
    // A dissolve is two shots on screen at once, so the total is the holds minus one overlap per join.
    expect(plan.duration).toBeCloseTo(holds - plan.transitionSeconds * (plan.scenes.length - 1), 2);
  });

  it("a hard cut loses nothing to transitions", () => {
    const plan = planMotion(reel(), "cut");
    expect(plan.transitionSeconds).toBe(0);
    expect(plan.duration).toBeCloseTo(plan.scenes.reduce((total, scene) => total + scene.hold, 0), 2);
  });

  it("starts each scene where the last one gave way", () => {
    const plan = planMotion(reel(), "wipe");
    plan.scenes.forEach((scene, index) => {
      if (index === 0) return expect(scene.startsAt).toBe(0);
      const previous = plan.scenes[index - 1];
      expect(scene.startsAt).toBeCloseTo(previous.startsAt + previous.hold - plan.transitionSeconds, 2);
    });
  });

  it("alternates the drift direction, so a set of pushes is not one long zoom", () => {
    const plan = planMotion(reel(), "drift");
    const directions = plan.scenes.map((scene) => Math.sign(scene.zoomTo - scene.zoomFrom));
    expect(new Set(directions).size).toBeGreaterThan(1);
  });

  it("keeps every transition inside the band where it reads as one", () => {
    for (const key of MOTION_SYSTEMS) {
      const system = MOTION[key];
      if (system.transition === "none") continue;
      expect(system.transitionSeconds, key).toBeGreaterThanOrEqual(TRANSITION.min);
      expect(system.transitionSeconds, key).toBeLessThanOrEqual(TRANSITION.max);
    }
  });

  it("falls back to a cut rather than failing on an unknown name", () => {
    expect(motionSystem("nonsense").key).toBe("cut");
    expect(motionSystem(null).key).toBe("cut");
    expect(motionSystem("wipe").key).toBe("wipe");
  });

  it("never lets a transition eat a whole scene", () => {
    // A scene shorter than two transitions would be dissolving in while it dissolves out.
    for (const key of MOTION_SYSTEMS) {
      const plan = planMotion(reel(), key);
      for (const scene of plan.scenes) expect(scene.hold, key).toBeGreaterThanOrEqual(plan.transitionSeconds * 2);
    }
  });
});

describe("what a timeline is checked for", () => {
  it("reports a video longer than the platform takes", () => {
    const plan = planMotion(reel(), "cut");
    expect(inspectMotion(plan, 5).map((f) => f.code)).toContain("too_long");
    expect(inspectMotion(plan, FORMATS.REEL.maxSeconds ?? 90).map((f) => f.code)).not.toContain("too_long");
  });

  it("reports scenes pinned to the floor, where a shot is seen rather than read", () => {
    const spec = reel();
    const terse = { ...spec, frames: spec.frames.map((frame) => ({ ...frame, text: [{ ...frame.text[0], content: "Go" }] })) };
    expect(inspectMotion(planMotion(terse, "cut"), 90).map((f) => f.code)).toContain("rushed");
  });

  it("says a single scene is a still, not a video", () => {
    const spec = reel();
    expect(inspectMotion(planMotion({ ...spec, frames: spec.frames.slice(0, 1) }, "cut"), 90).map((f) => f.code)).toContain("single_scene");
  });
});

describe("the filter graph", () => {
  const files = (count: number, withType = false): SceneFiles[] =>
    Array.from({ length: count }, (_, i) => ({ picture: `/tmp/s${i}.png`, type: withType ? `/tmp/t${i}.png` : null }));

  it("gives every scene an input of its own length", () => {
    const plan = planMotion(reel(), "cut");
    const args = encodeArgs(plan, files(plan.scenes.length), "/tmp/out.mp4");
    for (const scene of plan.scenes) expect(args).toContain(String(scene.hold));
    expect(args.filter((a) => a === "-loop")).toHaveLength(plan.scenes.length);
  });

  it("concatenates a cut and cross-fades a dissolve", () => {
    const plan = planMotion(reel(), "cut");
    expect(encodeArgs(plan, files(plan.scenes.length), "/tmp/o.mp4").join(" ")).toContain("concat=n=");
    const drift = planMotion(reel(), "drift");
    const graph = encodeArgs(drift, files(drift.scenes.length, true), "/tmp/o.mp4").join(" ");
    expect(graph).toContain("xfade=transition=fade");
    expect(encodeArgs(planMotion(reel(), "wipe"), files(6), "/tmp/o.mp4").join(" ")).toContain("xfade=transition=slideleft");
  });

  it("moves the picture and leaves the words where they are", () => {
    // The craft rule the whole layer split exists for. A pan applied to the composed frame would
    // slide the headline sideways under the reader's eye, which is worse than not moving at all.
    const plan = planMotion(reel(), "drift");
    const graph = encodeArgs(plan, files(plan.scenes.length, true), "/tmp/o.mp4").join(" ");
    expect(graph).toContain("crop=1080:1920");
    // The type layer goes back on top, unmoved and unfiltered.
    expect(graph).toMatch(/\[p\d+\]\[\d+:v\]overlay=0:0/);
  });

  it("does not move a scene that has no picture behind its words", () => {
    const plan = planMotion(reel(), "drift");
    const graph = encodeArgs(plan, files(plan.scenes.length, false), "/tmp/o.mp4").join(" ");
    expect(graph).not.toContain("crop=");
    expect(graph).not.toContain("overlay=");
  });

  it("numbers its inputs correctly when scenes have different layer counts", () => {
    // An off-by-one here shows the wrong picture on the wrong scene, silently.
    const plan = planMotion(reel(), "drift");
    const mixed = plan.scenes.map((_, i) => ({ picture: `/tmp/s${i}.png`, type: i % 2 === 0 ? `/tmp/t${i}.png` : null }));
    const args = encodeArgs(plan, mixed, "/tmp/o.mp4");
    const inputs = args.filter((a, i) => args[i - 1] === "-i");
    expect(inputs).toEqual(mixed.flatMap((f) => (f.type ? [f.picture, f.type] : [f.picture])));
    const graph = args[args.indexOf("-filter_complex") + 1];
    // Every referenced input index exists.
    for (const match of graph.matchAll(/\[(\d+):v\]/g)) expect(Number(match[1])).toBeLessThan(inputs.length);
  });

  it("always produces something a platform will accept", () => {
    for (const key of MOTION_SYSTEMS) {
      const plan = planMotion(reel(), key);
      const args = encodeArgs(plan, files(plan.scenes.length, key === "drift"), "/tmp/o.mp4").join(" ");
      expect(args, key).toContain("libx264");
      expect(args, key).toContain("yuv420p");
      // faststart is what lets a preview begin before the file has finished arriving.
      expect(args, key).toContain("+faststart");
    }
  });

  it("scales to even dimensions, which H.264 requires", () => {
    const plan = planMotion(reel(), "drift");
    const graph = encodeArgs(plan, files(plan.scenes.length, true), "/tmp/o.mp4").join(" ");
    for (const match of graph.matchAll(/scale=(\d+):(\d+)/g)) {
      expect(Number(match[1]) % 2, match[0]).toBe(0);
      expect(Number(match[2]) % 2, match[0]).toBe(0);
    }
  });
});
