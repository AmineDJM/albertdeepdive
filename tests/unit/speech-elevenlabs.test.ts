import { describe, expect, it } from "vitest";
import { ELEVENLABS_FINAL_MODEL, ELEVENLABS_PREVIEW_MODEL, ElevenLabsProvider, elevenLabsSettings, quantiseStability } from "@/server/speech/providers/elevenlabs";
import { SpeechProviderError } from "@/server/speech/providers/types";
import { openAiVoiceFor } from "@/server/speech/providers/openai";
import type { VoiceSettings } from "@/lib/speech/types";

const settings: VoiceSettings = { stability: 0.6, similarity: 0.8, styleExaggeration: 0.2, speakerBoost: true, speed: 1.06 };

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

describe("speaking to ElevenLabs", () => {
  it("gives v3 only the three stabilities it accepts, and the others the full set", () => {
    expect([quantiseStability(0.1), quantiseStability(0.6), quantiseStability(0.9)]).toEqual([0, 0.5, 1]);
    expect(elevenLabsSettings(settings, "eleven_v3")).toEqual({ stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true });
    expect(elevenLabsSettings(settings, "eleven_flash_v2_5")).toMatchObject({ stability: 0.6, style: 0.2, speed: 1.06 });
  });

  it("performs a passage with its neighbours for context", async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "request-id": "req_1" } }));
    const provider = new ElevenLabsProvider({ apiKey: "sk_test", fetch: fetchImpl, centsPer1kChars: 30 });
    const result = await provider.synthesize({ text: "Hello, world.", voiceId: "voice-1", language: "en", quality: "FINAL", settings, previousText: "Before.", nextText: "After." });
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128");
    expect((calls[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("sk_test");
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.model_id).toBe(ELEVENLABS_FINAL_MODEL);
    expect(body.previous_text).toBe("Before.");
    expect(body.next_text).toBe("After.");
    expect(body.language_code).toBeUndefined();
    expect(result).toMatchObject({ characters: 13, model: ELEVENLABS_FINAL_MODEL, requestId: "req_1", provider: "elevenlabs" });
    expect(result.costCents).toBeCloseTo(0.39, 3);
  });

  it("tells the fast model the language, and the preview uses it", async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response(new Uint8Array([1]), { status: 200 }));
    const provider = new ElevenLabsProvider({ apiKey: "sk_test", fetch: fetchImpl });
    await provider.synthesize({ text: "Bonjour.", voiceId: "voice-fr", language: "fr", quality: "PREVIEW", settings });
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.model_id).toBe(ELEVENLABS_PREVIEW_MODEL);
    expect(body.language_code).toBe("fr");
  });

  it("turns the provider's failures into sentences, and knows which to retry", async () => {
    const answers = [401, 429, 422];
    let index = 0;
    const { fetchImpl } = fakeFetch(() => new Response(JSON.stringify({ detail: { message: index === 2 ? "quota_exceeded" : "no" } }), { status: answers[index++] }));
    const provider = new ElevenLabsProvider({ apiKey: "bad", fetch: fetchImpl });
    const request = { text: "x", voiceId: "v", language: "en" as const, quality: "FINAL" as const, settings };
    await expect(provider.synthesize(request)).rejects.toMatchObject({ status: 401, retryable: false, message: /rejected the API key/ });
    await expect(provider.synthesize(request)).rejects.toMatchObject({ status: 429, retryable: true });
    const error = await provider.synthesize(request).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SpeechProviderError);
    expect((error as SpeechProviderError).message).toMatch(/allowance is used up/);
  });

  it("reads the account's voices, searches the library and adds a shared voice", async () => {
    const { calls, fetchImpl } = fakeFetch((call) => {
      if (call.url.includes("/v2/voices")) return Response.json({ voices: [{ voice_id: "a", name: "Aria", category: "premade", labels: { accent: "american", gender: "female", language: "en" }, verified_languages: [{ language: "en", accent: "american" }] }], has_more: false });
      if (call.url.includes("/v1/shared-voices")) return Response.json({ voices: [{ public_owner_id: "own", voice_id: "sv", name: "Camille", accent: "standard", gender: "female", language: "fr", cloned_by_count: 120, featured: true, free_users_allowed: true, verified_languages: [{ language: "fr", accent: "standard" }] }, { public_owner_id: "own", voice_id: "paid", name: "Paid", language: "fr", free_users_allowed: false }] });
      if (call.url.includes("/v1/voices/add/own/sv")) return Response.json({ voice_id: "mine" });
      if (call.url.includes("/v1/user/subscription")) return Response.json({ tier: "creator", character_count: 1200, character_limit: 100000, can_use_instant_voice_cloning: true });
      return new Response("nope", { status: 404 });
    });
    const provider = new ElevenLabsProvider({ apiKey: "sk_test", fetch: fetchImpl });
    const voices = await provider.listVoices();
    expect(voices).toEqual([{ id: "a", name: "Aria", category: "premade", labels: { accent: "american", gender: "female", language: "en" }, languages: [{ language: "en", accent: "american" }], previewUrl: null, description: null }]);
    const shared = await provider.searchSharedVoices({ language: "fr", gender: "female", accent: "standard", useCase: "narration" });
    expect(shared.map((voice) => voice.id)).toEqual(["sv"]);
    expect(shared[0]).toMatchObject({ publicOwnerId: "own", featured: true, popularity: 120 });
    const url = new URL(calls[1].url);
    expect(url.searchParams.get("language")).toBe("fr");
    expect(url.searchParams.get("gender")).toBe("female");
    expect(url.searchParams.get("use_cases")).toBe("narration");
    expect(await provider.addSharedVoice(shared[0], "Camille · Briefly")).toEqual({ voiceId: "mine" });
    expect(await provider.account()).toEqual({ label: "creator plan", charactersUsed: 1200, charactersLimit: 100000, canClone: true });
  });

  it("maps a curated slot onto the fallback provider's fixed voices", () => {
    expect(openAiVoiceFor("en-us-premium-male", "male")).toBe("onyx");
    expect(openAiVoiceFor("fr-warm-female", "female")).toBe("shimmer");
    expect(openAiVoiceFor("en-intl-neutral-female", "female")).toBe("sage");
    expect(openAiVoiceFor(null, "auto")).toBe("nova");
  });
});
