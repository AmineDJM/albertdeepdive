import { describe, expect, it } from "vitest";
import { auditSpec, composeSpec, fingerprintOf, wrapLines } from "@/lib/creative/compose";
import { creativeBriefSchema, parseBrief, type CreativeBrief } from "@/lib/creative/brief";
import { clampFrames, CREATIVE_FORMATS, durationSeconds, FORMATS, MODES, typeBox } from "@/lib/creative/formats";
import { localBrief } from "@/server/ai/services/art-director";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { contrastRatio } from "@/lib/brand/colour";
import { PERSONALITY_KEYS } from "@/lib/brand/typography";
import { DESIGN_SYSTEMS, SYSTEMS, designSystem } from "@/lib/creative/design-systems";

const ALBERT: BrandSystem = {
  ...DEFAULT_BRAND_SYSTEM,
  colours: { brand: "#10203A", accent: "#2BAFE0", ink: "#17191C", paper: "#FFFFFF" },
};

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
  { id: "s4", headline: "A new elective on causal inference" },
];

const briefFor = (overrides: Partial<Parameters<typeof localBrief>[0]> = {}) =>
  localBrief({ format: "CAROUSEL", mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES, ...overrides });

describe("formats", () => {
  it("keeps type out of the platform's own interface", () => {
    // A Story's top 250px belong to Instagram. Type placed there is type somebody else's UI sits on.
    const story = typeBox("STORY");
    expect(story.y).toBe(FORMATS.STORY.safeArea.top);
    expect(story.height).toBe(FORMATS.STORY.height - FORMATS.STORY.safeArea.top - FORMATS.STORY.safeArea.bottom);
    for (const format of CREATIVE_FORMATS) {
      const box = typeBox(format);
      expect(box.width, format).toBeGreaterThan(0);
      expect(box.height, format).toBeGreaterThan(0);
    }
  });

  it("clamps a frame count into what the format allows", () => {
    expect(clampFrames("CAROUSEL", 40)).toBe(10);
    expect(clampFrames("CAROUSEL", 1)).toBe(3);
    expect(clampFrames("SQUARE_POST", 6)).toBe(1);
    expect(clampFrames("CAROUSEL", Number.NaN)).toBe(3);
  });

  it("turns scenes into seconds only for the formats that move, at each one's own pace", () => {
    expect(durationSeconds("CAROUSEL", 6)).toBe(0);
    // Two seconds a shot on a feed cut against four on a film: the turnover is the difference
    // between them, so the same scene count is not the same running time.
    expect(durationSeconds("REEL", 5)).toBe(10);
    expect(durationSeconds("LANDSCAPE_VIDEO", 5)).toBe(20);
  });

  it("only lets one mode reach for a picture that was never photographed", () => {
    expect(MODES.AUTHENTIC.usesGeneratedImagery).toBe(false);
    expect(MODES.STUDIO.usesGeneratedImagery).toBe(false);
    expect(MODES.CINEMATIC.usesGeneratedImagery).toBe(true);
    expect(MODES.CINEMATIC.caution).toBeTruthy();
  });
});

describe("the brief a model may write", () => {
  it("accepts one the renderer can draw", () => {
    expect(parseBrief(briefFor()).ok).toBe(true);
  });

  it("rejects a frame whose layout needs something it does not have", () => {
    const base = briefFor();
    const broken = { ...base, frames: [{ layout: "figure", headline: "A number", surface: "ink", emphasis: "loud" }, ...base.frames.slice(1)] };
    const result = parseBrief(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/figure frame needs "figure"/);
  });

  it("rejects a set that never changes ground", () => {
    const frames = Array.from({ length: 4 }, () => ({ layout: "statement" as const, headline: "Same", surface: "paper" as const, emphasis: "normal" as const }));
    const result = parseBrief({ ...briefFor(), frames });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/same surface/i);
  });

  it("has no vocabulary for a colour, a font or a size", () => {
    // The whole safety property, as a schema. If any of these were expressible, a model could emit
    // one, and then the renderer would be taking design instruction from a language model.
    const shape = JSON.stringify(creativeBriefSchema.shape);
    for (const forbidden of ["colour", "color", "hex", "font", "fontSize", "weight", "px", "x", "y"]) {
      expect(Object.keys(creativeBriefSchema.shape), forbidden).not.toContain(forbidden);
    }
    expect(shape).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe("composing", () => {
  const tokens = compileBrandSystem(ALBERT);

  it("is pure: the same brief and brand always give the same spec", () => {
    // Without this a pack cannot be re-rendered a year later and a golden test is noise.
    const a = composeSpec(briefFor(), tokens, { brandVersion: "v1" });
    const b = composeSpec(briefFor(), compileBrandSystem(structuredClone(ALBERT)), { brandVersion: "v1" });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a).toEqual(b);
  });

  it("changes its fingerprint when anything visible changes, and not otherwise", () => {
    const base = composeSpec(briefFor(), tokens, { brandVersion: "v1" });
    const sameAgain = composeSpec(briefFor(), tokens, { brandVersion: "v1" });
    expect(sameAgain.fingerprint).toBe(base.fingerprint);

    const recoloured = composeSpec(briefFor(), compileBrandSystem({ ...ALBERT, colours: { ...ALBERT.colours, brand: "#7A1F3D" } }), { brandVersion: "v1" });
    expect(recoloured.fingerprint).not.toBe(base.fingerprint);

    const reworded = composeSpec({ ...briefFor(), caption: "Something else entirely" }, tokens, { brandVersion: "v1" });
    expect(reworded.fingerprint).not.toBe(base.fingerprint);
  });

  it("never puts text outside the frame, for any brand or personality", () => {
    // The property the copyfitter exists for. Long headlines, narrow canvases, dramatic type ratios.
    const long = [{ id: "x", headline: "A headline of quite remarkable length that no sensible editor would ever actually write but which must still be drawn inside the frame", standfirst: "And a standfirst that goes on at similar length, testing whether the body copy also steps down the scale rather than running off the bottom of the canvas entirely." }];
    for (const personality of PERSONALITY_KEYS) {
      for (const format of CREATIVE_FORMATS) {
        const brand = { ...ALBERT, personality };
        const brief = localBrief({ format, mode: "STUDIO", organizationName: "Test", brand, stories: long });
        const spec = composeSpec(brief, compileBrandSystem(brand), { brandVersion: "v" });
        expect(auditSpec(spec), `${personality}/${format}`).toEqual([]);
      }
    }
  });

  it("gives every frame something to read", () => {
    const spec = composeSpec(briefFor(), tokens, { brandVersion: "v" });
    for (const frame of spec.frames) {
      expect(frame.text.length, `frame ${frame.index}`).toBeGreaterThan(0);
      expect(frame.alt, `frame ${frame.index}`).toBeTruthy();
    }
  });

  it("keeps every colour readable on the surface it is drawn on", () => {
    // The brand system guarantees this for its own tokens; this re-checks after compositing, because
    // a photograph under the type is a different background from the one the token was checked on.
    for (const brand of [ALBERT, { ...ALBERT, colours: { brand: "#FFE24A", accent: "#F6F6F6", ink: "#6B7280", paper: "#FFFDF5" } }]) {
      const spec = composeSpec(briefFor(), compileBrandSystem(brand), { brandVersion: "v" });
      for (const frame of spec.frames) {
        if (frame.image) continue; // checked against the composited background, not the surface fill
        for (const text of frame.text) {
          const against = frame.shapes.find((shape) => shape.kind === "rect" && text.x >= shape.x && text.x < shape.x + shape.width && text.y >= shape.y && text.y < shape.y + shape.height);
          const ratio = contrastRatio(text.colour, against?.colour ?? frame.background);
          expect(ratio, `${text.content.slice(0, 24)} on ${against?.colour ?? frame.background}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("uses the format's own canvas, not a default one", () => {
    for (const format of CREATIVE_FORMATS) {
      const spec = composeSpec(localBrief({ format, mode: "STUDIO", organizationName: "T", brand: ALBERT, stories: STORIES }), tokens, { brandVersion: "v" });
      expect(spec.width, format).toBe(FORMATS[format].width);
      expect(spec.height, format).toBe(FORMATS[format].height);
      expect(spec.frames.length, format).toBeLessThanOrEqual(FORMATS[format].maxFrames);
    }
  });

  it("sets type at poster size rather than document size", () => {
    // The brand's own scale is anchored on a 16px body. A 64px headline on a 1080px canvas is a
    // caption, and getting this wrong is invisible in code and glaring in the output.
    const spec = composeSpec(briefFor(), tokens, { brandVersion: "v" });
    const biggest = Math.max(...spec.frames.flatMap((frame) => frame.text.map((text) => text.fontSize)));
    expect(biggest).toBeGreaterThan(100);
  });

  it("only asks for a picture in the mode that is allowed to invent one", () => {
    for (const mode of ["AUTHENTIC", "STUDIO", "CINEMATIC"] as const) {
      const brief: CreativeBrief = {
        ...briefFor({ mode }),
        frames: [
          { layout: "image_full", headline: "Over a picture", surface: "ink", emphasis: "loud", mediaId: "00000000-0000-4000-8000-000000000001" },
          { layout: "statement", headline: "And then", surface: "paper", emphasis: "normal" },
          { layout: "cta", headline: "Read on", surface: "brand", emphasis: "normal" },
        ],
      };
      const spec = composeSpec(brief, tokens, { brandVersion: "v" });
      // A frame that names a photograph never asks for one to be generated, in any mode.
      expect(spec.frames[0].image?.generate, mode).toBeUndefined();
    }
  });

  it("dims a photograph that has type on it", () => {
    const brief: CreativeBrief = {
      ...briefFor(),
      frames: [
        { layout: "image_full", headline: "Over a picture", surface: "ink", emphasis: "loud", mediaId: "00000000-0000-4000-8000-000000000001" },
        { layout: "image_top", headline: "Beside one", body: "With the words underneath.", surface: "paper", emphasis: "normal", mediaId: "00000000-0000-4000-8000-000000000002" },
        { layout: "cta", headline: "Read on", surface: "brand", emphasis: "normal" },
      ],
    };
    const spec = composeSpec(brief, tokens, { brandVersion: "v" });
    expect(spec.frames[0].image!.dim).toBeGreaterThanOrEqual(0.45);
    expect(spec.frames[1].image!.dim).toBe(0);
  });

  it("puts the quote's rule above the quote, wherever the quote landed", () => {
    // A quote anchors to the baseline. The rule used to be pinned to the top of the content box, so
    // on an editorial frame it sat several hundred pixels above its own quotation, beside the index
    // chip, reading as a stray mark. Nothing in the audit objected: it overflowed nothing.
    const brief: CreativeBrief = {
      ...briefFor(),
      frames: [
        { layout: "statement", headline: "Opening", surface: "brand", emphasis: "loud" },
        { layout: "quote", headline: "It was not noisy, it was unlabelled.", attribution: "Nadia Chevalier", surface: "paper", emphasis: "normal" },
        { layout: "cta", headline: "Read on", surface: "accent", emphasis: "normal" },
      ],
    };
    for (const key of DESIGN_SYSTEMS) {
      const spec = composeSpec(brief, tokens, { brandVersion: "v", system: key, organizationName: "Albert School" });
      const frame = spec.frames.find((candidate) => candidate.layout === "quote")!;
      const rule = frame.shapes.find((shape) => shape.kind === "rule" && shape.width < frame.width * 0.5)!;
      const words = frame.text.filter((text) => text.role === "display").sort((a, b) => a.y - b.y)[0];
      expect(rule, key).toBeTruthy();
      expect(rule.y, `${key}: rule at ${rule.y}, quote at ${words.y}`).toBeLessThan(words.y);
      expect(words.y - rule.y, `${key}: rule is ${Math.round(words.y - rule.y)}px above its own quote`).toBeLessThan(words.fontSize * 2);
    }
  });

  it("hashes the spec, not the object identity", () => {
    const spec = composeSpec(briefFor(), tokens, { brandVersion: "v" });
    const { fingerprint, ...rest } = spec;
    expect(fingerprintOf(rest)).toBe(fingerprint);
  });
});

describe("wrapping", () => {
  it("breaks greedily, the way a renderer does", () => {
    const lines = wrapLines("one two three four five six seven eight", 200, "inter", 40, 0, false, 400);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("one two three four five six seven eight");
  });

  it("estimates wide rather than narrow", () => {
    // An estimate that runs narrow puts a headline off the frame; one that runs wide picks a smaller
    // step. Only the first is visible, so the table is deliberately pessimistic.
    const narrow = wrapLines("The alum turning satellite images into crop forecasts", 1032, "newsreader", 54.3, 0, false, 400);
    expect(narrow[0].length).toBeLessThanOrEqual("The alum turning satellite images into".length);
  });

  it("returns nothing for nothing", () => {
    expect(wrapLines("   ", 500, "inter", 20, 0, false)).toEqual([]);
  });
});

describe("the brief built without a model", () => {
  it("is a real editorial pattern, not a placeholder", () => {
    const brief = briefFor();
    const layouts = brief.frames.map((frame) => frame.layout);
    expect(layouts[0]).toBe("statement");
    expect(layouts).toContain("figure");
    expect(layouts).toContain("quote");
    expect(layouts.at(-1)).toBe("cta");
  });

  it("is deterministic", () => {
    expect(briefFor()).toEqual(briefFor());
  });

  it("honours the format's minimum even with nothing to say", () => {
    const brief = localBrief({ format: "CAROUSEL", mode: "STUDIO", organizationName: "Quiet Co", brand: ALBERT, stories: [{ id: "a", headline: "One thing happened" }] });
    expect(brief.frames.length).toBeGreaterThanOrEqual(FORMATS.CAROUSEL.minFrames);
    expect(parseBrief(brief).ok).toBe(true);
  });

  it("survives having no material at all", () => {
    const brief = localBrief({ format: "SQUARE_POST", mode: "STUDIO", organizationName: "Empty Co", brand: ALBERT, stories: [] });
    expect(creativeBriefSchema.safeParse(brief).success).toBe(true);
    expect(auditSpec(composeSpec(brief, compileBrandSystem(ALBERT), { brandVersion: "v" }))).toEqual([]);
  });
});

describe("design systems", () => {
  const tokens = compileBrandSystem(ALBERT);
  const compose = (system: string) => composeSpec(briefFor(), tokens, { brandVersion: "v", system, organizationName: "Albert School" });

  it("produce visibly different compositions from the same brief and brand", () => {
    const fingerprints = DESIGN_SYSTEMS.map((key) => compose(key).fingerprint);
    expect(new Set(fingerprints).size).toBe(DESIGN_SYSTEMS.length);
  });

  it("all stay inside the frame", () => {
    // Each system moves the margins and the type steps, so each is its own chance to overflow.
    for (const key of DESIGN_SYSTEMS) {
      expect(auditSpec(compose(key)), key).toEqual([]);
    }
  });

  it("never let a system's furniture sit on its own content", () => {
    // A system declares the room it took; the composer lays out in what is left. This is that
    // contract, checked: no chrome block may overlap a content block.
    for (const key of DESIGN_SYSTEMS) {
      const spec = compose(key);
      for (const frame of spec.frames) {
        // Background blocks are texture and are meant to sit behind the type; everything else is
        // information and must not.
        const readable = frame.text.filter((text) => text.layer !== "background");
        const chrome = readable.filter((text) => text.role === "label");
        const content = readable.filter((text) => !chrome.includes(text));
        for (const a of chrome) {
          for (const b of content) {
            const overlapsY = a.y < b.y + b.lines * b.fontSize * b.lineHeight && b.y < a.y + a.lines * a.fontSize * a.lineHeight;
            const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
            expect(overlapsY && overlapsX, `${key} frame ${frame.index}: "${a.content}" over "${b.content.slice(0, 24)}"`).toBe(false);
          }
        }
      }
    }
  });

  it("keeps type inside the platform's safe area even when a system pulls the margins in", () => {
    // Poster has a negative gutter. It may tighten the margin; it may not bleed under Instagram's
    // own interface, which is what the safe area is for.
    const spec = composeSpec(localBrief({ format: "STORY", mode: "STUDIO", organizationName: "T", brand: ALBERT, stories: STORIES }), tokens, { brandVersion: "v", system: "poster" });
    for (const frame of spec.frames) {
      for (const text of frame.text) {
        expect(text.x, text.content.slice(0, 20)).toBeGreaterThanOrEqual(0);
        expect(text.x + text.width).toBeLessThanOrEqual(frame.width);
      }
    }
  });

  it("falls back to editorial rather than failing on an unknown name", () => {
    expect(designSystem("something-else").key).toBe("editorial");
    expect(designSystem(null).key).toBe("editorial");
    expect(designSystem("poster").key).toBe("poster");
  });

  it("describes each system by the job it does", () => {
    for (const key of DESIGN_SYSTEMS) {
      expect(SYSTEMS[key].name, key).toBeTruthy();
      expect(SYSTEMS[key].description.length, key).toBeGreaterThan(30);
    }
  });

  it("marks the poster numeral as texture rather than as something to read", () => {
    const spec = compose("poster");
    const numeral = spec.frames[0].text.find((text) => /^\d\d$/.test(text.content));
    expect(numeral?.layer).toBe("background");
    // And the report's header is the opposite: information, drawn on top, never overlapped.
    expect(compose("report").frames[0].text.find((text) => text.content === "ALBERT SCHOOL" || text.content === "Albert School")?.layer).not.toBe("background");
  });

  it("records which system drew a spec, so a re-render reproduces it", () => {
    expect(compose("report").system).toBe("report");
  });

  it("wraps a list item that is a word too long", () => {
    // Found by the poster system, whose wider measure and hotter step turned a fitting item into an
    // overflowing one. Items used to be emitted whole, with `white-space: pre`.
    const brief: CreativeBrief = {
      ...briefFor(),
      frames: [
        { layout: "statement", headline: "Opening", surface: "brand", emphasis: "loud" },
        { layout: "list", headline: "Everything at once", items: ["A list item of quite considerable length that will certainly not fit on one line at this size", "Short one"], surface: "paper", emphasis: "loud" },
        { layout: "cta", headline: "Read on", surface: "accent", emphasis: "normal" },
      ],
    };
    for (const key of DESIGN_SYSTEMS) {
      const spec = composeSpec(brief, tokens, { brandVersion: "v", system: key });
      expect(auditSpec(spec), key).toEqual([]);
      const listFrame = spec.frames.find((frame) => frame.layout === "list")!;
      // The long item became more than one block, which is what wrapping looks like from outside.
      expect(listFrame.text.filter((text) => text.role === "text").length, key).toBeGreaterThan(2);
    }
  });
});
