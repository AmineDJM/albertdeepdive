import { describe, expect, it } from "vitest";
import { internalReturn, withReturn } from "@/lib/http/return-to";

describe("coming back after a detour", () => {
  it("honours only addresses inside Briefly", () => {
    expect(internalReturn("/editions/e1")).toBe("/editions/e1");
    expect(internalReturn("//evil.test/x")).toBeNull();
    expect(internalReturn("https://evil.test")).toBeNull();
    expect(internalReturn("/\\evil.test")).toBeNull();
    expect(internalReturn(null)).toBeNull();
  });

  it("carries where to come back to", () => {
    expect(withReturn("/settings/email", "/editions/e1")).toBe("/settings/email?return=%2Feditions%2Fe1");
    expect(withReturn("/subscribers?x=1", "/editions/e1")).toBe("/subscribers?x=1&return=%2Feditions%2Fe1");
  });
});
