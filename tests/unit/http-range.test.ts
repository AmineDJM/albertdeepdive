import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/http/range";

/**
 * What a video player asks for, and what it must get back.
 *
 * Without this a Reel cannot be scrubbed: the browser asks for a range in the middle, gets the whole
 * file from byte zero, and the scrubber does nothing. The parsing is small and the failure is silent,
 * which is exactly the combination that stays broken.
 */
describe("byte ranges", () => {
  it("reads the opening request a player always sends first", () => {
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("reads a seek into the middle", () => {
    expect(parseRange("bytes=500-700", 1000)).toEqual({ start: 500, end: 700 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("reads a suffix range as the LAST n bytes, not the first", () => {
    // `bytes=-500` means the final 500 bytes. Reading it as "up to 500" serves the wrong part of the
    // file and the player shows nothing, with no error anywhere.
    expect(parseRange("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("clamps an end past the file rather than refusing it", () => {
    expect(parseRange("bytes=900-99999", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("calls a start past the end unsatisfiable, which is a 416", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=800-200", 1000)).toBe("unsatisfiable");
  });

  it("falls back to the whole file for anything it does not understand", () => {
    // Always a correct answer, so an odd header degrades to a slow load rather than a broken one.
    for (const header of ["", "bytes=", "items=0-10", "bytes=0-10, 20-30", "nonsense"]) {
      expect(parseRange(header, 1000), header).toBeNull();
    }
    expect(parseRange("bytes=0-", 0)).toBeNull();
  });

  it("tolerates whitespace, which some clients send", () => {
    expect(parseRange("  bytes=0-99  ", 1000)).toEqual({ start: 0, end: 99 });
  });
});
