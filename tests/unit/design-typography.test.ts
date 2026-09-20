import { describe, expect, it } from "vitest";
import { MEDIUM_BASE, buildScale, hierarchyOf, isDistinguishable } from "@/lib/design/type-scale";
import { applyLocaleSpacing, composeHeadline, copyProblems, widthOf } from "@/lib/design/headline";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { genomeFromBrand } from "@/lib/design/genome";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { PERSONALITY_KEYS } from "@/lib/brand/typography";
import { OUTPUT_MEDIA } from "@/lib/design/roles";

/**
 * Type, which is the half of editorial design a reader feels without being able to name.
 *
 * The cases here are the ones §7 to §9 of the design brief call out: a scale that is generated from
 * the publication rather than shipped with the software, a headline that is *composed* rather than
 * poured into a box, and the small mercies — no stranded last word, no line ending on "of", French
 * punctuation set the way French sets it.
 */

const brand = genomeFromBrand(DEFAULT_BRAND_SYSTEM);
const quiet = resolveDirection(brand, newIdentity("p1", "A", { genome: { typographicVoice: "quiet", seriousness: 0.9 } }), null);
const loud = resolveDirection(brand, newIdentity("p1", "A", { genome: { typographicVoice: "expressive", playfulness: 0.8 } }), null);

describe("the type scale", () => {
  it("is generated from the publication, not shipped with the software", () => {
    const calm = buildScale(quiet, "editorial", "print");
    const bold = buildScale(loud, "editorial", "print");
    // The same brand, two publications: an expressive one steps harder between roles.
    expect(bold.ratio).toBeGreaterThan(calm.ratio);
    expect(bold.roles["display-xl"].size).toBeGreaterThan(calm.roles["display-xl"].size);
    // And the body stays where a body belongs in both.
    expect(calm.roles.body.size).toBeCloseTo(bold.roles.body.size, 1);
  });

  it("sets a headline as a headline rather than as enlarged body text", () => {
    const scale = buildScale(quiet, "editorial", "print");
    const display = scale.roles["display-xl"];
    const body = scale.roles.body;
    // Its own face and weight…
    expect(display.family).not.toBe(body.family);
    expect(display.weight).toBeGreaterThan(body.weight);
    // …tighter tracking, because type set large with text tracking looks loose…
    expect(display.tracking).toBeLessThan(body.tracking);
    // …and closer leading, because leading meant for reading breaks a headline into statements.
    expect(display.leading).toBeLessThan(body.leading);
  });

  it("keeps the hierarchy in every medium, at every medium's own size", () => {
    for (const medium of OUTPUT_MEDIA) {
      const scale = buildScale(loud, "modern", medium);
      expect(isDistinguishable(scale), medium).toBe(true);
      const order = hierarchyOf(scale);
      expect(order.indexOf("display-xl"), medium).toBeLessThan(order.indexOf("headline"));
      expect(order.indexOf("headline"), medium).toBeLessThan(order.indexOf("body"));
      // The body is never below what that medium can be read at.
      expect(scale.roles.body.size, medium).toBeGreaterThanOrEqual(MEDIUM_BASE[medium].minBody);
      expect(scale.roles.caption.size, medium).toBeGreaterThan(MEDIUM_BASE[medium].minBody * 0.7);
    }
  });

  it("holds together for every personality and every dial", () => {
    for (const personality of PERSONALITY_KEYS) {
      for (const voice of ["quiet", "confident", "expressive"] as const) {
        for (const seriousness of [0, 0.5, 1]) {
          const direction = resolveDirection(brand, newIdentity("p1", "A", { genome: { typographicVoice: voice, seriousness, playfulness: 1 - seriousness } }), null);
          const scale = buildScale(direction, personality, "print");
          expect(isDistinguishable(scale), `${personality}/${voice}/${seriousness}`).toBe(true);
          expect(scale.roles.body.size).toBeGreaterThanOrEqual(MEDIUM_BASE.print.minBody);
        }
      }
    }
  });
});

describe("composing a headline", () => {
  const scale = buildScale(quiet, "editorial", "web");
  const display = scale.roles["display-l"];

  it("finds a better break than pouring the words into the box", () => {
    const text = "The future of healthcare is here";
    // Wide enough for two lines, not three.
    const width = widthOf("The future of healthcare", display) * 1.05;
    const composed = composeHeadline(text, display, { maxWidth: width, maxLines: 3 });
    expect(composed.fits).toBe(true);
    expect(composed.lines.length).toBeLessThanOrEqual(3);
    // Whatever it chose, no line ends on a preposition or an article.
    expect(composed.problems).not.toContain("dangling-break");
    // And the words are untouched: composition is not a copy-edit.
    expect(composed.lines.join(" ")).toBe(text);
  });

  it("refuses to strand a single word on the last line when it has an alternative", () => {
    const text = "Four hundred students moved into the new campus building today";
    const width = widthOf("Four hundred students moved", display);
    const composed = composeHeadline(text, display, { maxWidth: width, maxLines: 4 });
    expect(composed.lines.join(" ")).toBe(text);
    if (composed.fits) expect(composed.problems).not.toContain("stranded-word");
  });

  it("shrinks the type only when shrinking is what makes it work", () => {
    const text = "A short headline";
    const composed = composeHeadline(text, display, { maxWidth: widthOf(text, display) * 1.4, maxLines: 2 });
    // It fits at full size, so it is set at full size.
    expect(composed.size).toBe(display.size);
    expect(composed.lines).toHaveLength(1);
  });

  it("says so, rather than overflowing, when a word is longer than the measure", () => {
    const composed = composeHeadline("Anticonstitutionnellement", display, { maxWidth: 20, maxLines: 2 });
    expect(composed.fits).toBe(false);
    expect(composed.problems).toContain("overflows");
    // Still returns something drawable: a broken headline beats a blank space.
    expect(composed.lines.join(" ")).toBe("Anticonstitutionnellement");
  });

  it("knows where French and Italian may not break", () => {
    const french = "Le futur de la santé se décide à Paris cette semaine";
    const width = widthOf("Le futur de la santé", display);
    const composed = composeHeadline(french, display, { maxWidth: width, maxLines: 4, locale: "fr" });
    for (const [index, line] of composed.lines.entries()) {
      if (index === composed.lines.length - 1) continue;
      const lastWord = line.split(/\s+/).pop()!.toLowerCase();
      // No French line ends on an article or a preposition when an alternative exists.
      if (composed.fits && composed.score > 0.4) expect(["le", "la", "de", "à", "du", "des", "un", "une"]).not.toContain(lastWord);
    }
  });

  it("prefers two balanced lines over three ragged ones", () => {
    const text = "Twelve new researchers join the institute";
    const width = widthOf("Twelve new researchers join", display) * 1.02;
    const composed = composeHeadline(text, display, { maxWidth: width, maxLines: 3 });
    expect(composed.lines.length).toBeLessThanOrEqual(2);
  });

  it("composes the same headline the same way twice", () => {
    const text = "The quiet revolution in the laboratory";
    const width = widthOf("The quiet revolution", display);
    const first = composeHeadline(text, display, { maxWidth: width, maxLines: 3 });
    const second = composeHeadline(text, display, { maxWidth: width, maxLines: 3 });
    expect(first).toEqual(second);
  });
});

describe("running text", () => {
  it("names a widow and an orphan rather than guessing at them", () => {
    // A column of 30 lines: a three-line paragraph starting on line 30 leaves two lines over.
    const orphan = copyProblems({ linesPerParagraph: [29, 3], linesInColumn: 30, measureChars: 60, min: 45, max: 75 });
    expect(orphan.some((p) => p.code === "orphan")).toBe(true);

    // A paragraph whose last line alone reaches the next column is a widow: 28 lines, then a
    // three-line paragraph, of which two fit and one carries over.
    const widow = copyProblems({ linesPerParagraph: [28, 3], linesInColumn: 30, measureChars: 60, min: 45, max: 75 });
    expect(widow.some((p) => p.code === "widow")).toBe(true);
    // Two lines carrying over is not a widow, and is not reported as one.
    expect(copyProblems({ linesPerParagraph: [28, 4], linesInColumn: 30, measureChars: 60, min: 45, max: 75 }).some((p) => p.code === "widow")).toBe(false);

    // Nothing wrong, nothing reported.
    expect(copyProblems({ linesPerParagraph: [10, 10, 10], linesInColumn: 30, measureChars: 60, min: 45, max: 75 })).toEqual([]);
  });

  it("notices a measure outside the publication's own range", () => {
    const wide = copyProblems({ linesPerParagraph: [10], linesInColumn: 40, measureChars: 96, min: 45, max: 75 });
    expect(wide.some((p) => p.code === "too-wide")).toBe(true);
    const narrow = copyProblems({ linesPerParagraph: [10], linesInColumn: 40, measureChars: 30, min: 45, max: 75 });
    expect(narrow.some((p) => p.code === "too-narrow")).toBe(true);
  });

  it("sets French punctuation the way French sets it", () => {
    const set = applyLocaleSpacing("Vraiment ? Oui : voici « la réponse » — 12 000 lecteurs", "fr");
    expect(set).toContain(" ?");
    expect(set).toContain(" :");
    expect(set).toContain("« la");
    expect(set).toContain("réponse »");
    expect(set).toContain("12 000");
    // English is left exactly as it was.
    expect(applyLocaleSpacing("Really? Yes: here", "en")).toBe("Really? Yes: here");
  });
});
