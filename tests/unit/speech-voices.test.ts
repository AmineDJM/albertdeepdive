import { describe, expect, it } from "vitest";
import { CURATED_VOICES, accentsFor, chooseVoice, resolveCatalogue } from "@/lib/speech/voices";

describe("the voice catalogue", () => {
  it("offers English out of the box and waits for French to be set up", () => {
    const resolved = resolveCatalogue(null);
    expect(resolved.filter((entry) => entry.voice.language === "en" && entry.providerVoiceId).length).toBeGreaterThan(4);
    expect(resolved.filter((entry) => entry.voice.language === "fr" && entry.providerVoiceId)).toEqual([]);
  });

  it("lets the console map a slot, and the map wins over the default", () => {
    const resolved = resolveCatalogue({ "en-us-premium-female": "voice-x", "fr-premium-female": "voice-fr" });
    expect(resolved.find((entry) => entry.voice.key === "en-us-premium-female")).toMatchObject({ providerVoiceId: "voice-x", source: "mapped" });
    expect(resolved.find((entry) => entry.voice.key === "fr-premium-female")).toMatchObject({ providerVoiceId: "voice-fr", source: "mapped" });
  });

  it("never lends a voice of another language", () => {
    expect(chooseVoice({ language: "fr", accent: "auto", gender: "female", style: "editorial" })).toBeNull();
    const chosen = chooseVoice({ language: "fr", accent: "auto", gender: "female", style: "editorial", catalogue: { "fr-premium-female": "voice-fr" } });
    expect(chosen).toMatchObject({ providerVoiceId: "voice-fr", exact: true });
    expect(chosen?.voice.language).toBe("fr");
  });

  it("matches the accent and the gender, and says when it could not", () => {
    const british = chooseVoice({ language: "en", accent: "british", gender: "male", style: "cinematic" });
    expect(british?.voice.key).toBe("en-gb-premium-male");
    expect(british?.exact).toBe(true);
    const warm = chooseVoice({ language: "en", accent: "us", gender: "female", style: "warm" });
    expect(warm?.voice.key).toBe("en-us-warm-female");
    // An international female voice is not mapped by default, so the nearest is used and marked inexact.
    const intl = chooseVoice({ language: "en", accent: "international", gender: "female", style: "minimal" });
    expect(intl?.exact).toBe(false);
    expect(intl?.voice.gender).toBe("female");
  });

  it("honours the workspace's preferred voice when it speaks the language", () => {
    const chosen = chooseVoice({ language: "en", accent: "us", gender: "auto", style: "editorial", preferredKey: "en-gb-warm-male" });
    expect(chosen?.voice.key).toBe("en-gb-warm-male");
    const other = chooseVoice({ language: "en", accent: "us", gender: "female", style: "editorial", preferredKey: "en-gb-warm-male" });
    expect(other?.voice.gender).toBe("female");
  });

  it("lists the accents a language is offered in", () => {
    expect(accentsFor("fr")).toEqual(["france", "canada"]);
    expect(accentsFor("en")).toEqual(["us", "british", "international"]);
    expect(new Set(CURATED_VOICES.map((voice) => voice.key)).size).toBe(CURATED_VOICES.length);
  });
});
