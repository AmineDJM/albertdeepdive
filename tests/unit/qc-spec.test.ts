import { describe, expect, it } from "vitest";
import { ALL_METRICS, IMAGE_CROP_LOSS, IMAGE_EFFECTIVE_PPI, IMAGE_ELIGIBLE, PAGE_FIT_RATIO, PRINT_SAFE_MARGIN, QC_SPEC_VERSION, RIGHTS_CLEARED, RIGHTS_RESOLVED, TEXT_OVERFLOW, metricById } from "@/server/qc/spec";
import { DEFAULT_PROFILE, PROFILES, documentSizeMm, effectivePpi, mmToPt, profile, ptToMm } from "@/server/qc/profiles";
import { BLOCKING, HARD_BLOCKING, SEVERITY_ORDER, assertThat, compare, merge, worst } from "@/server/qc/types";
import { articleTeaser, extractFacts } from "@/server/qc/checks/integrity";

/**
 * The arithmetic the whole engine rests on, checked without a database.
 *
 * A quality system whose comparison operator is wrong reports confident nonsense, and the
 * expensive end-to-end case would find that late and expensively. These are the cheap guards: that
 * a threshold is compared in the right direction, that a millimetre is a millimetre, that every
 * rule carries the origin of its number, and that two spellings of €2.4M are one fact.
 */

describe("the rule catalogue", () => {
  it("is versioned, so a verdict can be read back in its own terms", () => {
    expect(QC_SPEC_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });

  it("gives every rule an origin, so nobody mistakes a house preference for a law", () => {
    for (const metric of ALL_METRICS) {
      expect(metric.origin, metric.id).toMatch(/^(INDUSTRY_STANDARD|OUTPUT_PROVIDER_REQUIREMENT|BRIEFLY_HOUSE_STANDARD)$/);
      expect(metric.method.length, `${metric.id} must say how it is measured`).toBeGreaterThan(20);
    }
  });

  it("has no duplicate ids, and can find every rule by id", () => {
    expect(metricById.size).toBe(ALL_METRICS.length);
    for (const metric of ALL_METRICS) expect(metricById.get(metric.id)).toBe(metric);
  });

  it("keeps the rules that measure what this renderer can actually do wrong", () => {
    // Every figure in the print stylesheet is object-fit: cover or contain, so a picture is never
    // stretched — it is cropped. A rule called "aspect distortion" at FAIL measured a defect that
    // cannot occur here and blocked publication on every cover it saw. What it was really
    // computing, all along, was how much of the frame the crop throws away.
    expect(IMAGE_CROP_LOSS.id).toBe("image.crop.loss");
    expect(IMAGE_CROP_LOSS.severity, "a tight crop is a decision an art director is allowed to make").toBe("WARNING");
    expect(IMAGE_CROP_LOSS.failureThreshold, "and therefore not something that blocks anything").toBeUndefined();
    expect(IMAGE_CROP_LOSS.method).toMatch(/cover|crop/i);
  });

  it("blocks refused rights absolutely and merely mentions undecided ones", () => {
    // YELLOW is where every picture in this product starts. A rule that fires on the default state
    // of everything is a rule somebody switches off, and the refused-rights rule goes off with it.
    expect(RIGHTS_CLEARED.severity).toBe("HARD_FAIL");
    expect(RIGHTS_RESOLVED.severity).toBe("WARNING");
    expect(RIGHTS_RESOLVED.failureThreshold).toBeUndefined();
  });

  it("never lets software clear a rights gate by removing the picture", () => {
    // A logo dropped into a photograph's slot is a category error with one right answer, so the
    // engine may unlink it. A photograph whose rights are refused is not: clearing that gate by
    // deleting the thing being measured would turn a block into a green light nobody granted.
    expect(RIGHTS_CLEARED.repair).toBeNull();
    expect(IMAGE_ELIGIBLE.repair).toBe("drop-ineligible-asset");
  });

  it("leaves the rules whose number belongs to the destination without one of their own", () => {
    // Resolution and the safe margin differ by where the thing is going, so the catalogue states
    // the rule and the profile states the number. A literal threshold here would be worse than
    // none: `print.safe.margin` carried `0` with an at-least comparison for a while, which is a
    // rule that passes whatever it measures — the exact shape of a check nobody can rely on.
    expect(IMAGE_EFFECTIVE_PPI.failureThreshold).toBeUndefined();
    expect(PRINT_SAFE_MARGIN.failureThreshold).toBeUndefined();
    for (const metric of [IMAGE_EFFECTIVE_PPI, PRINT_SAFE_MARGIN]) {
      expect(metric.target, `${metric.id} must say where its number comes from`).toBeTruthy();
      expect(metric.method).toMatch(/profile/i);
    }
  });

  it("gives clipped text no tolerance band at all", () => {
    // The rule the user stated in one line: two pixels over is a failure, not a warning.
    expect(TEXT_OVERFLOW.failureThreshold).toBe(0);
    expect(TEXT_OVERFLOW.warningThreshold).toBeUndefined();
    expect(HARD_BLOCKING).toContain(TEXT_OVERFLOW.severity);
  });
});

describe("comparing a measurement with its threshold", () => {
  it("fails above the failure threshold and warns above the warning one", () => {
    const over = compare({ spec: PAGE_FIT_RATIO, actual: 1.02, location: {}, message: "over" });
    expect(over.findings[0].severity).toBe("FAIL");
    expect(over.findings[0].actual).toBe("1.02 ratio");
    expect(over.findings[0].threshold).toBe("1");

    const warn = compare({ spec: PAGE_FIT_RATIO, actual: 0.99, location: {}, message: "close" });
    expect(warn.findings[0].severity).toBe("WARNING");

    const fine = compare({ spec: PAGE_FIT_RATIO, actual: 0.8, location: {}, message: "fine" });
    expect(fine.findings).toEqual([]);
    expect(fine.passed[0].actual).toBe("0.8 ratio");
  });

  it("reverses the comparison when more is better", () => {
    // Resolution: 150 PPI against a 300 floor is a failure, 400 is not.
    const spec = { ...IMAGE_CROP_LOSS, id: "test.ppi", failureThreshold: 300, warningThreshold: 350 };
    expect(compare({ spec, actual: 150, direction: "at-least", location: {}, message: "" }).findings[0].severity).toBe(spec.severity);
    expect(compare({ spec, actual: 320, direction: "at-least", location: {}, message: "" }).findings[0].severity).toBe("WARNING");
    expect(compare({ spec, actual: 400, direction: "at-least", location: {}, message: "" }).findings).toEqual([]);
  });

  it("carries the evidence a person would want three weeks later", () => {
    const result = compare({
      spec: PAGE_FIT_RATIO,
      actual: 1.4,
      location: { page: 7, entityType: "page" },
      message: "page 7 overflows",
      evidence: { template: "ARTICLE_HERO" },
    });
    const finding = result.findings[0];
    expect(finding.expected).toBe("≤ 1 ratio");
    expect(finding.actual).toBe("1.4 ratio");
    expect(finding.unit).toBe("ratio");
    expect(finding.location.page).toBe(7);
    expect(finding.beforeValue).toBe(1.4);
    expect(finding.afterValue).toBeNull();
    expect(finding.repaired).toBe(false);
    expect(finding.evidence).toEqual({ template: "ARTICLE_HERO" });
  });

  it("states a predicate as a predicate rather than inventing a number", () => {
    const failed = assertThat({ spec: TEXT_OVERFLOW, holds: false, location: { page: 3 }, message: "clipped", expected: "0", actual: "2" });
    expect(failed.findings[0].threshold).toBeNull();
    expect(failed.findings[0].severity).toBe("HARD_FAIL");
    expect(assertThat({ spec: TEXT_OVERFLOW, holds: true, location: {}, message: "" }).findings).toEqual([]);
  });

  it("ranks severities so the worst one wins", () => {
    expect(SEVERITY_ORDER.CRITICAL_FAIL).toBeGreaterThan(SEVERITY_ORDER.HARD_FAIL);
    expect(SEVERITY_ORDER.HARD_FAIL).toBeGreaterThan(SEVERITY_ORDER.FAIL);
    expect(worst(["INFO", "FAIL", "WARNING"])).toBe("FAIL");
    expect(worst([])).toBeNull();
    expect(BLOCKING).toEqual(["FAIL", "HARD_FAIL", "CRITICAL_FAIL"]);
  });

  it("merges results without losing either side", () => {
    const merged = merge(compare({ spec: PAGE_FIT_RATIO, actual: 2, location: {}, message: "" }), compare({ spec: PAGE_FIT_RATIO, actual: 0.5, location: {}, message: "" }));
    expect(merged.findings).toHaveLength(1);
    expect(merged.passed).toHaveLength(1);
  });
});

describe("output profiles", () => {
  it("puts the numbers that differ by destination in the destination", () => {
    // The same picture is fine for a screen and too coarse for a press. That is the profile's
    // business, not the rule's.
    expect(PROFILES.PRINT.minimumPpi).toBe(300);
    expect(PROFILES.PDF_SCREEN.minimumPpi).toBe(144);
    expect(PROFILES.PRINT.bleedMm).toBe(3);
    expect(PROFILES.PDF_SCREEN.bleedMm).toBe(0);
    expect(profile(DEFAULT_PROFILE).id).toBe("PDF_SCREEN");
    expect(() => profile("NOPE")).toThrow(/Unknown output profile/);
  });

  it("turns 3mm of bleed on A4 into a 216×303mm document", () => {
    expect(documentSizeMm(PROFILES.PRINT)).toEqual({ width: 216, height: 303 });
    expect(documentSizeMm(PROFILES.PDF_SCREEN)).toEqual({ width: 210, height: 297 });
  });

  it("converts millimetres and points both ways", () => {
    expect(Math.round(mmToPt(210))).toBe(595);
    expect(Math.round(mmToPt(297))).toBe(842);
    expect(Math.round(ptToMm(595))).toBe(210);
  });

  it("measures resolution at the size a picture is printed, not at its own", () => {
    // A 2400px photograph across a full A4 width is 290 PPI; across half of it, 580.
    expect(Math.round(effectivePpi(2400, 210))).toBe(290);
    expect(Math.round(effectivePpi(2400, 105))).toBe(581);
    expect(effectivePpi(2400, 0)).toBe(0);
  });
});

describe("facts, normalised hard enough to compare", () => {
  it("reads the same amount written three ways as one fact", () => {
    const a = extractFacts("raised €2.4M last year");
    const b = extractFacts("raised EUR 2.4 million last year");
    expect(a[0].kind).toBe("money");
    expect(a[0].value).toBe("2400000");
    expect(b[0].value).toBe(a[0].value);
  });

  it("tells €2.4M and €24M apart, which is the whole point", () => {
    expect(extractFacts("€2.4M")[0].value).not.toBe(extractFacts("€24M")[0].value);
    expect(extractFacts("€24M")[0].value).toBe("24000000");
  });

  it("reads percentages and dates in both languages", () => {
    expect(extractFacts("up 12.5% on the year")[0]).toMatchObject({ kind: "percent", value: "12.5" });
    expect(extractFacts("on 12 October")[0]).toMatchObject({ kind: "date", value: "12-10" });
    expect(extractFacts("le 12 octobre")[0]).toMatchObject({ kind: "date", value: "12-10" });
    // 12 October and 21 October are different facts, which is the failure the rule exists for.
    expect(extractFacts("21 October")[0].value).toBe("21-10");
  });

  it("reads one article's teaser and not a word of the next one's", () => {
    // The failure this guards against shipped for an afternoon: a fixed-length window ran past the
    // end of a short teaser into the following item, and every neighbouring date came back as a
    // contradiction. Three false alarms on a correct issue is how a gate stops being read.
    const email = [
      "- School prize list: who can beat us?: A comparison of Albert School with HEC and Harvard.",
      "- 1 km for €1: the Jonquille Run: On 22 March, We Run Albert brought students to the stadium.",
      "- When Albert students compete: A rescue mission for the table football.",
    ].join("\n");
    const teaser = articleTeaser(email, "School prize list: who can beat us?");
    expect(teaser).toContain("Harvard");
    expect(teaser).not.toContain("22 March");
    expect(extractFacts(teaser)).toEqual([]);
    // The last item has no following boundary and still reads to the end.
    expect(articleTeaser(email, "When Albert students compete")).toContain("table football");
    expect(articleTeaser(email, "An article that is not in this email")).toBe("");
  });

  it("stops at the next item however the renderer marks one", () => {
    /*
     * The guard above held for "- " and for nothing else, and "- " is what the plain renderer
     * writes. The designed email — the one an edition is actually sent as — separates items with
     * an asterisk, so no boundary was ever found in it: the window ran through the next two
     * articles, and a date from one of them was reported as this article contradicting itself.
     * A correct issue was held at the last gate before publication over it.
     */
    const designed = [
      "School prize list: who can beat us?",
      "  A modest comparison of Albert School with HEC and Harvard.",
      "*",
      "  Four students founded a digital agency between two courses.",
      "* 1 km for €1: the Jonquille Run",
      "  On 22 March, We Run Albert brought students to the stadium.",
    ].join("\n");
    const teaser = articleTeaser(designed, "School prize list: who can beat us?");
    expect(teaser).toContain("Harvard");
    expect(teaser).not.toContain("22 March");
    expect(extractFacts(teaser)).toEqual([]);
    // And the piece the date does belong to still reads its own line.
    expect(articleTeaser(designed, "1 km for €1: the Jonquille Run")).toContain("22 March");
  });

  it("finds nothing in prose that carries no facts", () => {
    expect(extractFacts("The newsroom met on a Tuesday and talked about the cover.")).toEqual([]);
  });
});
