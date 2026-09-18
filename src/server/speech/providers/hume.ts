import { SpeechProviderError, type SpeechProvider, type SynthesisRequest, type SynthesisResult } from "./types";

/**
 * Hume's Octave, as a candidate for benchmarking.
 *
 * Present so a platform admin can point the final or preview tier at it and compare, on the same
 * scripts and the same direction, without any product code changing. It takes direction as prose
 * — the stance is its `description` — and returns base64 audio. Exercised only through the
 * interface above; it has not been run against a live account from this codebase, and says so.
 */
export const HUME_CENTS_PER_1K_CHARS = 20;

export class HumeProvider implements SpeechProvider {
  readonly name = "hume" as const;
  private readonly fetchImpl: typeof globalThis.fetch;
  constructor(private readonly config: { apiKey: string; fetch?: typeof globalThis.fetch }) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }
  async available() {
    return Boolean(this.config.apiKey);
  }
  modelFor() {
    return "octave";
  }
  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const res = await this.fetchImpl("https://api.hume.ai/v0/tts", {
      method: "POST",
      headers: { "X-Hume-Api-Key": this.config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        utterances: [{ text: request.text, description: request.stance ?? undefined, voice: request.voiceId ? { id: request.voiceId } : undefined, speed: request.settings.speed }],
        format: { type: "mp3" },
        num_generations: 1,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new SpeechProviderError(`Hume answered ${res.status}.`, res.status, res.status === 429 || res.status >= 500);
    const data = (await res.json()) as { generations?: { audio?: string }[] };
    const audio = data.generations?.[0]?.audio;
    if (!audio) throw new SpeechProviderError("Hume returned no audio.", 502, true);
    const characters = request.text.length;
    return { bytes: Buffer.from(audio, "base64"), mimeType: "audio/mpeg", characters, provider: "hume", model: "octave", requestId: null, costCents: Math.round((characters / 1000) * HUME_CENTS_PER_1K_CHARS * 10000) / 10000 };
  }
}
