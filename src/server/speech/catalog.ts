import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { LANGUAGE_NAMES, type SpeechLanguage } from "@/lib/speech/language";
import type { NarrationOptions } from "@/lib/speech/types";
import { chooseVoice, curatedVoice, type CuratedVoice, type VoiceCatalogue } from "@/lib/speech/voices";

/**
 * From "Female · French · Warm" to a voice a provider can be asked for.
 *
 * The three sources of a voice, in order: a cloned voice the workspace was given consent for, the
 * workspace's house voice, and the catalogue for the language. The one rule that never bends is
 * the catalogue's — a language is spoken by a voice native to it — so a French narration on a
 * platform with no French voice mapped yet comes back null, with the sentence to show, rather than
 * with an English voice and an accent.
 */

export type ResolvedVoice = {
  voiceKey: string;
  voiceName: string;
  providerVoiceId: string;
  gender: "female" | "male" | "auto";
  kind: "curated" | "clone";
  /** Whether every wish was met; when not, `note` says what was substituted. */
  exact: boolean;
  note: string | null;
};

type BrandVoiceRow = typeof s.brandVoices.$inferSelect;

type CloneRow = typeof s.voiceClones.$inferSelect;

async function readyClone(cloneId: string, organizationId: string, locale: "en" | "fr"): Promise<{ ok: false; error: string } | { ok: true; clone: CloneRow & { providerVoiceId: string } }> {
  const clone = await db.query.voiceClones.findFirst({ where: eq(s.voiceClones.id, cloneId) });
  if (!clone || clone.organizationId !== organizationId) return { ok: false, error: locale === "fr" ? "Cette voix clonée n'existe pas dans cet espace." : "That cloned voice does not exist in this workspace." };
  if (clone.status !== "READY" || !clone.providerVoiceId) return { ok: false, error: locale === "fr" ? `La voix « ${clone.name} » n'est pas prête.` : `The voice “${clone.name}” is not ready.` };
  return { ok: true, clone: { ...clone, providerVoiceId: clone.providerVoiceId } };
}

export type VoiceResolution = { voice: ResolvedVoice } | { voice: null; reason: string };

export async function resolveVoiceFor(input: { organizationId: string; language: SpeechLanguage; options: NarrationOptions; brandVoice: BrandVoiceRow | null; catalogue: VoiceCatalogue; cloningEnabled: boolean; locale: "en" | "fr" }): Promise<VoiceResolution> {
  const { options, brandVoice, locale } = input;
  const names = LANGUAGE_NAMES[locale];

  // A person's own voice, by explicit choice or as the house voice.
  const cloneId = options.voice.startsWith("clone:") ? options.voice.slice(6) : options.voice === "brand" ? (brandVoice?.cloneId ?? null) : null;
  if (cloneId) {
    if (!input.cloningEnabled) return { voice: null, reason: locale === "fr" ? "Les voix clonées sont désactivées sur ce Briefly." : "Cloned voices are switched off on this Briefly." };
    const found = await readyClone(cloneId, input.organizationId, locale);
    if (!found.ok) return { voice: null, reason: found.error };
    const clone = found.clone;
    const mismatch = clone.language && clone.language !== input.language;
    return {
      voice: { voiceKey: `clone:${clone.id}`, voiceName: clone.name, providerVoiceId: clone.providerVoiceId, gender: "auto", kind: "clone", exact: !mismatch, note: mismatch ? (locale === "fr" ? `${clone.name} a été enregistrée en ${names[clone.language as SpeechLanguage] ?? clone.language} ; cette narration est en ${names[input.language]}.` : `${clone.name} was recorded in ${names[clone.language as SpeechLanguage] ?? clone.language}; this narration is in ${names[input.language]}.`) : null },
    };
  }

  const gender = options.voice === "female" || options.voice === "male" ? options.voice : brandVoice && (brandVoice.gender === "female" || brandVoice.gender === "male") && (options.voice === "auto" || options.voice === "brand") ? brandVoice.gender : "auto";
  const preferredKey = options.voice === "auto" || options.voice === "brand" ? (brandVoice?.voiceKey ?? null) : null;
  const accent = options.accent !== "auto" ? options.accent : brandVoice && brandVoice.accent !== "auto" ? (brandVoice.accent as NarrationOptions["accent"]) : "auto";

  const chosen = chooseVoice({ language: input.language, accent, gender, style: options.style, preferredKey, catalogue: input.catalogue });
  if (!chosen) {
    return { voice: null, reason: locale === "fr" ? `Aucune voix ${names[input.language].toLowerCase()} n'est encore configurée sur ce Briefly. Demandez à votre administrateur d'en ajouter une.` : `No ${names[input.language]} voice is set up on this Briefly yet. Ask your administrator to add one.` };
  }
  const note = chosen.exact ? null : locale === "fr" ? `Pas encore de voix ${describe(accent, gender, "fr")} pour le ${names.fr === names[input.language] ? "français" : names[input.language].toLowerCase()} : ${chosen.voice.label.fr} est utilisée.` : `No ${describe(accent, gender, "en")} ${names[input.language]} voice yet: using ${chosen.voice.label.en}.`;
  return { voice: { voiceKey: chosen.voice.key, voiceName: chosen.voice.label[locale], providerVoiceId: chosen.providerVoiceId, gender: chosen.voice.gender, kind: "curated", exact: chosen.exact, note } };
}

function describe(accent: string, gender: string, locale: "en" | "fr"): string {
  const parts: string[] = [];
  if (gender !== "auto") parts.push(locale === "fr" ? (gender === "female" ? "féminine" : "masculine") : gender);
  if (accent !== "auto") parts.push(accent === "us" ? "US" : accent === "british" ? (locale === "fr" ? "britannique" : "British") : accent === "france" ? (locale === "fr" ? "de France" : "France") : accent);
  return parts.join(" ");
}

/**
 * A second voice for a quotation or an answer: the same language and accent, the other gender,
 * so an interview reads as two people. Null when the language has only one voice mapped — then
 * the narrator reads it all, which is the right degradation.
 */
export function secondVoiceFor(language: SpeechLanguage, primary: CuratedVoice | null, catalogue: VoiceCatalogue, locale: "en" | "fr"): ResolvedVoice | null {
  const gender = primary?.gender === "female" ? "male" : "female";
  const chosen = chooseVoice({ language, accent: primary?.accent ?? "auto", gender, style: "editorial", catalogue });
  if (!chosen || chosen.voice.key === primary?.key) return null;
  return { voiceKey: chosen.voice.key, voiceName: chosen.voice.label[locale], providerVoiceId: chosen.providerVoiceId, gender: chosen.voice.gender, kind: "curated", exact: true, note: null };
}

export { curatedVoice };
