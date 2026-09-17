import { describe, expect, it } from "vitest";
import { redirectUri, signState, verifyState } from "@/server/email/google-oauth";

describe("Gmail OAuth state", () => {
  it("accepts a state it signed", () => {
    const state = signState("nonce-123");
    expect(verifyState(state)).toBe(true);
  });

  it("rejects a tampered signature, a forged value and nothing", () => {
    const state = signState("nonce-123");
    const [body] = state.split(".");
    expect(verifyState(`${body}.not-the-signature`)).toBe(false);
    expect(verifyState("forged.sig")).toBe(false);
    expect(verifyState("")).toBe(false);
    expect(verifyState(null)).toBe(false);
  });

  it("rejects a state older than its window", () => {
    const state = signState("nonce-123");
    expect(verifyState(state, -1)).toBe(false); // any age exceeds a negative window
  });

  it("builds the callback redirect URI from the app URL", () => {
    expect(redirectUri()).toMatch(/\/api\/settings\/gmail\/callback$/);
  });
});
