import type { SpeechLanguage } from "@/lib/speech/language";
import type { Quality, VoiceSettings } from "@/lib/speech/types";

/**
 * A speech provider, from Briefly's side.
 *
 * Everything the narration engine needs from a voice service, and nothing a voice service happens
 * to offer. A provider turns text and a direction into bytes; it may list voices, find voices, add
 * a shared one, clone one with consent, and say what the account has left. The product logic above
 * this line never sees a provider's own vocabulary, which is what makes the provider replaceable:
 * benchmarking a new one is writing this interface for it and flipping a switch in the console.
 */

export type SpeechProviderName = "elevenlabs" | "openai" | "hume" | "fishaudio" | "fake";

export type SynthesisRequest = {
  text: string;
  voiceId: string;
  language: SpeechLanguage;
  quality: Quality;
  settings: VoiceSettings;
  /** The performance in a sentence or two, for providers that take direction as prose. */
  stance?: string | null;
  /** What was said just before and just after, so a passage is performed as part of a whole. */
  previousText?: string | null;
  nextText?: string | null;
  previousRequestIds?: string[];
  seed?: number | null;
  /** Overrides the provider's model for this quality, when a platform admin chose one. */
  model?: string | null;
};

export type SynthesisResult = {
  bytes: Buffer;
  mimeType: string;
  characters: number;
  provider: SpeechProviderName;
  model: string;
  requestId: string | null;
  /** Our cost, in cents, from the provider's published rate. An estimate where the rate is per token. */
  costCents: number;
};

export type ProviderVoice = {
  id: string;
  name: string;
  category: string | null;
  labels: Record<string, string>;
  /** Languages the provider says this voice speaks natively, with the accent where it says so. */
  languages: { language: string; accent: string | null }[];
  previewUrl: string | null;
  description: string | null;
};

export type SharedVoice = ProviderVoice & { publicOwnerId: string; popularity: number; featured: boolean };

export type SharedVoiceQuery = { language: string; gender: "female" | "male"; accent?: string | null; useCase?: string | null; query?: string | null; pageSize?: number };

export type CloneInput = { name: string; description?: string | null; language?: string | null; samples: { bytes: Buffer; fileName: string; mimeType: string }[] };

export type ProviderAccount = { label: string; charactersUsed: number | null; charactersLimit: number | null; canClone: boolean | null };

export interface SpeechProvider {
  readonly name: SpeechProviderName;
  /** Whether it has what it needs right now. Checked per call: keys change in the console. */
  available(): Promise<boolean>;
  modelFor(quality: Quality): string;
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
  listVoices?(): Promise<ProviderVoice[]>;
  searchSharedVoices?(query: SharedVoiceQuery): Promise<SharedVoice[]>;
  addSharedVoice?(voice: SharedVoice, name: string): Promise<{ voiceId: string }>;
  cloneVoice?(input: CloneInput): Promise<{ voiceId: string }>;
  deleteVoice?(voiceId: string): Promise<void>;
  account?(): Promise<ProviderAccount>;
}

/** A provider answered with an error worth showing to a person: the status and what it said. */
export class SpeechProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SpeechProviderError";
  }
}
