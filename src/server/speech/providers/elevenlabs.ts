import type { Quality, VoiceSettings } from "@/lib/speech/types";
import { SpeechProviderError, type CloneInput, type ProviderAccount, type ProviderVoice, type SharedVoice, type SharedVoiceQuery, type SpeechProvider, type SynthesisRequest, type SynthesisResult } from "./types";

/**
 * ElevenLabs, behind the provider interface.
 *
 * v3 for the final performance — the model that takes audio tags and carries a paragraph's arc —
 * and Flash for the preview a person hears while the words are still moving. Both are settings a
 * platform admin can change; neither is named anywhere the customer looks.
 *
 * What is done here and nowhere else: the translation of a direction into this provider's own
 * settings, including the one that bites — v3 accepts three stability values and rejects the rest —
 * and the plain sentence each failure becomes, so a lapsed key or a spent quota reads as what it is.
 */

export const ELEVENLABS_FINAL_MODEL = "eleven_v3";
export const ELEVENLABS_PREVIEW_MODEL = "eleven_flash_v2_5";
/** Published per-character pricing lands near this on the plans a newsroom buys; overridable in the console. */
export const ELEVENLABS_CENTS_PER_1K_CHARS = 30;

export type ElevenLabsConfig = {
  apiKey: string;
  baseUrl?: string | null;
  finalModel?: string | null;
  previewModel?: string | null;
  centsPer1kChars?: number | null;
  fetch?: typeof globalThis.fetch;
};

/** v3 understands three stabilities: creative, natural, robust. Anything else is refused outright. */
export function quantiseStability(value: number): 0 | 0.5 | 1 {
  if (value < 0.25) return 0;
  if (value < 0.75) return 0.5;
  return 1;
}

export function isV3(model: string): boolean {
  return /v3/.test(model);
}

/** Only the newer fast models accept a language code; the rest infer it, and reject the field. */
function acceptsLanguageCode(model: string): boolean {
  return /turbo_v2_5|flash_v2_5/.test(model);
}

/** The provider's settings for a direction, per model family. */
export function elevenLabsSettings(settings: VoiceSettings, model: string): Record<string, unknown> {
  if (isV3(model)) {
    return { stability: quantiseStability(settings.stability), similarity_boost: clamp(settings.similarity), use_speaker_boost: settings.speakerBoost };
  }
  return {
    stability: clamp(settings.stability),
    similarity_boost: clamp(settings.similarity),
    style: clamp(settings.styleExaggeration),
    use_speaker_boost: settings.speakerBoost,
    speed: Math.min(1.2, Math.max(0.7, settings.speed)),
  };
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function fromLabels(labels: Record<string, unknown> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(labels ?? {}).filter(([, value]) => typeof value === "string" && value) as [string, string][]);
}

type RawVoice = {
  voice_id: string;
  name: string;
  category?: string | null;
  labels?: Record<string, unknown> | null;
  description?: string | null;
  preview_url?: string | null;
  verified_languages?: { language?: string; accent?: string | null }[] | null;
};

function toVoice(raw: RawVoice): ProviderVoice {
  const labels = fromLabels(raw.labels);
  const languages = (raw.verified_languages ?? []).filter((entry) => entry.language).map((entry) => ({ language: String(entry.language).toLowerCase(), accent: entry.accent ?? null }));
  if (!languages.length && labels.language) languages.push({ language: labels.language.toLowerCase(), accent: labels.accent ?? null });
  return { id: raw.voice_id, name: raw.name, category: raw.category ?? null, labels, languages, previewUrl: raw.preview_url ?? null, description: raw.description ?? null };
}

export class ElevenLabsProvider implements SpeechProvider {
  readonly name = "elevenlabs" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: ElevenLabsConfig) {
    this.base = (config.baseUrl || "https://api.elevenlabs.io").replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async available() {
    return Boolean(this.config.apiKey);
  }

  modelFor(quality: Quality): string {
    return quality === "FINAL" ? this.config.finalModel?.trim() || ELEVENLABS_FINAL_MODEL : this.config.previewModel?.trim() || ELEVENLABS_PREVIEW_MODEL;
  }

  private headers(extra: Record<string, string> = {}) {
    return { "xi-api-key": this.config.apiKey, accept: "application/json", ...extra };
  }

  private async fail(res: Response, doing: string): Promise<never> {
    const body = await res.text().catch(() => "");
    let detail = "";
    try {
      const parsed = JSON.parse(body) as { detail?: { message?: string; status?: string } | string };
      detail = typeof parsed.detail === "string" ? parsed.detail : (parsed.detail?.message ?? parsed.detail?.status ?? "");
    } catch {
      detail = body.slice(0, 200);
    }
    if (res.status === 401) throw new SpeechProviderError("The voice service rejected the API key.", 401, false);
    if (res.status === 402 || /quota|character_limit|exceeded/i.test(detail)) throw new SpeechProviderError("The voice service's character allowance is used up for this billing period.", 402, false);
    if (res.status === 429) throw new SpeechProviderError("The voice service is busy; trying again shortly.", 429, true);
    throw new SpeechProviderError(`The voice service could not ${doing}${detail ? `: ${detail}` : ` (HTTP ${res.status}).`}`, res.status, res.status >= 500);
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const model = request.model?.trim() || this.modelFor(request.quality);
    const body: Record<string, unknown> = {
      text: request.text,
      model_id: model,
      voice_settings: elevenLabsSettings(request.settings, model),
      apply_text_normalization: "auto",
    };
    if (acceptsLanguageCode(model)) body.language_code = request.language;
    if (request.previousText) body.previous_text = request.previousText.slice(-600);
    if (request.nextText) body.next_text = request.nextText.slice(0, 600);
    if (request.previousRequestIds?.length) body.previous_request_ids = request.previousRequestIds.slice(-3);
    if (typeof request.seed === "number") body.seed = request.seed;

    const res = await this.fetchImpl(`${this.base}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", accept: "audio/mpeg" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) await this.fail(res, "perform this passage");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new SpeechProviderError("The voice service answered with an empty file.", 502, true);
    const characters = request.text.length;
    const rate = this.config.centsPer1kChars ?? ELEVENLABS_CENTS_PER_1K_CHARS;
    return { bytes, mimeType: "audio/mpeg", characters, provider: "elevenlabs", model, requestId: res.headers.get("request-id"), costCents: Math.round((characters / 1000) * rate * 10000) / 10000 };
  }

  async listVoices(): Promise<ProviderVoice[]> {
    const voices: ProviderVoice[] = [];
    let token: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url = new URL(`${this.base}/v2/voices`);
      url.searchParams.set("page_size", "100");
      if (token) url.searchParams.set("next_page_token", token);
      const res = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) await this.fail(res, "list its voices");
      const data = (await res.json()) as { voices?: RawVoice[]; has_more?: boolean; next_page_token?: string | null };
      voices.push(...(data.voices ?? []).map(toVoice));
      if (!data.has_more || !data.next_page_token) break;
      token = data.next_page_token;
    }
    return voices;
  }

  async searchSharedVoices(query: SharedVoiceQuery): Promise<SharedVoice[]> {
    const url = new URL(`${this.base}/v1/shared-voices`);
    url.searchParams.set("page_size", String(query.pageSize ?? 30));
    url.searchParams.set("language", query.language);
    url.searchParams.set("gender", query.gender);
    if (query.accent) url.searchParams.set("accent", query.accent);
    if (query.useCase) url.searchParams.append("use_cases", query.useCase);
    if (query.query) url.searchParams.set("search", query.query);
    const res = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) await this.fail(res, "search the voice library");
    const data = (await res.json()) as { voices?: (RawVoice & { public_owner_id: string; accent?: string | null; gender?: string | null; age?: string | null; language?: string | null; use_case?: string | null; cloned_by_count?: number; usage_character_count_1y?: number; featured?: boolean; free_users_allowed?: boolean })[] };
    return (data.voices ?? [])
      .filter((raw) => raw.free_users_allowed !== false)
      .map((raw) => {
        const voice = toVoice(raw);
        const labels = { ...voice.labels };
        if (raw.accent) labels.accent = raw.accent;
        if (raw.gender) labels.gender = raw.gender;
        if (raw.age) labels.age = raw.age;
        if (raw.use_case) labels.use_case = raw.use_case;
        if (raw.language && !voice.languages.length) voice.languages.push({ language: raw.language.toLowerCase(), accent: raw.accent ?? null });
        return { ...voice, labels, publicOwnerId: raw.public_owner_id, popularity: (raw.cloned_by_count ?? 0) + Math.round((raw.usage_character_count_1y ?? 0) / 100_000), featured: Boolean(raw.featured) };
      });
  }

  async addSharedVoice(voice: SharedVoice, name: string): Promise<{ voiceId: string }> {
    const res = await this.fetchImpl(`${this.base}/v1/voices/add/${encodeURIComponent(voice.publicOwnerId)}/${encodeURIComponent(voice.id)}`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ new_name: name }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) await this.fail(res, "add a voice from the library");
    const data = (await res.json().catch(() => ({}))) as { voice_id?: string };
    return { voiceId: data.voice_id ?? voice.id };
  }

  async cloneVoice(input: CloneInput): Promise<{ voiceId: string }> {
    const form = new FormData();
    form.set("name", input.name);
    if (input.description) form.set("description", input.description.slice(0, 500));
    form.set("remove_background_noise", "true");
    const labels: Record<string, string> = { origin: "briefly-consented-clone" };
    if (input.language) labels.language = input.language;
    form.set("labels", JSON.stringify(labels));
    for (const sample of input.samples) form.append("files", new Blob([new Uint8Array(sample.bytes)], { type: sample.mimeType }), sample.fileName);
    const res = await this.fetchImpl(`${this.base}/v1/voices/add`, { method: "POST", headers: this.headers(), body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) await this.fail(res, "clone the voice");
    const data = (await res.json()) as { voice_id?: string };
    if (!data.voice_id) throw new SpeechProviderError("The voice service did not return a voice id for the clone.", 502, false);
    return { voiceId: data.voice_id };
  }

  async deleteVoice(voiceId: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    if (!res.ok && res.status !== 404) await this.fail(res, "delete the voice");
  }

  async account(): Promise<ProviderAccount> {
    const res = await this.fetchImpl(`${this.base}/v1/user/subscription`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) await this.fail(res, "read the account");
    const data = (await res.json()) as { tier?: string; character_count?: number; character_limit?: number; can_use_instant_voice_cloning?: boolean; status?: string };
    return {
      label: `${data.tier ? `${data.tier} plan` : "connected"}${data.status && data.status !== "active" ? ` (${data.status})` : ""}`,
      charactersUsed: typeof data.character_count === "number" ? data.character_count : null,
      charactersLimit: typeof data.character_limit === "number" ? data.character_limit : null,
      canClone: typeof data.can_use_instant_voice_cloning === "boolean" ? data.can_use_instant_voice_cloning : null,
    };
  }
}
