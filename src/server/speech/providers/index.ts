import type { Quality } from "@/lib/speech/types";
import type { VoiceCatalogue } from "@/lib/speech/voices";
import { integrationConfig } from "@/server/integrations/service";
import { ElevenLabsProvider, ELEVENLABS_CENTS_PER_1K_CHARS } from "./elevenlabs";
import { FishAudioProvider } from "./fishaudio";
import { HumeProvider } from "./hume";
import { OpenAiSpeechProvider } from "./openai";
import type { SpeechProvider, SpeechProviderName } from "./types";

/**
 * Which provider speaks, for each quality.
 *
 * The final performance is ElevenLabs unless a platform admin points it elsewhere; the preview is
 * ElevenLabs' fast model when the key is there and OpenAI's speech model when it is not. Nothing
 * below this file knows which was chosen: the narration job asks for "a provider for FINAL" and
 * gets one, or null and a sentence saying why.
 */

export type SpeechConfig = {
  configured: boolean;
  finalProvider: SpeechProviderName;
  previewProvider: SpeechProviderName;
  finalModel: string | null;
  previewModel: string | null;
  centsPer1kChars: number;
  voiceCatalogue: VoiceCatalogue;
  /** The longest script one narration may be, in characters — the platform's guard against a runaway bill. */
  maxCharacters: number;
  retries: number;
  cloningEnabled: boolean;
};

function parseCatalogue(raw: string | null): VoiceCatalogue {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as VoiceCatalogue;
  } catch {
    return {};
  }
}

const PROVIDER_NAMES: SpeechProviderName[] = ["elevenlabs", "openai", "hume", "fishaudio"];

function providerName(raw: string | null, fallback: SpeechProviderName): SpeechProviderName {
  const value = raw?.trim().toLowerCase() as SpeechProviderName | undefined;
  return value && PROVIDER_NAMES.includes(value) ? value : fallback;
}

export async function speechConfig(): Promise<SpeechConfig> {
  const config = await integrationConfig("elevenlabs");
  const cents = Number(config.centsPer1kChars);
  const maxChars = Number(config.maxCharacters);
  const retries = Number(config.retries);
  return {
    configured: Boolean(config.apiKey),
    finalProvider: providerName(config.finalProvider, "elevenlabs"),
    previewProvider: providerName(config.previewProvider, "elevenlabs"),
    finalModel: config.finalModel?.trim() || null,
    previewModel: config.previewModel?.trim() || null,
    centsPer1kChars: Number.isFinite(cents) && cents > 0 ? cents : ELEVENLABS_CENTS_PER_1K_CHARS,
    voiceCatalogue: parseCatalogue(config.voiceCatalog),
    maxCharacters: Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 60_000,
    retries: Number.isFinite(retries) && retries >= 0 ? Math.min(5, retries) : 2,
    cloningEnabled: /^(true|1|yes|on)$/i.test(config.cloningEnabled ?? ""),
  };
}

let override: SpeechProvider | null = null;

/** A stand-in for tests: every quality gets this provider, and nothing reaches the network. */
export function setSpeechProviderForTests(provider: SpeechProvider | null) {
  override = provider;
}

async function build(name: SpeechProviderName, config: SpeechConfig): Promise<SpeechProvider | null> {
  switch (name) {
    case "elevenlabs": {
      const raw = await integrationConfig("elevenlabs");
      if (!raw.apiKey) return null;
      return new ElevenLabsProvider({ apiKey: raw.apiKey, baseUrl: raw.baseUrl, finalModel: config.finalModel, previewModel: config.previewModel, centsPer1kChars: config.centsPer1kChars });
    }
    case "openai": {
      const raw = await integrationConfig("openai");
      if (!raw.apiKey) return null;
      return new OpenAiSpeechProvider({ apiKey: raw.apiKey, baseUrl: raw.baseUrl });
    }
    case "hume": {
      const raw = await integrationConfig("hume");
      return raw.apiKey ? new HumeProvider({ apiKey: raw.apiKey }) : null;
    }
    case "fishaudio": {
      const raw = await integrationConfig("fishaudio");
      return raw.apiKey ? new FishAudioProvider({ apiKey: raw.apiKey }) : null;
    }
    default:
      return null;
  }
}

/**
 * The provider for a quality, or null.
 *
 * The preview falls back to OpenAI when the chosen preview provider is not connected, because a
 * preview is for hearing the words and any voice will do. The final does not fall back: a customer
 * who paid for the premium voice gets it or is told it is not connected, never a quiet substitute.
 */
export async function getSpeechProvider(quality: Quality): Promise<SpeechProvider | null> {
  if (override) return override;
  const config = await speechConfig();
  const wanted = quality === "FINAL" ? config.finalProvider : config.previewProvider;
  const provider = await build(wanted, config);
  if (provider) return provider;
  if (quality === "PREVIEW" && wanted !== "openai") return build("openai", config);
  return null;
}

export async function speechAvailability(): Promise<{ preview: boolean; final: boolean }> {
  const [preview, final] = await Promise.all([getSpeechProvider("PREVIEW"), getSpeechProvider("FINAL")]);
  return { preview: preview !== null, final: final !== null };
}

export type { SpeechProvider, SpeechProviderName, SynthesisRequest, SynthesisResult } from "./types";
