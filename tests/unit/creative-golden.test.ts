import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeSpec } from "@/lib/creative/compose";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { DESIGN_SYSTEMS } from "@/lib/creative/design-systems";
import { CREATIVE_FORMATS } from "@/lib/creative/formats";
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

  it("a spec's fingerprint matches the pinned one, so a re-render is byte-identical", () => {
    const brief = localBrief({ format: "CAROUSEL", mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES });
    const spec = composeSpec(brief, tokens, { brandVersion: "golden", system: "editorial", organizationName: "Albert School" });
    const pinned = JSON.parse(readFileSync(join(GOLDEN, "carousel-editorial.json"), "utf8")) as { fingerprint: string };
    expect(spec.fingerprint).toBe(pinned.fingerprint);
  });
});
