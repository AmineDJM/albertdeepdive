import { describe, expect, it } from "vitest";
import {
  apparentPx,
  CAPTION_VISIBLE_CHARS,
  coloursVibrate,
  debalance,
  isWeakOpener,
  isWidow,
  largeTextThreshold,
  LAWS,
  lawById,
  lawsOfKind,
  leadingFor,
  maxMeasureWidth,
  MEASURE,
  MIN_APPARENT_PX,
  minFontSize,
  opticalInset,
  PHONE_WIDTH,
  scrimFor,
  worstCaseUnder,
  vibrates,
} from "@/lib/creative/laws";
import { advanceFor, composeSpec, wrapLines } from "@/lib/creative/compose";
import { contrastRatio, hue, mix, relativeLuminance, saturation } from "@/lib/brand/colour";
import { inspect, lawFor, verdict } from "@/lib/creative/qa";
import { DESIGN_SYSTEMS } from "@/lib/creative/design-systems";
import { CREATIVE_FORMATS, FORMATS } from "@/lib/creative/formats";
import { localBrief } from "@/server/ai/services/art-director";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { PERSONALITY_KEYS } from "@/lib/brand/typography";
import { parseBrief, unattributedQuotations } from "@/lib/creative/brief";
import type { CreativeBrief, FrameSpec, RenderSpec, TextBlock } from "@/lib/creative/brief";

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

const tokens = compileBrandSystem(ALBERT);
const compose = (brief: CreativeBrief, system = "editorial") => composeSpec(brief, tokens, { brandVersion: "v", system, organizationName: "Albert School" });

describe("the catalogue", () => {
  it("cites a source for every rule, because 'best practice' is not one", () => {
    for (const law of LAWS) {
      expect(law.source.length, law.id).toBeGreaterThan(3);
      expect(law.source.toLowerCase(), law.id).not.toContain("best practice");
      // Every rule says what it costs to break it, so somebody can decide to.
      expect(law.because.length, law.id).toBeGreaterThan(30);
    }
  });

  it("has one entry per id and splits into the two kinds", () => {
    expect(new Set(LAWS.map((law) => law.id)).size).toBe(LAWS.length);
    expect(lawsOfKind("enforced").length + lawsOfKind("checked").length).toBe(LAWS.length);
    expect(lawById("measure")?.kind).toBe("enforced");
    expect(lawById("hook")?.kind).toBe("checked");
    expect(lawById("nonsense")).toBeUndefined();
  });

  it("cites a real rule for every finding that claims one", () => {
    // The studio prints the law's name and source beside the finding. A code mapped to an id that is
    // not in the catalogue would print nothing and quietly stop explaining itself.
    const codes = [
      "contrast",
      "too_small",
      "overflow_bottom",
      "overflow_side",
      "weak_opener",
      "two_ctas",
      "caption_buried",
      "many_hashtags",
      "no_dominant_surface",
      "vibration",
    ];
    for (const code of codes) {
      const law = lawFor({ severity: "defect", frame: null, code, message: "", repairable: false });
      expect(law, code).toBeTruthy();
      expect(LAWS.map((entry) => entry.id), code).toContain(law!.id);
    }
    // And a finding that is not a rule says so rather than inventing one.
    expect(lawFor({ severity: "note", frame: null, code: "no_image", message: "", repairable: false })).toBeUndefined();
  });

  it("states the rule with the number the code actually uses", () => {
    // A catalogue that drifts from the engine is worse than no catalogue: it is documentation that
    // lies. Interpolating the constants is what keeps the two honest.
    expect(lawById("measure")?.rule).toContain(String(MEASURE.max));
    expect(lawById("min-size")?.rule).toContain(String(MIN_APPARENT_PX));
    expect(lawById("caption-first-line")?.rule).toContain(String(CAPTION_VISIBLE_CHARS));
  });
});

describe("measure and leading", () => {
  it("gives a long line more leading and a short line less, within a hair of the brand's own", () => {
    const base = 1.4;
    expect(leadingFor(base, MEASURE.ideal)).toBeCloseTo(base, 2);
    expect(leadingFor(base, MEASURE.max)).toBeGreaterThan(leadingFor(base, MEASURE.ideal));
    expect(leadingFor(base, MEASURE.min)).toBeLessThan(leadingFor(base, MEASURE.ideal));
    // ±8%: enough to fit the measure, not enough to read as a different decision.
    for (const chars of [10, 45, 66, 75, 200]) {
      expect(leadingFor(base, chars)).toBeGreaterThanOrEqual(base * 0.92 - 0.001);
      expect(leadingFor(base, chars)).toBeLessThanOrEqual(base * 1.08 + 0.001);
    }
    expect(leadingFor(base, 0)).toBe(base);
  });

  it("caps a box at the measure rather than filling it", () => {
    const advance = advanceFor("newsreader", 400);
    const width = maxMeasureWidth(40, advance, MEASURE.max);
    expect(Math.round(width / (40 * advance))).toBe(MEASURE.max);
  });

  it("holds the measure in real composed output, across every system, format and personality", () => {
    // The rule the engine broke for months: a 1032px box at body size runs about 90 characters, and
    // nothing in the code objected because nothing in the code knew.
    const long = [
      {
        id: "x",
        headline: "A headline of quite remarkable length that no sensible editor would ever actually write but which must still be set to a readable measure",
        standfirst:
          "And a standfirst that goes on at similar length, testing whether the body copy is wrapped to a measure a reader can sweep rather than to whatever width the box happens to be.",
      },
    ];
    for (const personality of PERSONALITY_KEYS) {
      for (const format of CREATIVE_FORMATS) {
        for (const system of DESIGN_SYSTEMS) {
          const brand = { ...ALBERT, personality };
          const spec = composeSpec(localBrief({ format, mode: "STUDIO", organizationName: "Test", brand, stories: long }), compileBrandSystem(brand), {
            brandVersion: "v",
            system,
          });
          for (const frame of spec.frames) {
            for (const text of frame.text) {
              const longest = Math.max(0, ...text.content.split("\n").map((line) => line.length));
              const allowed = text.role === "display" || text.role === "figure" ? MEASURE.displayMax : MEASURE.max;
              // +1 for the greedy wrapper's last word, which may cross the cap rather than orphan itself.
              expect(longest, `${personality}/${format}/${system}: "${text.content.slice(0, 40)}"`).toBeLessThanOrEqual(allowed + 1);
            }
          }
        }
      }
    }
  });
});

describe("apparent size", () => {
  it("measures type by how big it is in the hand, not in the file", () => {
    expect(apparentPx(24, 1080)).toBeCloseTo((24 * PHONE_WIDTH) / 1080, 5);
    // The number that makes the point: 24px on a 1080 canvas is under 9px on a phone.
    expect(apparentPx(24, 1080)).toBeLessThan(9);
  });

  it("puts a floor under type that would otherwise be decoration", () => {
    for (const width of [1080, 1440, 2480]) {
      expect(apparentPx(minFontSize(width), width)).toBeGreaterThanOrEqual(MIN_APPARENT_PX);
    }
  });

  it("sets WCAG's large-text exemption far above the 48px the engine used to assume", () => {
    // The old constant granted 3:1 to type that is 17px in the hand. The standard means 24px on
    // screen, which on a 1080 canvas is about 66px.
    expect(largeTextThreshold(1080, false)).toBeGreaterThan(60);
    expect(largeTextThreshold(1080, true)).toBeLessThan(largeTextThreshold(1080, false));
    expect(apparentPx(largeTextThreshold(1080, false), 1080)).toBeCloseTo(24, 5);
    expect(apparentPx(largeTextThreshold(1080, true), 1080)).toBeCloseTo(18.66, 5);
  });

  it("never sets anything below the floor in real composed output", () => {
    for (const system of DESIGN_SYSTEMS) {
      for (const format of CREATIVE_FORMATS) {
        const spec = composeSpec(localBrief({ format, mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES }), tokens, {
          brandVersion: "v",
          system,
          organizationName: "Albert School",
        });
        for (const frame of spec.frames) {
          for (const text of frame.text) {
            expect(apparentPx(text.fontSize, frame.width), `${system}/${format}: "${text.content.slice(0, 24)}"`).toBeGreaterThanOrEqual(MIN_APPARENT_PX - 0.5);
          }
        }
      }
    }
  });
});

describe("widows", () => {
  it("knows one when it sees one", () => {
    expect(isWidow(["The alum turning satellite images", "into crop"], 40)).toBe(false);
    expect(isWidow(["The alum turning satellite images into crop", "forecasts"], 40)).toBe(true);
    expect(isWidow(["One line only"], 40)).toBe(false);
    // A stub is a widow even when it is two words.
    expect(isWidow(["A long first line that runs the measure", "a b"], 40)).toBe(true);
  });

  it("re-breaks by narrowing, and gives up rather than mangling", () => {
    const text = "Three years after graduating she is selling risk models to insurers who used to guess";
    const wrap = (width: number) => wrapLines(text, width, "inter", 32, 0, false, 400);
    const width = maxMeasureWidth(32, advanceFor("inter", 400), MEASURE.max);
    const fixed = debalance(wrap, width, MEASURE.max);
    if (fixed) {
      expect(fixed.join(" ")).toBe(text);
      expect(isWidow(fixed, MEASURE.max)).toBe(false);
    }
    // Two words, the second unbreakable: no narrowing produces a last line with a space in it, so the
    // answer is null and the caller leaves the text alone rather than mangling it.
    const stubborn = "Supercalifragilistic antidisestablishmentarianism";
    expect(isWidow(wrapLines(stubborn, 300, "inter", 32, 0, false, 400), MEASURE.max)).toBe(true);
    expect(debalance((w) => wrapLines(stubborn, w, "inter", 32, 0, false, 400), 300, MEASURE.max)).toBeNull();
  });
});

describe("colour and alignment", () => {
  it("spots a vibrating pair and clears a tinted one", () => {
    // Two saturated complements. The boundary between them is an edge the eye cannot settle on.
    expect(vibrates(20, 0.9, 200, 0.85)).toBe(true);
    // The same pair of hues, one of them a wash. Same angle, no vibration.
    expect(vibrates(20, 0.12, 200, 0.85)).toBe(false);
    // Neighbours, however hot.
    expect(vibrates(20, 0.95, 45, 0.95)).toBe(false);
    // The wrap-around case: 350° and 170° are complements too, and the naive difference calls them 180 apart.
    expect(vibrates(350, 0.9, 170, 0.9)).toBe(true);
    // And the case that proves the sign: identical hues do not vibrate, however saturated.
    expect(vibrates(200, 1, 200, 1)).toBe(false);
  });

  it("reads hue and saturation off a real hex", () => {
    expect(hue("#FF0000")).toBeCloseTo(0, 1);
    expect(hue("#00FF00")).toBeCloseTo(120, 1);
    expect(hue("#0000FF")).toBeCloseTo(240, 1);
    expect(saturation("#808080")).toBe(0);

    // Pure red on pure cyan: the textbook vibrating pair, straight off two hex values.
    expect(coloursVibrate({ hue: hue("#FF0000"), saturation: saturation("#FF0000") }, { hue: hue("#00FFFF"), saturation: saturation("#00FFFF") })).toBe(true);
    // A brand navy on a brand cyan — opposite-ish, but the navy is dark rather than hot.
    expect(coloursVibrate({ hue: hue("#10203A"), saturation: saturation("#10203A") }, { hue: hue("#F2F2F2"), saturation: saturation("#F2F2F2") })).toBe(false);
  });

  it("insets display type optically and leaves body type alone", () => {
    expect(opticalInset(16, "O")).toBe(0);
    expect(opticalInset(120, "n")).toBe(0);
    expect(opticalInset(120, "O")).toBeGreaterThan(0);
    // A quotation mark hangs off the margin entirely, so it is pulled much further.
    expect(opticalInset(120, "“")).toBeGreaterThan(opticalInset(120, "T"));
    expect(opticalInset(120, "T")).toBeGreaterThan(0);
  });
});

describe("type over a picture", () => {
  const toBlack = (colour: string, amount: number) => mix(colour, "#000000", amount);

  it("takes the lightest thing in a ground it knows, not a nominal colour", () => {
    const palette = ["#10203A", "#2BAFE0", "#FFFFFF"];
    // Undimmed, the worst case is the white in the palette — not the navy the duotone starts from.
    expect(worstCaseUnder(palette, 0, toBlack, relativeLuminance).toUpperCase()).toBe("#FFFFFF");
    // Dimmed, it is that white darkened by exactly the scrim.
    expect(worstCaseUnder(palette, 0.5, toBlack, relativeLuminance)).toBe(mix("#FFFFFF", "#000000", 0.5));
  });

  it("sizes the scrim so light type clears 4.5:1 against the lightest the picture can be", () => {
    for (const lightest of ["#FFFFFF", "#2BAFE0", "#F2F2F2", "#10203A"]) {
      const dim = scrimFor(lightest, "#FFFFFF", 4.5, toBlack, contrastRatio, 0);
      const worst = worstCaseUnder([lightest], dim, toBlack, relativeLuminance);
      expect(contrastRatio("#FFFFFF", worst), `${lightest} at dim ${dim}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("darkens no more than it has to", () => {
    // A picture already dark enough needs no scrim at all beyond the floor, and flattening one that
    // did not need it is how a photograph stops being a photograph.
    expect(scrimFor("#10203A", "#FFFFFF", 4.5, toBlack, contrastRatio, 0)).toBe(0);
    // And a white ground needs a great deal, but not all of it.
    const white = scrimFor("#FFFFFF", "#FFFFFF", 4.5, toBlack, contrastRatio, 0);
    expect(white).toBeGreaterThan(0.5);
    expect(white).toBeLessThan(1);
  });

  it("respects a floor, so a brand that wants a moodier scrim keeps it", () => {
    expect(scrimFor("#10203A", "#FFFFFF", 4.5, toBlack, contrastRatio, 0.45)).toBe(0.45);
  });

  it("says so rather than pretending, when no scrim can reach the threshold", () => {
    // At AA this branch is unreachable, and that is worth knowing: for any foreground, either it
    // already clears 4.5:1 on the lightest ground or a fully black one gets it there. It becomes
    // reachable at AAA, where a mid grey fails against both ends — and then the answer is a full
    // scrim and an honest 1, not a number that quietly does not work.
    expect(scrimFor("#FFFFFF", "#949494", 7, toBlack, contrastRatio, 0)).toBe(1);
    // The AA case it is often mistaken for: black type needs no scrim at all.
    expect(scrimFor("#FFFFFF", "#000000", 4.5, toBlack, contrastRatio, 0)).toBe(0);
  });

  it("holds in real composed output: every Cinematic frame's type clears its own scrim", () => {
    const brief: CreativeBrief = {
      ...briefFor({ mode: "CINEMATIC" }),
      frames: [
        { layout: "image_full", headline: "Over a generated ground", surface: "ink", emphasis: "loud" },
        { layout: "image_top", headline: "Beside one", body: "With the words underneath.", surface: "paper", emphasis: "normal" },
        { layout: "cta", headline: "Read on", surface: "accent", emphasis: "normal" },
      ],
    };
    for (const system of DESIGN_SYSTEMS) {
      const spec = composeSpec(brief, tokens, { brandVersion: "v", system, organizationName: "Albert School" });
      const findings = inspect(spec, brief).filter((finding) => finding.code === "contrast");
      expect(findings, system).toEqual([]);
      // And the frame that carries type over the picture really did get a scrim.
      const over = spec.frames.find((frame) => frame.layout === "image_full")!;
      expect(over.image!.dim, system).toBeGreaterThan(0);
    }
  });
});

describe("the checked rules", () => {
  const spec = compose(briefFor());

  it("passes a pack that follows them", () => {
    const findings = inspect(spec, briefFor());
    expect(findings.filter((finding) => finding.severity === "defect")).toEqual([]);
    expect(verdict(findings).ok).toBe(true);
  });

  it("reports a first frame that announces instead of saying", () => {
    expect(isWeakOpener("This month")).toBe(true);
    expect(isWeakOpener("Update:")).toBe(true);
    expect(isWeakOpener("What happened in Marseille")).toBe(true);
    expect(isWeakOpener("Marseille opens its second data lab")).toBe(false);

    const brief: CreativeBrief = { ...briefFor(), frames: briefFor().frames.map((frame, index) => (index === 0 ? { ...frame, headline: "This month at Albert" } : frame)) };
    const codes = inspect(compose(brief), brief).map((finding) => finding.code);
    expect(codes).toContain("weak_opener");
  });

  it("reports two closing frames, because a reader given two next steps takes neither", () => {
    const base = briefFor();
    const brief: CreativeBrief = {
      ...base,
      frames: [base.frames[0], { layout: "cta", headline: "Subscribe", surface: "brand", emphasis: "normal" }, { layout: "cta", headline: "Read on", surface: "accent", emphasis: "normal" }],
    };
    expect(inspect(compose(brief), brief).map((finding) => finding.code)).toContain("two_ctas");
  });

  it("reports a caption whose point is behind the 'more'", () => {
    const buried = `${"a word ".repeat(30)}and here at last is the point.`;
    const brief: CreativeBrief = { ...briefFor(), caption: buried };
    expect(inspect(compose(brief), brief).map((finding) => finding.code)).toContain("caption_buried");

    // The same length, with the point in the visible line, is fine.
    const upfront: CreativeBrief = { ...briefFor(), caption: `Here is the point. ${"and then some more of it ".repeat(12)}` };
    expect(inspect(compose(upfront), upfront).map((finding) => finding.code)).not.toContain("caption_buried");
  });

  it("reports a carousel that runs past where attention falls off", () => {
    const base = briefFor();
    const frames = Array.from({ length: 10 }, (_, index) => ({
      layout: index === 9 ? ("cta" as const) : ("statement" as const),
      headline: `Slide number ${index + 1}`,
      surface: index % 2 ? ("paper" as const) : ("brand" as const),
      emphasis: "normal" as const,
    }));
    const brief: CreativeBrief = { ...base, frames };
    expect(inspect(compose(brief), brief).map((finding) => finding.code)).toContain("long_carousel");
  });

  it("reports a set where no ground holds it", () => {
    const base = briefFor();
    const surfaces = ["brand", "paper", "ink", "accent"] as const;
    const frames = surfaces.map((surface, index) => ({
      layout: index === 3 ? ("cta" as const) : ("statement" as const),
      headline: `A statement on ${surface}`,
      surface,
      emphasis: "normal" as const,
    }));
    const brief: CreativeBrief = { ...base, frames };
    expect(inspect(compose(brief), brief).map((finding) => finding.code)).toContain("no_dominant_surface");
    // And the same four frames with one ground dominating do not trip it.
    expect(inspect(compose(briefFor()), briefFor()).map((finding) => finding.code)).not.toContain("no_dominant_surface");
  });
});

describe("the journalistic rules", () => {
  it("refuses a quoted passage with nobody's name against it", () => {
    const base = briefFor();
    const brief = {
      ...base,
      frames: [
        { layout: "statement", headline: `"We were told the data was too noisy, and it was not"`, surface: "brand", emphasis: "loud" },
        { layout: "heading_body", headline: "What happened", body: "Something happened.", surface: "paper", emphasis: "normal" },
        { layout: "cta", headline: "Read on", surface: "accent", emphasis: "normal" },
      ],
    };
    const result = parseBrief(brief);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/nobody's name against it/);
  });

  it("leaves scare quotes, apostrophes and real quote frames alone", () => {
    const base = briefFor();
    const fine = {
      ...base,
      frames: [
        { layout: "statement", headline: `The so-called "AI winter" is over`, surface: "brand", emphasis: "loud" },
        { layout: "quote", headline: "We were told the data was too noisy and it was not noisy at all", attribution: "Nadia Chevalier", surface: "paper", emphasis: "normal" },
        { layout: "cta", headline: "Read on", surface: "accent", emphasis: "normal" },
      ],
    };
    expect(unattributedQuotations(fine as never)).toEqual([]);
    expect(parseBrief(fine).ok).toBe(true);
  });

  it("passes a figure through exactly as the newsroom wrote it", () => {
    // A number reformatted is a number nobody has checked. The composer sets whatever string it was
    // given and never parses it.
    const base = briefFor();
    for (const written of ["€1.2M", "1 200 000 €", "3×", "18.6%"]) {
      const brief: CreativeBrief = {
        ...base,
        frames: [
          { layout: "figure", headline: "What it came to", figure: written, surface: "ink", emphasis: "loud" },
          { layout: "statement", headline: "And then", surface: "paper", emphasis: "normal" },
          { layout: "cta", headline: "Read on", surface: "accent", emphasis: "normal" },
        ],
      };
      const spec = compose(brief);
      const drawn = spec.frames[0].text.find((text) => text.role === "figure");
      expect(drawn?.content, written).toBe(written);
    }
  });
});

describe("contrast, judged by apparent size", () => {
  const textBlock = (over: Partial<TextBlock>): TextBlock => ({
    role: "display",
    content: "A headline",
    x: 100,
    y: 100,
    width: 800,
    fontSize: 50,
    fontFamily: "inter",
    fontWeight: 400,
    letterSpacing: 0,
    lineHeight: 1.2,
    colour: "#767676",
    transform: "none",
    align: "left",
    lines: 1,
    ...over,
  });

  const frameWith = (text: TextBlock): FrameSpec => ({ index: 0, layout: "statement", width: 1080, height: 1350, background: "#FFFFFF", shapes: [], text: [text], alt: "A frame" });

  const specWith = (frame: FrameSpec): RenderSpec => ({
    format: "CAROUSEL",
    mode: "STUDIO",
    system: "editorial",
    width: 1080,
    height: 1350,
    frames: [frame],
    caption: "A caption.",
    hashtags: [],
    brandVersion: "v",
    fingerprint: "x",
  });

  it("refuses the large-text exemption to type that is small in the hand", () => {
    // #767676 on white is 4.54:1 — fine as body, fine as anything. Its darker sibling is not.
    const dim = textBlock({ colour: "#949494", fontSize: 50 }); // ~3.1:1, 18px in the hand
    const findings = inspect(specWith(frameWith(dim)), null);
    expect(findings.map((finding) => finding.code)).toContain("contrast");

    // The same colour at genuinely large size — over the threshold — takes the exemption.
    const large = textBlock({ colour: "#949494", fontSize: Math.ceil(largeTextThreshold(1080, false)) + 2 });
    expect(inspect(specWith(frameWith(large)), null).map((finding) => finding.code)).not.toContain("contrast");
  });

  it("reports type that is below the floor even when its contrast is perfect", () => {
    const tiny = textBlock({ colour: "#000000", fontSize: 20, role: "label" });
    const findings = inspect(specWith(frameWith(tiny)), null);
    expect(findings.map((finding) => finding.code)).toContain("too_small");
    expect(findings.find((finding) => finding.code === "too_small")?.severity).toBe("defect");
  });

  it("checks against the chip a block sits on, not the surface behind it", () => {
    const onChip = textBlock({ colour: "#FFFFFF", fontSize: 40, x: 120, y: 120, role: "label" });
    const frame: FrameSpec = { ...frameWith(onChip), shapes: [{ kind: "rect", x: 100, y: 100, width: 300, height: 120, radius: 8, colour: "#FFE24A" }] };
    // White on white would pass a naive check against the frame's own background.
    expect(inspect(specWith(frame), null).map((finding) => finding.code)).toContain("contrast");
  });
});

describe("safe areas", () => {
  it("keeps type out of the platform's own interface, in every system", () => {
    for (const system of DESIGN_SYSTEMS) {
      for (const format of CREATIVE_FORMATS) {
        const safe = FORMATS[format].safeArea;
        const spec = composeSpec(localBrief({ format, mode: "STUDIO", organizationName: "Albert School", brand: ALBERT, stories: STORIES }), tokens, {
          brandVersion: "v",
          system,
          organizationName: "Albert School",
        });
        for (const frame of spec.frames) {
          for (const text of frame.text) {
            if (text.layer === "background") continue; // texture may bleed; information may not
            const bottom = text.y + text.lines * text.fontSize * text.lineHeight;
            expect(bottom, `${system}/${format}: "${text.content.slice(0, 24)}"`).toBeLessThanOrEqual(frame.height - safe.bottom + 1);
            expect(text.y, `${system}/${format}: "${text.content.slice(0, 24)}"`).toBeGreaterThanOrEqual(safe.top - 1);
          }
        }
      }
    }
  });
});
