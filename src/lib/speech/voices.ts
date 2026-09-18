import type { Accent, Style } from "./types";
import type { SpeechLanguage } from "./language";

/**
 * The voices Briefly offers, by name rather than by id.
 *
 * A customer chooses "Female · French · Warm" and never sees a provider's identifier. Each slot here
 * is a stable key the console maps to whichever voice the provider account holds for it; the map is
 * configuration, filled by "Set up voices" and editable by a platform admin, so a better French
 * voice appearing in the library is a change of mapping, not a deploy.
 *
 * The rule the catalogue enforces: a language is spoken by a voice native to it. There is no path by
 * which a French text reaches an American voice asked to "speak French" — if no French voice is
 * mapped yet, the narration says so and stops, which is the honest answer.
 */

export type VoiceCharacter = "premium" | "warm" | "neutral";

export type CuratedVoice = {
  key: string;
  language: SpeechLanguage;
  accent: Exclude<Accent, "auto">;
  gender: "female" | "male";
  character: VoiceCharacter;
  /** What the person sees, per interface language. */
  label: { en: string; fr: string };
  /** The styles this voice carries best; any style still works. */
  bestFor: Style[];
  /** A provider voice known to fit this slot on a fresh account, when there is one. Verified by setup, never trusted blind. */
  defaultProviderVoiceId: string | null;
  /** What "Set up voices" searches for when the slot is unmapped: the provider's own labels. */
  search: { gender: "female" | "male"; language: string; accent?: string; useCase?: string; query?: string };
};

/**
 * English defaults name voices from the provider's standard set, which every account has. French
 * has no standard set, so those slots start empty and are filled from the shared library by setup.
 */
export const CURATED_VOICES: CuratedVoice[] = [
  { key: "fr-premium-female", language: "fr", accent: "france", gender: "female", character: "premium", label: { en: "Premium · Female · France", fr: "Premium · Femme · France" }, bestFor: ["editorial", "professional", "cinematic", "confident"], defaultProviderVoiceId: null, search: { gender: "female", language: "fr", accent: "standard", useCase: "narration" } },
  { key: "fr-premium-male", language: "fr", accent: "france", gender: "male", character: "premium", label: { en: "Premium · Male · France", fr: "Premium · Homme · France" }, bestFor: ["editorial", "professional", "cinematic", "confident"], defaultProviderVoiceId: null, search: { gender: "male", language: "fr", accent: "standard", useCase: "narration" } },
  { key: "fr-warm-female", language: "fr", accent: "france", gender: "female", character: "warm", label: { en: "Warm · Female · France", fr: "Chaleureuse · Femme · France" }, bestFor: ["warm", "calm", "minimal"], defaultProviderVoiceId: null, search: { gender: "female", language: "fr", accent: "standard", useCase: "conversational" } },
  { key: "fr-warm-male", language: "fr", accent: "france", gender: "male", character: "warm", label: { en: "Warm · Male · France", fr: "Chaleureux · Homme · France" }, bestFor: ["warm", "calm", "minimal"], defaultProviderVoiceId: null, search: { gender: "male", language: "fr", accent: "standard", useCase: "conversational" } },
  { key: "fr-ca-female", language: "fr", accent: "canada", gender: "female", character: "premium", label: { en: "Premium · Female · Canada", fr: "Premium · Femme · Canada" }, bestFor: ["editorial", "warm"], defaultProviderVoiceId: null, search: { gender: "female", language: "fr", accent: "canadian", useCase: "narration" } },
  { key: "fr-ca-male", language: "fr", accent: "canada", gender: "male", character: "premium", label: { en: "Premium · Male · Canada", fr: "Premium · Homme · Canada" }, bestFor: ["editorial", "warm"], defaultProviderVoiceId: null, search: { gender: "male", language: "fr", accent: "canadian", useCase: "narration" } },

  { key: "en-us-premium-female", language: "en", accent: "us", gender: "female", character: "premium", label: { en: "Premium · Female · US", fr: "Premium · Femme · États-Unis" }, bestFor: ["editorial", "professional", "confident", "energetic"], defaultProviderVoiceId: "EXAVITQu4vr4xnSDxMaL", search: { gender: "female", language: "en", accent: "american", useCase: "narration" } },
  { key: "en-us-premium-male", language: "en", accent: "us", gender: "male", character: "premium", label: { en: "Premium · Male · US", fr: "Premium · Homme · États-Unis" }, bestFor: ["editorial", "professional", "confident", "cinematic"], defaultProviderVoiceId: "CwhRBWXzGAHq8TQ4Fs17", search: { gender: "male", language: "en", accent: "american", useCase: "narration" } },
  { key: "en-us-warm-female", language: "en", accent: "us", gender: "female", character: "warm", label: { en: "Warm · Female · US", fr: "Chaleureuse · Femme · États-Unis" }, bestFor: ["warm", "calm", "minimal"], defaultProviderVoiceId: "XrExE9yKIg1WjnnlVkGX", search: { gender: "female", language: "en", accent: "american", useCase: "conversational" } },
  { key: "en-us-warm-male", language: "en", accent: "us", gender: "male", character: "warm", label: { en: "Warm · Male · US", fr: "Chaleureux · Homme · États-Unis" }, bestFor: ["warm", "calm", "minimal"], defaultProviderVoiceId: "nPczCjzI2devNBz1zQrb", search: { gender: "male", language: "en", accent: "american", useCase: "conversational" } },
  { key: "en-gb-premium-female", language: "en", accent: "british", gender: "female", character: "premium", label: { en: "Premium · Female · British", fr: "Premium · Femme · Britannique" }, bestFor: ["editorial", "professional", "confident"], defaultProviderVoiceId: "Xb7hH8MSUJpSbSDYk0k2", search: { gender: "female", language: "en", accent: "british", useCase: "narration" } },
  { key: "en-gb-premium-male", language: "en", accent: "british", gender: "male", character: "premium", label: { en: "Premium · Male · British", fr: "Premium · Homme · Britannique" }, bestFor: ["editorial", "professional", "cinematic", "confident"], defaultProviderVoiceId: "onwK4e9ZLuTAKqWW03F9", search: { gender: "male", language: "en", accent: "british", useCase: "narration" } },
  { key: "en-gb-warm-female", language: "en", accent: "british", gender: "female", character: "warm", label: { en: "Warm · Female · British", fr: "Chaleureuse · Femme · Britannique" }, bestFor: ["warm", "calm"], defaultProviderVoiceId: "pFZP5JQG7iQjIQuC4Bku", search: { gender: "female", language: "en", accent: "british", useCase: "conversational" } },
  { key: "en-gb-warm-male", language: "en", accent: "british", gender: "male", character: "warm", label: { en: "Warm · Male · British", fr: "Chaleureux · Homme · Britannique" }, bestFor: ["warm", "calm", "cinematic"], defaultProviderVoiceId: "JBFqnCBsd6RMkjVDRZzb", search: { gender: "male", language: "en", accent: "british", useCase: "conversational" } },
  { key: "en-intl-neutral-female", language: "en", accent: "international", gender: "female", character: "neutral", label: { en: "Neutral · Female · International", fr: "Neutre · Femme · International" }, bestFor: ["professional", "minimal", "calm"], defaultProviderVoiceId: null, search: { gender: "female", language: "en", accent: "international", useCase: "narration", query: "neutral" } },
  { key: "en-intl-neutral-male", language: "en", accent: "international", gender: "male", character: "neutral", label: { en: "Neutral · Male · International", fr: "Neutre · Homme · International" }, bestFor: ["professional", "minimal", "calm"], defaultProviderVoiceId: "N2lVS1w4EtoT3dr4eOWO", search: { gender: "male", language: "en", accent: "international", useCase: "narration", query: "neutral" } },

  { key: "es-premium-female", language: "es", accent: "international", gender: "female", character: "premium", label: { en: "Premium · Female · Spanish", fr: "Premium · Femme · Espagnol" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "female", language: "es", useCase: "narration" } },
  { key: "es-premium-male", language: "es", accent: "international", gender: "male", character: "premium", label: { en: "Premium · Male · Spanish", fr: "Premium · Homme · Espagnol" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "male", language: "es", useCase: "narration" } },
  { key: "de-premium-female", language: "de", accent: "international", gender: "female", character: "premium", label: { en: "Premium · Female · German", fr: "Premium · Femme · Allemand" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "female", language: "de", useCase: "narration" } },
  { key: "de-premium-male", language: "de", accent: "international", gender: "male", character: "premium", label: { en: "Premium · Male · German", fr: "Premium · Homme · Allemand" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "male", language: "de", useCase: "narration" } },
  { key: "it-premium-female", language: "it", accent: "international", gender: "female", character: "premium", label: { en: "Premium · Female · Italian", fr: "Premium · Femme · Italien" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "female", language: "it", useCase: "narration" } },
  { key: "it-premium-male", language: "it", accent: "international", gender: "male", character: "premium", label: { en: "Premium · Male · Italian", fr: "Premium · Homme · Italien" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "male", language: "it", useCase: "narration" } },
  { key: "pt-premium-female", language: "pt", accent: "international", gender: "female", character: "premium", label: { en: "Premium · Female · Portuguese", fr: "Premium · Femme · Portugais" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "female", language: "pt", useCase: "narration" } },
  { key: "pt-premium-male", language: "pt", accent: "international", gender: "male", character: "premium", label: { en: "Premium · Male · Portuguese", fr: "Premium · Homme · Portugais" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "male", language: "pt", useCase: "narration" } },
  { key: "nl-premium-female", language: "nl", accent: "international", gender: "female", character: "premium", label: { en: "Premium · Female · Dutch", fr: "Premium · Femme · Néerlandais" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "female", language: "nl", useCase: "narration" } },
  { key: "nl-premium-male", language: "nl", accent: "international", gender: "male", character: "premium", label: { en: "Premium · Male · Dutch", fr: "Premium · Homme · Néerlandais" }, bestFor: ["editorial", "professional"], defaultProviderVoiceId: null, search: { gender: "male", language: "nl", useCase: "narration" } },
];

export function curatedVoice(key: string | null | undefined): CuratedVoice | null {
  return CURATED_VOICES.find((voice) => voice.key === key) ?? null;
}

/** The accents a language is offered in, for the accent control. */
export function accentsFor(language: SpeechLanguage): Exclude<Accent, "auto">[] {
  return [...new Set(CURATED_VOICES.filter((voice) => voice.language === language).map((voice) => voice.accent))];
}

/** The slot key → provider voice id map the console holds. A slot absent or empty is unmapped. */
export type VoiceCatalogue = Record<string, string>;

/** Every slot, with the provider voice it currently resolves to: the defaults, overridden by the map. */
export function resolveCatalogue(mapping: VoiceCatalogue | null | undefined): { voice: CuratedVoice; providerVoiceId: string | null; source: "mapped" | "default" | "none" }[] {
  return CURATED_VOICES.map((voice) => {
    const mapped = mapping?.[voice.key]?.trim();
    if (mapped) return { voice, providerVoiceId: mapped, source: "mapped" };
    if (voice.defaultProviderVoiceId) return { voice, providerVoiceId: voice.defaultProviderVoiceId, source: "default" };
    return { voice, providerVoiceId: null, source: "none" };
  });
}

/** The character a style asks for, when the person has not chosen a voice by name. */
function characterFor(style: Style): VoiceCharacter {
  if (style === "warm" || style === "calm") return "warm";
  if (style === "minimal") return "neutral";
  return "premium";
}

export type VoiceChoiceInput = {
  language: SpeechLanguage;
  accent: Accent;
  gender: "auto" | "female" | "male";
  style: Style;
  /** A slot the workspace prefers, when it set one. Honoured when it speaks the language. */
  preferredKey?: string | null;
  catalogue?: VoiceCatalogue | null;
};

export type ChosenVoice = { voice: CuratedVoice; providerVoiceId: string; exact: boolean };

/**
 * The voice for a language, an accent, a gender and a style — never for another language.
 *
 * Scores every mapped voice of the language and takes the best: the gender the person chose counts
 * most, then the accent, then the character the style asks for. `exact` says whether every wish was met,
 * so the screen can say "no British voice yet — using US" rather than pretending.
 *
 * Returns null when the language has no mapped voice at all. The caller turns that into a sentence
 * for the person and stops; it does not reach for a voice of another language.
 */
export function chooseVoice(input: VoiceChoiceInput): ChosenVoice | null {
  const resolved = resolveCatalogue(input.catalogue).filter((entry): entry is { voice: CuratedVoice; providerVoiceId: string; source: "mapped" | "default" } => entry.providerVoiceId !== null && entry.voice.language === input.language);
  if (!resolved.length) return null;

  const preferred = input.preferredKey ? resolved.find((entry) => entry.voice.key === input.preferredKey) : null;
  if (preferred && (input.gender === "auto" || preferred.voice.gender === input.gender)) return { voice: preferred.voice, providerVoiceId: preferred.providerVoiceId, exact: true };

  const wanted = characterFor(input.style);
  const scored = resolved
    .map((entry) => {
      let score = 0;
      if (input.gender === "auto" || entry.voice.gender === input.gender) score += 100;
      if (input.accent === "auto" || entry.voice.accent === input.accent) score += 40;
      if (entry.voice.character === wanted) score += 10;
      if (entry.voice.bestFor.includes(input.style)) score += 5;
      if (entry.source === "mapped") score += 1;
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const exact = (input.accent === "auto" || best.entry.voice.accent === input.accent) && (input.gender === "auto" || best.entry.voice.gender === input.gender);
  return { voice: best.entry.voice, providerVoiceId: best.entry.providerVoiceId, exact };
}
