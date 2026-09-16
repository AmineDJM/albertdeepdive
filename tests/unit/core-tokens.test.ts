import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashToken, signPayload, verifyPayload } from "@/server/auth/tokens";
import { signLocal, verifyLocalSignature } from "@/server/storage/local";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("tokens", () => {
  it("opaque tokens are unique and hash deterministically", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).toHaveLength(64);
  });
  it("signed payloads round-trip and expire", () => {
    const token = signPayload({ requestId: "r1" }, 60);
    expect(verifyPayload<{ requestId: string }>(token)?.requestId).toBe("r1");
    expect(verifyPayload(token + "x")).toBeNull();
    const expired = signPayload({ requestId: "r1" }, -10);
    expect(verifyPayload(expired)).toBeNull();
  });
  it("local storage signatures verify only with the right key and before expiry", () => {
    const exp = Math.floor(Date.now() / 1000) + 100;
    const sig = signLocal("media/a/original.jpg", exp);
    expect(verifyLocalSignature("media/a/original.jpg", exp, sig)).toBe(true);
    expect(verifyLocalSignature("media/b/original.jpg", exp, sig)).toBe(false);
    expect(
      verifyLocalSignature(
        "media/a/original.jpg",
        exp - 200,
        signLocal("media/a/original.jpg", exp - 200),
      ),
    ).toBe(false);
  });
  it("passwords hash with scrypt and verify", async () => {
    const hash = await hashPassword("albert-deep-dive");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("albert-deep-dive", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
});
