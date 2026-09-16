import { describe, expect, it } from "vitest";
import { maskSecret, open, seal } from "@/server/settings/secrets";

describe("storing a secret an operator typed in", () => {
  it("round-trips the value", () => {
    const secret = "abcd efgh ijkl mnop";
    expect(open(seal(secret))).toBe(secret);
  });

  it("never stores the plain text, and never repeats a ciphertext", () => {
    const secret = "abcd efgh ijkl mnop";
    const a = seal(secret);
    const b = seal(secret);
    expect(JSON.stringify(a)).not.toContain(secret);
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
    expect(open(a)).toBe(open(b));
  });

  it("refuses a tampered value rather than returning rubbish", () => {
    const sealed = seal("app-password");
    expect(open({ ...sealed, data: Buffer.from("tampered").toString("base64") })).toBeNull();
    expect(open({ ...sealed, tag: Buffer.alloc(16).toString("base64") })).toBeNull();
  });

  it("treats a missing or unknown-version value as not configured", () => {
    expect(open(null)).toBeNull();
    expect(open(undefined)).toBeNull();
    expect(open({ ...seal("x"), v: 2 as 1 })).toBeNull();
  });

  it("shows enough of a secret to recognise it and never enough to use it", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("••••••••••••mnop");
    expect(maskSecret("abcd")).toBe("••••");
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret("abcdefghijklmnop")).not.toContain("abcd");
  });
});
