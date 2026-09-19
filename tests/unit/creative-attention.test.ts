import { describe, expect, it } from "vitest";
import { composeSpec } from "@/lib/creative/compose";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { FORMATS, VIDEO_FORMATS, hookWords } from "@/lib/creative/formats";
import { holdFor, inspectMotion, paceFor, planMotion, wordsOn } from "@/lib/creative/motion";
import { inspect } from "@/lib/creative/qa";
import { localBrief } from "@/server/ai/services/art-director";
import { parseBrief } from "@/lib/creative/brief";
import type { FrameSpec } from "@/lib/creative/brief";

/**
 * A vertical cut is a different film, not a shorter one.
 *
 * The thing under test is that the difference is real and mechanical rather than a line in a
 * prompt: the same words come out as two timelines that a viewer would experience differently,
 * and the checks hold each to its own shape's rules.
 */
const ALBERT: BrandSystem = { ...DEFAULT_BRAND_SYSTEM, colours: { brand: "#10203A", accent: "#2BAFE0", ink: "#17191C", paper: "#FFFFFF" } };
const STORIES = [
  {
    id: "s1",
    headline: "The alum turning satellite images into crop forecasts",
    standfirst: "Three years after graduating, Nadia Chevalier is selling weather risk models to insurers who used to guess. The company closed a first round in March.",
    figures: ["€1.2M"],
    quotes: [{ text: "We were told the data was too noisy. It was not noisy, it was unlabelled.", attribution: "Nadia Chevalier, class of 2023" }],
  },
  { id: "s2", headline: "Marseille opens its second data lab" },
  { id: "s3", headline: "Six students place in the national AI olympiad" },
  { id: "s4", headline: "A new elective on causal inference" },
];
const tokens = compileBrandSystem(ALBERT);

function cut(format: "REEL" | "LANDSCAPE_VIDEO") {
  const brief = localBrief({ format, mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
  const spec = composeSpec(brief, tokens, { brandVersion: "t", system: "editorial", organizationName: "Albert School" });
  return { brief, spec, motion: planMotion(spec, "drift") };
}

describe("the two video shapes have different temperaments", () => {
  const vertical = cut("REEL");
  const landscape = cut("LANDSCAPE_VIDEO");

  it("gives every moving shape an attention model, and the stills none", () => {
    for (const format of VIDEO_FORMATS) expect(FORMATS[format].attention, format).toBeTruthy();
    expect(FORMATS.CAROUSEL.attention).toBeUndefined();
  });

  it("cuts the same material into a short film and a long one", () => {
    // Not a trim: the vertical one is built from its own pattern and runs at its own pace.
    expect(vertical.motion.duration).toBeLessThan(landscape.motion.duration * 0.6);
    expect(vertical.motion.scenes.every((scene) => scene.hold <= FORMATS.REEL.attention!.maxHold)).toBe(true);
    const longest = Math.max(...landscape.motion.scenes.map((scene) => scene.hold));
    expect(longest).toBeGreaterThan(FORMATS.REEL.attention!.maxHold);
  });

  it("opens the vertical cut on the sharpest thing, inside the hook", () => {
    const opener = vertical.motion.scenes[0];
    expect(opener.hold).toBeLessThanOrEqual(FORMATS.REEL.attention!.hookSeconds);
    // The number, alone, at display size — not the nine-word headline it belongs to.
    expect(wordsOn(vertical.spec.frames[0])).toBeLessThanOrEqual(hookWords(FORMATS.REEL.attention!));
    expect(vertical.brief.frames[0].headline).toBe("€1.2M");
  });

  it("drops the round-up from a feed cut and keeps it on a film", () => {
    // Five other stories listed is a set telling somebody it has nothing left to say.
    expect(vertical.brief.frames.some((frame) => frame.layout === "list")).toBe(false);
    expect(landscape.brief.frames.some((frame) => frame.layout === "list")).toBe(true);
  });

  it("resets attention harder and cuts faster between shots", () => {
    const travel = (spec: typeof vertical.motion) => Math.max(...spec.scenes.map((scene) => Math.abs(scene.zoomTo - scene.zoomFrom)));
    expect(travel(vertical.motion)).toBeGreaterThan(travel(landscape.motion));
    expect(vertical.motion.transitionSeconds).toBeLessThan(landscape.motion.transitionSeconds);
  });

  it("holds the same frame for different lengths in each shape", () => {
    const frame = { text: [{ content: "Nine words is a perfectly ordinary opening line here", layer: "content" }] } as unknown as FrameSpec;
    expect(holdFor(frame, paceFor("REEL"))).toBeLessThan(holdFor(frame, paceFor("LANDSCAPE_VIDEO")));
  });

  it("passes its own checks, each against its own shape's rules", () => {
    for (const each of [vertical, landscape]) {
      expect(inspectMotion(each.motion, FORMATS[each.spec.format as "REEL"].maxSeconds ?? 90), each.spec.format).toEqual([]);
      expect(inspect(each.spec, each.brief).filter((finding) => finding.severity === "defect"), each.spec.format).toEqual([]);
    }
  });
});

describe("the shape is the person's choice, not the model's", () => {
  /*
   * The model answers "STORY" whatever was asked. Seen on a real call: a landscape film came back
   * as a brief claiming to be a Story.
   *
   * `setBrief` overrules it on the way into a pack, so nothing stored was ever the wrong shape.
   * This is the same correction one step earlier, where the brief is read — so a brief composed
   * without going through a pack is the shape somebody actually chose.
   */
  const fromModel = {
    format: "STORY",
    mode: "CINEMATIC",
    intent: "Land the number.",
    frames: [{ layout: "statement", headline: "Insurers used to guess.", surface: "brand", emphasis: "loud" }],
    caption: "A caption.",
    hashtags: [],
  };

  it("takes the shape back off the model", () => {
    const parsed = parseBrief(fromModel, { format: "LANDSCAPE_VIDEO", mode: "STUDIO" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.brief.format).toBe("LANDSCAPE_VIDEO");
    expect(parsed.brief.mode).toBe("STUDIO");
    // And the composed spec follows the shape that was actually asked for.
    const spec = composeSpec(parsed.brief, tokens, { brandVersion: "t", system: "editorial", organizationName: "Albert School" });
    expect([spec.width, spec.height]).toEqual([1920, 1080]);
  });

  it("lets the model write as many frames as the widest shape takes", () => {
    // A cap below a format's own maximum refuses the shot the format is asking for, silently.
    const widest = Math.max(...VIDEO_FORMATS.map((format) => FORMATS[format].maxFrames));
    const many = {
      ...fromModel,
      frames: Array.from({ length: widest }, (_, i) => ({
        layout: i === widest - 1 ? "cta" : "statement",
        headline: `Shot number ${i + 1} says its own thing`,
        // One ground holds the set, a second gives it structure, a third points — the same
        // proportion the structural checks ask for, so the count is what is under test here.
        surface: i === widest - 1 ? "accent" : i % 4 === 0 ? "ink" : "brand",
        emphasis: "loud",
      })),
    };
    const parsed = parseBrief(many, { format: "REEL", mode: "STUDIO" });
    expect(parsed.ok || (parsed as { problems: string[] }).problems).toBe(true);
  });

  it("leaves a brief alone when nobody asked for a shape", () => {
    const parsed = parseBrief(fromModel);
    expect(parsed.ok && parsed.brief.format).toBe("STORY");
  });
});

describe("what the checks refuse", () => {
  it("names an opening shot too wordy to be read inside the hook", () => {
    const wordy = cut("REEL");
    wordy.spec.frames[0] = {
      ...wordy.spec.frames[0],
      text: [{ ...wordy.spec.frames[0].text[0], content: "A perfectly reasonable sentence for a page and far too many words for the first second of a Reel" }],
    };
    const findings = inspectMotion(planMotion(wordy.spec, "drift"), 90);
    expect(findings.map((finding) => finding.code)).toContain("slow_hook");
    expect(findings.find((finding) => finding.code === "slow_hook")?.message).toMatch(/hook is 1.5s/);
  });

  it("treats a label opener as a defect in a feed and a note on paper", () => {
    for (const [format, severity] of [
      ["REEL", "defect"],
      ["CAROUSEL", "note"],
    ] as const) {
      const brief = localBrief({ format, mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
      const labelled = { ...brief, frames: [{ ...brief.frames[0], headline: "This month" }, ...brief.frames.slice(1)] };
      const spec = composeSpec(labelled, tokens, { brandVersion: "t", system: "editorial", organizationName: "Albert School" });
      const weak = inspect(spec, labelled).find((finding) => finding.code === "weak_opener");
      expect(weak?.severity, format).toBe(severity);
    }
  });

  it("calls an empty shot dead air in a feed, and merely rushed in a film", () => {
    for (const [format, code] of [
      ["REEL", "dead_shot"],
      ["LANDSCAPE_VIDEO", "rushed"],
    ] as const) {
      const each = cut(format);
      // An opener is allowed to be two enormous words; the shot after it is not.
      const emptied = { ...each.spec, frames: each.spec.frames.map((frame, index) => (index === 1 ? { ...frame, text: [{ ...frame.text[0], content: "Yes" }] } : frame)) };
      expect(inspectMotion(planMotion(emptied, "drift"), 900).map((finding) => finding.code), format).toContain(code);
    }
  });
});
