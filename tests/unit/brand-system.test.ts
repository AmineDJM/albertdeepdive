import { describe, expect, it } from "vitest";
import { contrastRatio, distance, ensureContrast, isLight, mix, parseHex, readableOn, relativeLuminance, safeHex, saturation, toHex } from "@/lib/brand/colour";
import { brandMenu, compileBrandSystem, contrastReport, DEFAULT_BRAND_SYSTEM, brandSystemSchema, SURFACE_KEYS, type BrandSystem } from "@/lib/brand/system";
import { FAMILIES, PERSONALITIES, PERSONALITY_KEYS, roleCss, typeScale } from "@/lib/brand/typography";
import { brandFromEvidence, extractFontFamilies, inferPersonality, pickBrandColours } from "@/lib/brand/discover";

describe("colour", () => {
  it("parses the shapes a person actually types", () => {
    expect(parseHex("#1F3A5F")).toEqual({ r: 31, g: 58, b: 95 });
    expect(parseHex("1f3a5f")).toEqual({ r: 31, g: 58, b: 95 });
    expect(parseHex("#ABC")).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHex("  #fff  ")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("rebeccapurple")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });

  it("agrees with WCAG on the anchors", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    // Order does not matter: it is a ratio of the two, not of foreground over background.
    expect(contrastRatio("#123456", "#EEEEEE")).toBeCloseTo(contrastRatio("#EEEEEE", "#123456"), 9);
  });

  it("falls back rather than propagating a bad hex", () => {
    expect(safeHex("#abc", "#000000")).toBe("#AABBCC");
    expect(safeHex("not a colour", "#123456")).toBe("#123456");
    expect(safeHex(null, "#123456")).toBe("#123456");
  });

  it("mixes and clamps", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#000000", "#FFFFFF", -3)).toBe("#000000");
    expect(mix("#000000", "#FFFFFF", 9)).toBe("#FFFFFF");
    expect(toHex({ r: -5, g: 300, b: 12.6 })).toBe("#00FF0D");
  });

  it("picks the more readable of two candidates, stably", () => {
    expect(readableOn("#FFFFFF", ["#EEEEEE", "#111111"])).toBe("#111111");
    expect(readableOn("#000000", ["#EEEEEE", "#111111"])).toBe("#EEEEEE");
    // A tie keeps the first, so compiling twice never flips.
    expect(readableOn("#808080", ["#111111", "#111111"])).toBe("#111111");
  });

  describe("ensureContrast", () => {
    it("leaves a colour that already passes alone", () => {
      expect(ensureContrast("#000000", "#FFFFFF")).toBe("#000000");
    });

    it("darkens a light colour on a light background until it can be read", () => {
      const fixed = ensureContrast("#FFE24A", "#FFFFFF", 4.5);
      expect(contrastRatio(fixed, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      // and keeps the hue: still more yellow than anything else.
      const rgb = parseHex(fixed)!;
      expect(rgb.r).toBeGreaterThan(rgb.b);
      expect(rgb.g).toBeGreaterThan(rgb.b);
    });

    it("lightens on a dark background", () => {
      const fixed = ensureContrast("#1F3A5F", "#101014", 4.5);
      expect(contrastRatio(fixed, "#101014")).toBeGreaterThanOrEqual(4.5);
      expect(relativeLuminance(fixed)).toBeGreaterThan(relativeLuminance("#1F3A5F"));
    });

    it("gives the extreme rather than looping when nothing can pass", () => {
      // Mid grey: neither black nor white reaches 21:1 against it, so a 21 minimum is impossible.
      const fixed = ensureContrast("#808080", "#808080", 21);
      expect(["#000000", "#FFFFFF"]).toContain(fixed);
    });
  });

  it("knows a wash from a colour", () => {
    expect(saturation("#808080")).toBe(0);
    expect(saturation("#FF0000")).toBe(1);
    expect(isLight("#FFFFFF")).toBe(true);
    expect(isLight("#101014")).toBe(false);
    expect(distance("#FF0000", "#FF0000")).toBe(0);
    expect(distance("#000000", "#FFFFFF")).toBeCloseTo(1, 2);
  });
});

/* ── The property the whole system rests on ───────────────────────────────────────────────── */

/** A deterministic PRNG, so a failure is a failure you can re-run. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function randomBrand(random: () => number): BrandSystem {
  const hex = () => toHex({ r: random() * 255, g: random() * 255, b: random() * 255 });
  return {
    ...DEFAULT_BRAND_SYSTEM,
    colours: { brand: hex(), accent: hex(), ink: hex(), paper: hex() },
    personality: PERSONALITY_KEYS[Math.floor(random() * PERSONALITY_KEYS.length)],
    shape: { roundness: random(), borderWidth: random() * 4, unit: 4 + random() * 12 },
  };
}

describe("compiling a brand", () => {
  it("never produces text that cannot be read, whatever the brand", () => {
    // The promise Briefly makes: your colours can be anything, and the output is still legible.
    // 400 brands including the pathological ones — four near-identical greys, a yellow "ink".
    const random = seeded(20260917);
    for (let i = 0; i < 400; i += 1) {
      const system = randomBrand(random);
      const failures = contrastReport(compileBrandSystem(system)).filter((row) => !row.passes);
      expect(failures, `seed ${i}: ${JSON.stringify(system.colours)} → ${JSON.stringify(failures)}`).toHaveLength(0);
    }
  });

  it("survives a brand of four identical colours", () => {
    const flat = { brand: "#7A7A7A", accent: "#7A7A7A", ink: "#7A7A7A", paper: "#7A7A7A" };
    const tokens = compileBrandSystem({ ...DEFAULT_BRAND_SYSTEM, colours: flat });
    expect(contrastReport(tokens).every((row) => row.passes)).toBe(true);
  });

  it("is pure: the same brand always compiles to the same tokens", () => {
    // Without this a rendered carousel could not be regenerated, and a golden test would be noise.
    const a = compileBrandSystem(DEFAULT_BRAND_SYSTEM);
    const b = compileBrandSystem(structuredClone(DEFAULT_BRAND_SYSTEM));
    expect(a).toEqual(b);
  });

  it("repairs a broken hex instead of rendering it", () => {
    const tokens = compileBrandSystem({ ...DEFAULT_BRAND_SYSTEM, colours: { ...DEFAULT_BRAND_SYSTEM.colours, brand: "chartreuse" } });
    expect(tokens.surfaces.brand.background).toBe(DEFAULT_BRAND_SYSTEM.colours.brand);
  });

  it("gives every surface a full set of roles", () => {
    const tokens = compileBrandSystem(DEFAULT_BRAND_SYSTEM);
    expect(Object.keys(tokens.surfaces).sort()).toEqual([...SURFACE_KEYS].sort());
    for (const surface of Object.values(tokens.surfaces)) {
      for (const role of ["background", "foreground", "subdued", "rule", "highlight"] as const) {
        expect(surface[role], `${surface.key}.${role}`).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("makes a muted surface that is visibly not the paper", () => {
    for (const paper of ["#FFFFFF", "#0A0A0C", "#FCFCFB"]) {
      const tokens = compileBrandSystem({ ...DEFAULT_BRAND_SYSTEM, colours: { ...DEFAULT_BRAND_SYSTEM.colours, paper } });
      expect(tokens.surfaces.muted.background).not.toBe(tokens.surfaces.paper.background);
    }
  });

  it("derives shape and motion from the brand's own numbers", () => {
    const square = compileBrandSystem({ ...DEFAULT_BRAND_SYSTEM, shape: { roundness: 0, borderWidth: 1, unit: 8 } });
    const round = compileBrandSystem({ ...DEFAULT_BRAND_SYSTEM, shape: { roundness: 1, borderWidth: 1, unit: 8 } });
    expect(square.shape.radiusLg).toBe(0);
    expect(round.shape.radiusLg).toBeGreaterThan(square.shape.radiusLg);
    expect(compileBrandSystem({ ...DEFAULT_BRAND_SYSTEM, motion: { pace: "energetic" } }).motion.durationMs).toBeLessThan(
      compileBrandSystem({ ...DEFAULT_BRAND_SYSTEM, motion: { pace: "calm" } }).motion.durationMs,
    );
  });

  it("validates what it is given", () => {
    expect(brandSystemSchema.safeParse(DEFAULT_BRAND_SYSTEM).success).toBe(true);
    expect(brandSystemSchema.safeParse({ ...DEFAULT_BRAND_SYSTEM, personality: "brutalist" }).success).toBe(false);
    expect(brandSystemSchema.safeParse({ ...DEFAULT_BRAND_SYSTEM, shape: { roundness: 4, borderWidth: 1, unit: 8 } }).success).toBe(false);
    expect(brandSystemSchema.safeParse({ ...DEFAULT_BRAND_SYSTEM, voice: { tone: ["plain", "warm", "precise", "formal"], avoid: [], person: "first" } }).success).toBe(false);
  });
});

describe("the menu handed to the Art Director", () => {
  it("offers names, never values", () => {
    const menu = brandMenu(DEFAULT_BRAND_SYSTEM);
    const serialised = JSON.stringify(menu);
    // If a hex, a font name or a pixel value can reach the model, it can put one in its answer —
    // and then the renderer is taking design instruction from a language model.
    expect(serialised).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(serialised).not.toMatch(/\d+px/);
    expect(serialised.toLowerCase()).not.toContain("fraunces");
    expect(menu.surfaces).toEqual([...SURFACE_KEYS]);
  });

  it("passes the voice through, because copy is the model's job", () => {
    const menu = brandMenu({ ...DEFAULT_BRAND_SYSTEM, voice: { tone: ["playful"], avoid: ["synergy"], person: "third" } });
    expect(menu.voice).toEqual({ tone: ["playful"], avoid: ["synergy"], person: "third" });
  });
});

describe("typography", () => {
  it("only names typefaces Briefly actually hosts", () => {
    for (const personality of Object.values(PERSONALITIES)) {
      for (const role of [personality.display, personality.text, personality.label, personality.figure]) {
        const family = FAMILIES[role.family];
        expect(family, `${personality.key} uses an unknown family`).toBeTruthy();
        expect(family.files.length).toBeGreaterThan(0);
        expect(role.weight).toBeGreaterThanOrEqual(family.weights[0]);
        expect(role.weight).toBeLessThanOrEqual(family.weights[1]);
      }
    }
  });

  it("builds a scale of steps, ascending, with the body size in it", () => {
    const scale = typeScale(16, 1.32);
    expect(scale).toHaveLength(7);
    expect(scale).toEqual([...scale].sort((a, b) => a - b));
    expect(scale).toContain(16);
  });

  it("turns a role into CSS with tracking in pixels", () => {
    const css = roleCss(PERSONALITIES.editorial.display, 100);
    expect(css["letter-spacing"]).toBe("-2.200px");
    expect(css["text-transform"]).toBe("none");
    expect(roleCss(PERSONALITIES.editorial.label, 20)["text-transform"]).toBe("uppercase");
  });
});

describe("discovering a brand", () => {
  it("reads font families out of CSS", () => {
    const css = `body{font-family:"Playfair Display",Georgia,serif}code{font-family:var(--mono)}h1{font-family:Inter}`;
    const families = extractFontFamilies(css);
    expect(families).toContain("playfair display");
    expect(families).toContain("georgia");
    expect(families).toContain("inter");
    expect(families.some((f) => f.startsWith("var("))).toBe(false);
  });

  it("infers a personality from type, then from what the organisation does", () => {
    expect(inferPersonality({ colours: [], fonts: ["jetbrains mono"], logoUrl: null }).personality).toBe("technical");
    expect(inferPersonality({ colours: [], fonts: ["playfair display", "georgia"], logoUrl: null }).personality).toBe("editorial");
    expect(inferPersonality({ colours: [], fonts: [], logoUrl: null, type: "INVESTOR" })).toEqual({ personality: "modern", origin: "default" });
    expect(inferPersonality({ colours: [], fonts: [], logoUrl: null }).personality).toBe(DEFAULT_BRAND_SYSTEM.personality);
  });

  it("never picks an accent that is the brand colour again", () => {
    const { brand, accent } = pickBrandColours(["#1F3A5F", "#1F3A60", "#1E3A5E"]);
    expect(accent).not.toBe(brand);
    expect(distance(accent, brand)).toBeGreaterThan(0.2);
  });

  it("prefers a colour somebody would name over a grey", () => {
    expect(pickBrandColours(["#F4F4F4", "#E8452C"]).brand).toBe("#E8452C");
  });

  it("returns a usable brand from nothing at all", () => {
    const { system, origin, notes } = brandFromEvidence({ colours: [], fonts: [], logoUrl: null });
    expect(brandSystemSchema.safeParse(system).success).toBe(true);
    expect(origin.brand).toBe("default");
    expect(notes.length).toBeGreaterThan(0);
    expect(contrastReport(compileBrandSystem(system)).every((r) => r.passes)).toBe(true);
  });

  it("keeps ink ours even when a site hands us one", () => {
    // A site's body grey is chosen for one background; adopting it as a design system's ink is how
    // you get a slide nobody can read.
    const { system } = brandFromEvidence({ colours: ["#6B7280", "#E8452C"], fonts: [], logoUrl: null });
    expect(system.colours.ink).toBe(DEFAULT_BRAND_SYSTEM.colours.ink);
  });

  it("follows a dark site into the dark", () => {
    const { system } = brandFromEvidence({ colours: ["#0B0B0D", "#4F8EF7"], fonts: [], logoUrl: null });
    expect(relativeLuminance(system.colours.paper)).toBeLessThan(0.1);
    expect(contrastReport(compileBrandSystem(system)).every((r) => r.passes)).toBe(true);
  });
});
