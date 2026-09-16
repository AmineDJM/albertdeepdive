import { describe, expect, it } from "vitest";
import { cleanSubject, replyBody } from "@/server/email/inbound";

describe("reading a reply", () => {
  it("keeps only what the person wrote, not the thread they replied to", () => {
    const text = [
      "Here is what happened at the Lyon sprint.",
      "Two teams presented to a jury from the partner.",
      "",
      "On Mon, 4 May 2026 at 09:12, Albert's Deep Dive <newsroom@albertschool.com> wrote:",
      "> Tell us what happened around you this month.",
      "> Your personal link: https://example.com/contribute/abc",
    ].join("\n");
    expect(replyBody(text)).toBe("Here is what happened at the Lyon sprint.\nTwo teams presented to a jury from the partner.");
  });

  it("handles the French wording Gmail uses", () => {
    const text = "Voici les photos du forum.\n\nLe lun. 4 mai 2026 à 09:12, Albert a écrit :\n> message d'origine";
    expect(replyBody(text)).toBe("Voici les photos du forum.");
  });

  it("stops at a forwarded message", () => {
    const text = "Passing this on.\n\n---------- Forwarded message ----------\nFrom: someone";
    expect(replyBody(text)).toBe("Passing this on.");
  });

  it("returns nothing when the reply is only quoted text", () => {
    expect(replyBody("> nothing of my own\n> just the quote")).toBe("");
  });

  it("normalises whitespace without collapsing paragraphs", () => {
    expect(replyBody("First.\n\n\n\nSecond.")).toBe("First.\n\nSecond.");
  });

  it("drops reply and forward prefixes from the subject, in both languages", () => {
    expect(cleanSubject("Re: Albert's Deep Dive — May")).toBe("Albert's Deep Dive — May");
    expect(cleanSubject("RE: Fwd: Re : Jonquille Run")).toBe("Jonquille Run");
    expect(cleanSubject("TR: Forum des métiers")).toBe("Forum des métiers");
    expect(cleanSubject("A plain subject")).toBe("A plain subject");
  });

  it("never returns an empty subject", () => {
    expect(cleanSubject("Re:")).toBe("Reply to the newsroom");
    expect(cleanSubject("   ")).toBe("Reply to the newsroom");
  });
});
