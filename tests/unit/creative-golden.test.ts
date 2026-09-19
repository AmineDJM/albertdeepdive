import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeSpec } from "@/lib/creative/compose";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { DESIGN_SYSTEMS, SYSTEMS } from "@/lib/creative/design-systems";
import { CREATIVE_FORMATS, FORMATS, OFFERED_FORMATS, VIDEO_FORMATS, orientationOf } from "@/lib/creative/formats";
import { inspectMotion, planMotion } from "@/lib/creative/motion";
import { apparentPx, MIN_APPARENT_PX, opticalInset } from "@/lib/creative/laws";
import { localBrief } from "@/server/ai/services/art-director";
import { inspect } from "@/lib/creative/qa";

/**
 * The spec, pinned.
 *
 * The composer is a pure function, which is the property that makes this possible and the reason it
 * is worth having: a golden file is only meaningful if the same inputs really do give the same
 * bytes. What it protects is the thing unit tests are worst at noticing — a refactor that moves a
 * headline eleven pixels, changes a type step, or quietly recolours a chip. Every such change shows
 * up here as a diff somebody has to look at and approve.
 *
 * Regenerate deliberately, never reflexively: `UPDATE_GOLDEN=1 pnpm vitest run creative-golden`.
 * A diff in this file is the review asking "did you mean to change how everything looks?", and the
 * honest answer is sometimes yes.
 */

const GOLDEN = join(process.cwd(), "tests", "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

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

function check(name: string, actual: unknown) {
  const path = join(GOLDEN, `${name}.json`);
  const serialised = `${JSON.stringify(actual, null, 2)}\n`;
  if (UPDATE || !existsSync(path)) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(path, serialised);
    return;
  }
  expect(serialised, `${name} changed — look at the diff, then UPDATE_GOLDEN=1 if you meant it`).toBe(readFileSync(path, "utf8"));
}

describe("golden specs", () => {
  const tokens = compileBrandSystem(ALBERT);

  for (const system of DESIGN_SYSTEMS) {
    it(`${system} composes the same carousel it did yesterday`, () => {
      const brief = localBrief({ format: "CAROUSEL", mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
      const spec = composeSpec(brief, tokens, { brandVersion: "golden", system, organizationName: "Albert School" });
      check(`carousel-${system}`, spec);
    });
  }

  it("pins the brand's compiled tokens, which every composition is derived from", () => {
    // A change here moves every pack for every customer, which is exactly the size of decision that
    // should not be possible to make by accident.
    check("brand-tokens", tokens);
  });

  it("pins each format's opener, where the copyfitter does its most visible work", () => {
    const frames = Object.fromEntries(
      CREATIVE_FORMATS.map((format) => {
        const brief = localBrief({ format, mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
        return [format, composeSpec(brief, tokens, { brandVersion: "golden", organizationName: "Albert School" }).frames[0]];
      }),
    );
    check("format-openers", frames);
  });
});

describe("golden invariants", () => {
  const tokens = compileBrandSystem(ALBERT);

  it("every pinned spec is still clean under the current rules", () => {
    // The golden files say "this is what we draw". This says "and it is still correct" — without it,
    // a regenerated golden could pin a defect forever.
    for (const system of DESIGN_SYSTEMS) {
      const brief = localBrief({ format: "CAROUSEL", mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
      const spec = composeSpec(brief, tokens, { brandVersion: "golden", system, organizationName: "Albert School" });
      const defects = inspect(spec, brief).filter((finding) => finding.severity === "defect");
      expect(defects, system).toEqual([]);
    }
  });

  it("composes every shape cleanly, in every design system", () => {
    /*
     * A canvas that is wider than it is tall is the case the engine had never met: every type step,
     * measure and safe area is derived from the canvas, and a rule that quietly assumed portrait
     * would show up as a headline through a progress bar rather than as a failing test. This runs
     * the full QA pass over all of them so that the assumption, if there is one, is named here.
     */
    for (const format of OFFERED_FORMATS) {
      for (const system of DESIGN_SYSTEMS) {
        const brief = localBrief({ format, mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
        const spec = composeSpec(brief, tokens, { brandVersion: "golden", system, organizationName: "Albert School" });
        const defects = inspect(spec, brief).filter((finding) => finding.severity === "defect");
        expect(defects, `${format} / ${system}`).toEqual([]);

        const { safeArea } = FORMATS[format];
        // Sideways, a system may push out by one gutter step — poster's whole character is type
        // closer to the edge — but never further. The vertical rule, where the platform's own
        // furniture actually sits, is stricter and lives in the safe-area test next door.
        const give = Math.max(0, -SYSTEMS[system].gutter) * tokens.shape.space[3];
        for (const frame of spec.frames) {
          for (const text of frame.text.filter((item) => item.layer !== "background")) {
            // Display type is nudged left so its first character aligns optically rather than
            // mathematically; adding the nudge back is what the margin actually is.
            const optical = opticalInset(text.fontSize, text.content[0] ?? "");
            expect(text.x + optical, `${format}/${system} left`).toBeGreaterThanOrEqual(safeArea.left - give - 1);
            // The legibility floor is a function of the canvas, so a 1920-wide film needs bigger
            // type than a 1080-wide one to read the same size in somebody's hand.
            expect(apparentPx(text.fontSize, frame.width), `${format}/${system} "${text.content.slice(0, 30)}"`).toBeGreaterThanOrEqual(MIN_APPARENT_PX - 0.01);
          }
        }
      }
    }
  });

  it("offers video as two shapes, and cuts both within what their platforms take", () => {
    /*
     * Not the same film turned on its side. The vertical cut is held in one hand and thumbed past;
     * the landscape one is played on a screen somebody is already watching. They differ in canvas,
     * in which way round they are, and in how much of the frame another app's interface owns — and
     * each has to come in under its own platform's ceiling from the same material.
     */
    expect(VIDEO_FORMATS).toEqual(["REEL", "LANDSCAPE_VIDEO"]);
    const cuts = VIDEO_FORMATS.map((format) => {
      const brief = localBrief({ format, mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
      const spec = composeSpec(brief, tokens, { brandVersion: "golden", system: "editorial", organizationName: "Albert School" });
      return { format, motion: planMotion(spec, "drift"), definition: FORMATS[format] };
    });

    const [vertical, landscape] = cuts;
    expect(orientationOf(vertical.format)).toBe("portrait");
    expect(orientationOf(landscape.format)).toBe("landscape");
    // TikTok's button column and caption block take far more of a vertical frame than YouTube's
    // control bar takes of a wide one; a shared safe area would be wrong for both.
    expect(vertical.definition.safeArea).not.toEqual(landscape.definition.safeArea);
    // 90 seconds against fifteen minutes: the vertical ceiling is the one that actually binds.
    expect(vertical.definition.maxSeconds!).toBeLessThan(landscape.definition.maxSeconds!);

    for (const cut of cuts) {
      const limit = cut.definition.maxSeconds ?? 0;
      expect(cut.motion.duration, `${cut.format} runs longer than the platform takes`).toBeLessThanOrEqual(limit);
      expect(inspectMotion(cut.motion, limit).map((finding) => finding.code), cut.format).not.toContain("too_long");
      expect(cut.motion.width).toBe(cut.definition.width);
      expect(cut.motion.height).toBe(cut.definition.height);
    }
  });

  it("a spec's fingerprint matches the pinned one, so a re-render is byte-identical", () => {
    const brief = localBrief({ format: "CAROUSEL", mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
    const spec = composeSpec(brief, tokens, { brandVersion: "golden", system: "editorial", organizationName: "Albert School" });
    const pinned = JSON.parse(readFileSync(join(GOLDEN, "carousel-editorial.json"), "utf8")) as { fingerprint: string };
    expect(spec.fingerprint).toBe(pinned.fingerprint);
  });
});
