import type { Quality } from "@/lib/speech/types";
import { SpeechProviderError, type SpeechProvider, type SynthesisRequest, type SynthesisResult } from "./types";

/**
 * OpenAI's speech model, as the fallback and the cheap preview.
 *
 * Useful for hearing a draft, and for a platform that has not connected a premium voice yet. Its
 * voices are not native to any language but English, so it is never the final performance of a
 * French edition when a French voice exists — the catalogue decides voices, and this provider is
 * handed a voice name for the gender and character the catalogue chose.
 *
 * Direction goes in as prose, which is what this model takes: the stance the director wrote is the
 * `instructions` field, verbatim.
 */

export const OPENAI_SPEECH_MODEL = "gpt-4o-mini-tts";
/** Published per-token rates land near this per thousand characters of narration; an estimate, marked as such in the ledger. */
export const OPENAI_CENTS_PER_1K_CHARS = 1.7;

export type OpenAiSpeechConfig = { apiKey: string; baseUrl?: string | null; model?: string | null; fetch?: typeof globalThis.fetch };

/** Our catalogue's slot → the closest of this provider's fixed voices. */
export function openAiVoiceFor(voiceKey: string | null | undefined, gender: "female" | "male" | "auto"): string {
  const key = voiceKey ?? "";
  if (/warm/.test(key)) return gender === "male" ? "echo" : "shimmer";
  if (/neutral|minimal/.test(key)) return gender === "male" ? "ash" : "sage";
  return gender === "male" ? "onyx" : "nova";
}

export class OpenAiSpeechProvider implements SpeechProvider {
  readonly name = "openai" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: OpenAiSpeechConfig) {
    this.base = (config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async available() {
    return Boolean(this.config.apiKey);
  }

  modelFor(): string {
    return this.config.model?.trim() || OPENAI_SPEECH_MODEL;
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const model = request.model?.trim() || this.modelFor();
    const res = await this.fetchImpl(`${this.base}/audio/speech`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input: request.text,
        voice: request.voiceId,
        instructions: request.stance ?? undefined,
        response_format: "mp3",
        speed: Math.min(1.2, Math.max(0.8, request.settings.speed)),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (res.status === 401) throw new SpeechProviderError("The speech fallback rejected the API key.", 401, false);
      if (res.status === 429) throw new SpeechProviderError("The speech fallback is busy; trying again shortly.", 429, true);
      throw new SpeechProviderError(body.error?.message ?? `The speech fallback answered ${res.status}.`, res.status, res.status >= 500);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const characters = request.text.length;
    return { bytes, mimeType: "audio/mpeg", characters, provider: "openai", model, requestId: res.headers.get("x-request-id"), costCents: Math.round((characters / 1000) * OPENAI_CENTS_PER_1K_CHARS * 10000) / 10000 };
  }

  /** The preview tier: this provider has one model, so both qualities are the same performance. */
  static qualityNote(quality: Quality): string {
    return quality === "FINAL" ? "final, through the fallback voice" : "preview";
  }
}
