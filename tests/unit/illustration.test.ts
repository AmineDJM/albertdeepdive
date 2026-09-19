import { describe, expect, it } from "vitest";
import { canIllustrate, isPhotograph, whyNotIllustration, whyNotPhotograph } from "@/server/media/constants";

/**
 * What may go on a page, and what may be called a photograph.
 *
 * A logo — 465×128, eleven kilobytes — became the lead picture of an interview and rendered as a
 * broken box, because a logo has no print variant. Nothing had refused it: the library knew what it
 * was, and the page builder's last-resort rule was "any picture linked to this story".
 *
 * Two questions came out of that, not one. A chart of yields belongs on the page of a story about
 * yields, so the page builder asks the looser one. The studio, asked to attach photographs, asks
 * the stricter one — a screenshot offered as a photograph is the same mistake in a smaller hat.
 */
describe("what may go on a page", () => {
  it("takes a photograph", () => {
    expect(canIllustrate({ kind: "photo", rightsStatus: "GREEN", qualityFlags: [] })).toBe(true);
  });

  it("takes a chart, a diagram or a screenshot, because those illustrate things too", () => {
    for (const kind of ["screenshot", "diagram", "chart"]) expect(canIllustrate({ kind }), kind).toBe(true);
  });

  it("never takes a logo, whatever else is true of it", () => {
    expect(canIllustrate({ kind: "logo", rightsStatus: "GREEN", qualityFlags: [] })).toBe(false);
    expect(whyNotIllustration({ kind: "logo" })).toContain("logo");
  });

  it("refuses a picture the rights refuse", () => {
    expect(canIllustrate({ kind: "photo", rightsStatus: "RED" })).toBe(false);
    // Yellow is unresolved rather than refused, and the export gate is where that is decided.
    expect(canIllustrate({ kind: "photo", rightsStatus: "YELLOW" })).toBe(true);
  });

  it("refuses a picture too small or too thin to crop", () => {
    expect(canIllustrate({ kind: "photo", qualityFlags: ["VERY_LOW_RESOLUTION"] })).toBe(false);
    expect(canIllustrate({ kind: "photo", qualityFlags: ["EXTREME_ASPECT_RATIO"] })).toBe(false);
    // A flag that describes a blemish rather than an impossibility still gets on the page.
    expect(canIllustrate({ kind: "photo", qualityFlags: ["LOW_CONTRAST", "NEAR_DUPLICATE"] })).toBe(true);
  });

  it("refuses an archived picture", () => {
    expect(canIllustrate({ kind: "photo", isArchived: true })).toBe(false);
  });

  it("accepts an asset that says nothing about itself, because a missing kind is not a logo", () => {
    expect(canIllustrate({})).toBe(true);
  });
});

describe("what may be attached as a photograph", () => {
  it("takes a photograph", () => {
    expect(isPhotograph({ kind: "photo", rightsStatus: "GREEN" })).toBe(true);
  });

  it("refuses anything else, and names it", () => {
    for (const kind of ["logo", "screenshot", "diagram", "chart", "document"]) {
      expect(isPhotograph({ kind }), kind).toBe(false);
      expect(whyNotPhotograph({ kind })).toContain(kind);
    }
  });

  it("inherits every refusal the page makes", () => {
    expect(isPhotograph({ kind: "photo", rightsStatus: "RED" })).toBe(false);
    expect(isPhotograph({ kind: "photo", isArchived: true })).toBe(false);
    expect(isPhotograph({ kind: "photo", qualityFlags: ["VERY_LOW_RESOLUTION"] })).toBe(false);
  });
});
