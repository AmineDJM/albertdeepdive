import { describe, expect, it } from "vitest";
import { isValidUsername, normaliseUsername, suggestUsername, usernameProblem, USERNAME_MAX } from "@/lib/identity/username";

describe("a person's handle", () => {
  it("is stored as one spelling, whatever was typed", () => {
    expect(normaliseUsername("  @Amine.DJM  ")).toBe("amine.djm");
  });

  it("accepts the handles people actually choose", () => {
    for (const value of ["amine", "amine.djm", "amine-djm", "amine_djm", "a1b2c3", "abc"]) {
      expect(usernameProblem(value), value).toBeNull();
    }
  });

  it("names what is wrong rather than just refusing", () => {
    expect(usernameProblem("ab")).toBe("too-short");
    expect(usernameProblem("a".repeat(USERNAME_MAX + 1))).toBe("too-long");
    expect(usernameProblem("amine djm")).toBe("bad-characters");
    expect(usernameProblem("amine@djm")).toBe("bad-characters");
    expect(usernameProblem("amine/djm")).toBe("bad-characters");
    expect(usernameProblem(".amine")).toBe("bad-edges");
    expect(usernameProblem("amine.")).toBe("bad-edges");
    expect(usernameProblem("amine..djm")).toBe("bad-edges");
  });

  it("keeps the words the product needs for itself", () => {
    for (const value of ["settings", "admin", "briefly", "API", "Platform"]) {
      expect(usernameProblem(value), value).toBe("reserved");
    }
  });

  it("offers a first handle from a name, accents and all", () => {
    expect(suggestUsername("Amine Djouamaï", "amine.djouamaii@gmail.com")).toBe("amine.djouamai");
    expect(suggestUsername("Zoé O'Brien", "zoe@example.com")).toBe("zoe.o.brien");
  });

  it("falls back to the email, then to something usable, rather than to nothing", () => {
    expect(suggestUsername("", "j.doe@example.com")).toBe("j.doe");
    // A name and an address that both reduce to a reserved word still have to produce a handle.
    expect(isValidUsername(suggestUsername("Admin", "admin@example.com"))).toBe(true);
    expect(isValidUsername(suggestUsername("", ""))).toBe(true);
  });

  it("never suggests something it would then refuse", () => {
    for (const name of ["A", "李雷", "...", "Jean--Pierre", "x".repeat(60)]) {
      expect(isValidUsername(suggestUsername(name, "")), name).toBe(true);
    }
  });
});
