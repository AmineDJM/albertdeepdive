"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { updateBrandVoiceAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useLocale, useUi } from "@/components/i18n/provider";
import { LANGUAGE_NAMES, type SpeechLanguage } from "@/lib/speech/language";
import { ACCENTS, PACES, STYLES, type Accent, type Pace, type Style } from "@/lib/speech/types";

/**
 * How the workspace sounds by default, and how its words are said.
 *
 * The pronunciation list is the part people come back to: the school's name said the French way,
 * the acronym everybody reads as letters, the founder's surname. Each line is a term and how to say
 * it, applied to every narration before a voice sees it.
 */

export type BrandVoiceValues = {
  voiceKey: string | null;
  gender: "auto" | "female" | "male";
  accent: Accent;
  style: Style;
  pace: Pace;
  language: string | null;
  pronunciations: { term: string; say: string; language?: string | null }[];
  cloneId: string | null;
};

const STYLE_WORDS: Record<Style, { en: string; fr: string }> = {
  cinematic: { en: "Cinematic", fr: "Cinématographique" },
  professional: { en: "Professional", fr: "Professionnel" },
  warm: { en: "Warm", fr: "Chaleureux" },
  editorial: { en: "Editorial", fr: "Éditorial" },
  confident: { en: "Confident", fr: "Assuré" },
  energetic: { en: "Energetic", fr: "Énergique" },
  minimal: { en: "Minimal", fr: "Minimal" },
  calm: { en: "Calm", fr: "Calme" },
};
const PACE_WORDS: Record<Pace, { en: string; fr: string }> = { slow: { en: "Slow", fr: "Lent" }, natural: { en: "Natural", fr: "Naturel" }, fast: { en: "Fast", fr: "Rapide" } };
const ACCENT_WORDS: Record<Accent, { en: string; fr: string }> = {
  auto: { en: "Auto", fr: "Auto" },
  france: { en: "France", fr: "France" },
  belgium: { en: "Belgium", fr: "Belgique" },
  canada: { en: "Canada", fr: "Canada" },
  us: { en: "US", fr: "États-Unis" },
  british: { en: "British", fr: "Britannique" },
  international: { en: "International", fr: "International" },
};

export function BrandVoiceForm({ values, voices, languages, clones }: { values: BrandVoiceValues; voices: { key: string; label: string; language: string }[]; languages: SpeechLanguage[]; clones: { id: string; name: string }[] }) {
  const tr = useUi();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<BrandVoiceValues>(values);
  const names = LANGUAGE_NAMES[locale];

  const setPronunciation = (index: number, patch: Partial<BrandVoiceValues["pronunciations"][number]>) =>
    setForm((current) => ({ ...current, pronunciations: current.pronunciations.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)) }));

  const submit = () =>
    startTransition(async () => {
      const result = await updateBrandVoiceAction({
        voiceKey: form.voiceKey || null,
        gender: form.gender,
        accent: form.accent,
        style: form.style,
        pace: form.pace,
        language: form.language || null,
        pronunciations: form.pronunciations.filter((entry) => entry.term.trim() && entry.say.trim()).map((entry) => ({ term: entry.term.trim(), say: entry.say.trim(), language: entry.language || null })),
        cloneId: form.cloneId || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? tr("Saved"));
      router.refresh();
    });

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="bv-voice">{tr("Preferred voice")}</Label>
          <NativeSelect id="bv-voice" value={form.voiceKey ?? ""} onChange={(event) => setForm({ ...form, voiceKey: event.target.value || null })}>
            <option value="">{tr("Let Briefly pick for the language")}</option>
            {voices.map((voice) => (
              <option key={voice.key} value={voice.key}>
                {voice.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {clones.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="bv-clone">{tr("Cloned voice as the brand voice")}</Label>
            <NativeSelect id="bv-clone" value={form.cloneId ?? ""} onChange={(event) => setForm({ ...form, cloneId: event.target.value || null })}>
              <option value="">{tr("None")}</option>
              {clones.map((clone) => (
                <option key={clone.id} value={clone.id}>
                  {clone.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="bv-gender">{tr("Voice")}</Label>
          <NativeSelect id="bv-gender" value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value as BrandVoiceValues["gender"] })}>
            <option value="auto">{tr("Auto")}</option>
            <option value="female">{tr("Female")}</option>
            <option value="male">{tr("Male")}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bv-accent">{tr("Accent")}</Label>
          <NativeSelect id="bv-accent" value={form.accent} onChange={(event) => setForm({ ...form, accent: event.target.value as Accent })}>
            {ACCENTS.map((accent) => (
              <option key={accent} value={accent}>
                {ACCENT_WORDS[accent][locale]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bv-style">{tr("Style")}</Label>
          <NativeSelect id="bv-style" value={form.style} onChange={(event) => setForm({ ...form, style: event.target.value as Style })}>
            {STYLES.map((style) => (
              <option key={style} value={style}>
                {STYLE_WORDS[style][locale]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bv-pace">{tr("Pace")}</Label>
          <NativeSelect id="bv-pace" value={form.pace} onChange={(event) => setForm({ ...form, pace: event.target.value as Pace })}>
            {PACES.map((pace) => (
              <option key={pace} value={pace}>
                {PACE_WORDS[pace][locale]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bv-language">{tr("Language")}</Label>
          <NativeSelect id="bv-language" value={form.language ?? ""} onChange={(event) => setForm({ ...form, language: event.target.value || null })}>
            <option value="">{tr("Each publication's own")}</option>
            {languages.map((code) => (
              <option key={code} value={code}>
                {names[code]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-2xs leading-4 text-muted-foreground">{tr("Narration follows the language each title publishes in. Set this only to force one language everywhere.")}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{tr("How to say")}</Label>
          <Button type="button" size="xs" variant="ghost" onClick={() => setForm({ ...form, pronunciations: [...form.pronunciations, { term: "", say: "", language: null }] })}>
            <Plus />{" "}{tr("Add a word")}</Button>
        </div>
        {form.pronunciations.length ? (
          <ul className="space-y-2">
            {form.pronunciations.map((entry, index) => (
              <li key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_120px_auto]">
                <Input value={entry.term} placeholder={tr("Written")} onChange={(event) => setPronunciation(index, { term: event.target.value })} aria-label={tr("Written")} />
                <Input value={entry.say} placeholder={tr("Said")} onChange={(event) => setPronunciation(index, { say: event.target.value })} aria-label={tr("Said")} />
                <NativeSelect value={entry.language ?? ""} onChange={(event) => setPronunciation(index, { language: event.target.value || null })} aria-label={tr("Language")}>
                  <option value="">{tr("Every language")}</option>
                  {languages.map((code) => (
                    <option key={code} value={code}>
                      {names[code]}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="button" size="sm" variant="ghost" onClick={() => setForm({ ...form, pronunciations: form.pronunciations.filter((_, position) => position !== index) })} aria-label={tr("Remove")}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{tr("Nothing yet. Add the names and acronyms a voice would get wrong: how they are written, then how they are said.")}</p>
        )}
      </div>

      <Button type="submit" size="sm" loading={pending}>
        {tr("Save voice")}</Button>
    </form>
  );
}
