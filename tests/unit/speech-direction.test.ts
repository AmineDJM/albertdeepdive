import { describe, expect, it } from "vitest";
import { SPEED_FOR, baseDirection, contextForKind, decorateWithTags, refineDirection, tagBudget, tagsIn } from "@/lib/speech/direction";
import type { SpeechPassage } from "@/lib/speech/types";

const passage = (index: number, text: string, extra: Partial<SpeechPassage> = {}): SpeechPassage => ({ index, speaker: "narrator", text, plain: text, sourceType: "body", chapter: "One", ...extra });

describe("directing a performance", () => {
  it("sets the performance from the context and bends it with the choices", () => {
    const film = baseDirection({ context: "launch_film" });
    expect(film.style).toBe("cinematic");
    expect(film.pace).toBe("slow");
    expect(film.pauses).toBe("deliberate");
    const fast = baseDirection({ context: "newsletter", style: "energetic", pace: "fast" });
    expect(fast.energy).toBe("high");
    expect(fast.settings.speed).toBe(SPEED_FOR.fast);
    expect(baseDirection({ context: "executive", locale: "fr" }).stance).toMatch(/briefing/i);
  });

  it("never speeds a voice up by more than a whisker", () => {
    expect(SPEED_FOR.fast).toBeLessThanOrEqual(1.08);
    expect(SPEED_FOR.slow).toBeGreaterThanOrEqual(0.9);
  });

  it("knows where each kind of narration is heard", () => {
    expect(contextForKind("VIDEO")).toBe("launch_film");
    expect(contextForKind("EXECUTIVE")).toBe("executive");
    expect(contextForKind("EDITION")).toBe("newsletter");
  });

  it("keeps a model's refinements inside the closed lists", () => {
    const base = baseDirection({ context: "community" });
    const refined = refineDirection(base, { stance: "Proud, close, unhurried.", energy: "low", pauses: "deliberate", tags: ["[warmly]", "[shouting]"] });
    expect(refined.stance).toBe("Proud, close, unhurried.");
    expect(refined.tags).toEqual(["[warmly]"]);
    expect(refined.source).toBe("model");
    expect(refineDirection(base, { stance: "" }).stance).toBe(base.stance);
  });

  it("places tags sparingly, at openings and quotations", () => {
    const direction = baseDirection({ context: "newsletter", style: "calm" });
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const passages = decorateWithTags([passage(0, "The finals", { sourceType: "headline" }), passage(1, words), passage(2, "Their words.", { sourceType: "quote" }), passage(3, words, { chapter: "Two" })], direction);
    expect(tagsIn(passages[0].text)).toEqual(["[calmly]"]);
    expect(tagsIn(passages[1].text)).toEqual([]);
    expect(tagsIn(passages[2].text)).toEqual(["[softly]"]);
    expect(tagsIn(passages[3].text)).toEqual(["[calmly]"]);
    expect(passages[1].plain).toBe(words);
  });

  it("uses no tags at all for a minimal performance, and drops tags outside the palette", () => {
    const minimal = baseDirection({ context: "newsletter", style: "minimal" });
    expect(tagBudget(passage(0, "Opening", { sourceType: "headline" }), minimal)).toBe(0);
    expect(decorateWithTags([passage(0, "[excited] Opening", { sourceType: "headline" })], minimal)[0].text).toBe("Opening");
    const calm = baseDirection({ context: "newsletter", style: "calm" });
    expect(decorateWithTags([passage(0, "[excited] Opening", { sourceType: "headline" })], calm)[0].text).toBe("[calmly] Opening");
  });
});
