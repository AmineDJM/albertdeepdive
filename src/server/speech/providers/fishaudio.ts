import { SpeechProviderError, type SpeechProvider, type SynthesisRequest, type SynthesisResult } from "./types";

/**
 * Fish Audio, as a candidate for benchmarking.
 *
 * Same standing as Hume: reachable through the interface so it can be compared, not yet run against
 * a live account from here. The voice id is a reference model on their side.
 */
export const FISH_CENTS_PER_1K_CHARS = 15;

export class FishAudioProvider implements SpeechProvider {
  readonly name = "fishaudio" as const;
  private readonly fetchImpl: typeof globalThis.fetch;
  constructor(private readonly config: { apiKey: string; fetch?: typeof globalThis.fetch }) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }
  async available() {
    return Boolean(this.config.apiKey);
  }
  modelFor() {
    return "speech-1.5";
  }
  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const res = await this.fetchImpl("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json", model: this.modelFor() },
      body: JSON.stringify({ text: request.text, reference_id: request.voiceId || undefined, format: "mp3", latency: "normal" }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new SpeechProviderError(`Fish Audio answered ${res.status}.`, res.status, res.status === 429 || res.status >= 500);
    const bytes = Buffer.from(await res.arrayBuffer());
    const characters = request.text.length;
    return { bytes, mimeType: "audio/mpeg", characters, provider: "fishaudio", model: this.modelFor(), requestId: null, costCents: Math.round((characters / 1000) * FISH_CENTS_PER_1K_CHARS * 10000) / 10000 };
  }
}
