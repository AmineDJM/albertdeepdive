"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AudioLines, ChevronRight } from "lucide-react";
import { createNarrationAction } from "@/app/(newsroom)/speech/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useUi } from "@/components/i18n/provider";
import { LANGUAGE_NAMES, type SpeechLanguage } from "@/lib/speech/language";
import { accentsFor } from "@/lib/speech/voices";
import { PACES, STYLES, type Accent, type NarrationKind, type Pace, type Style } from "@/lib/speech/types";
import type { SpeechOverview } from "@/server/speech/service";

/**
 * Asking for a narration.
 *
 * Five choices in plain words — what, which voice, which language, how, how fast — and a quality
 * switch. Nothing here names a provider, a model or a setting: "Female · French · Warm" is the
 * whole vocabulary, and everything behind it is Briefly's to decide.
 *
 * The language defaults to the publication's and says so. Final quality is offered only once the
 * words are approved, because the premium voice is the one thing worth not spending twice.
 */

export type ComposerTarget = { editionId?: string | null; packId?: string | null };

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
const ACCENT_WORDS: Record<Exclude<Accent, "auto">, { en: string; fr: string }> = {
  france: { en: "France", fr: "France" },
  belgium: { en: "Belgium", fr: "Belgique" },
  canada: { en: "Canada", fr: "Canada" },
  us: { en: "US", fr: "États-Unis" },
  british: { en: "British", fr: "Britannique" },
  international: { en: "International", fr: "International" },
};

export function NarrationComposer({
  target,
  fixedKind,
  articles = [],
  overview,
  clones = [],
  publicationLanguage,
  approved,
}: {
  target: ComposerTarget;
  /** A film's narration has one kind; an edition offers several. */
  fixedKind?: NarrationKind;
  articles?: { id: string; headline: string }[];
  overview: SpeechOverview;
  clones?: { id: string; name: string }[];
  publicationLanguage: string | null;
  /** Whether the words are approved, which is when the premium voice is worth spending. */
  approved: boolean;
}) {
  const tr = useUi();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<NarrationKind>(fixedKind ?? (overview.features.audioEditions ? "EDITION" : "ARTICLE"));
  const [articleId, setArticleId] = useState(articles[0]?.id ?? "");
  const [customText, setCustomText] = useState("");
  const [voice, setVoice] = useState("auto");
  const [language, setLanguage] = useState("auto");
  const [accent, setAccent] = useState<Accent>("auto");
  const [style, setStyle] = useState<Style>(fixedKind === "VIDEO" ? "cinematic" : "editorial");
  const [pace, setPace] = useState<Pace>("natural");
  const canFinal = overview.features.premiumVoices && overview.available.final;
  const [quality, setQuality] = useState<"PREVIEW" | "FINAL">(canFinal && approved ? "FINAL" : "PREVIEW");
  const [takes, setTakes] = useState<1 | 2>(1);
  const [secondVoice, setSecondVoice] = useState(true);
  const [advanced, setAdvanced] = useState(false);

  const names = LANGUAGE_NAMES[locale];
  const spokenLanguage = (language === "auto" ? publicationLanguage : language) as SpeechLanguage | null;
  const accents = useMemo(() => (spokenLanguage && spokenLanguage in names ? accentsFor(spokenLanguage) : []), [spokenLanguage, names]);
  const connected = overview.available.preview || overview.available.final;

  if (!overview.features.audioNarration) {
    return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">{tr("Narration is not included in your plan. Upgrade to have your editions read aloud.")}</p>;
  }
  if (!connected) {
    return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">{tr("Narration is not connected on this Briefly yet. Ask your administrator.")}</p>;
  }

  const submit = () =>
    startTransition(async () => {
      const result = await createNarrationAction({
        kind,
        editionId: target.editionId ?? null,
        packId: target.packId ?? null,
        articleId: kind === "ARTICLE" ? articleId || null : null,
        customText: kind === "CUSTOM" ? customText : null,
        quality,
        options: { voice, language, accent, style, pace, takes, speakers: secondVoice ? "auto" : "single" },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? tr("Narration queued"));
      router.refresh();
    });

  const kindOptions: { value: NarrationKind; label: string }[] = [
    ...(overview.features.audioEditions ? [{ value: "EDITION" as const, label: tr("The whole edition") }, { value: "SUMMARY" as const, label: tr("A digest of the edition") }, { value: "EXECUTIVE" as const, label: tr("An executive briefing") }] : []),
    { value: "ARTICLE", label: tr("One article") },
    { value: "CUSTOM", label: tr("Words I paste") },
  ];

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {!fixedKind ? (
          <div className="space-y-1.5">
            <Label htmlFor="narration-kind">{tr("What to read")}</Label>
            <NativeSelect id="narration-kind" value={kind} onChange={(event) => setKind(event.target.value as NarrationKind)}>
              {kindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {kind === "ARTICLE" ? (
          <div className="space-y-1.5">
            <Label htmlFor="narration-article">{tr("Article")}</Label>
            <NativeSelect id="narration-article" value={articleId} onChange={(event) => setArticleId(event.target.value)}>
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {article.headline}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="narration-voice">{tr("Voice")}</Label>
          <NativeSelect id="narration-voice" value={voice} onChange={(event) => setVoice(event.target.value)}>
            <option value="auto">{tr("Auto")}</option>
            <option value="female">{tr("Female")}</option>
            <option value="male">{tr("Male")}</option>
            {overview.features.brandVoice ? <option value="brand">{tr("Brand voice")}</option> : null}
            {overview.features.voiceCloning && overview.cloningEnabled
              ? clones.map((clone) => (
                  <option key={clone.id} value={`clone:${clone.id}`}>
                    {clone.name}
                  </option>
                ))
              : null}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="narration-language">{tr("Language")}</Label>
          <NativeSelect id="narration-language" value={language} onChange={(event) => { setLanguage(event.target.value); setAccent("auto"); }}>
            <option value="auto">{publicationLanguage && publicationLanguage in names ? `${tr("Auto")} — ${names[publicationLanguage as SpeechLanguage]}` : tr("Auto — the text's own language")}</option>
            {overview.languages.map((code) => (
              <option key={code} value={code}>
                {names[code]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="narration-accent">{tr("Accent")}</Label>
          <NativeSelect id="narration-accent" value={accent} onChange={(event) => setAccent(event.target.value as Accent)}>
            <option value="auto">{tr("Auto")}</option>
            {accents.map((option) => (
              <option key={option} value={option}>
                {ACCENT_WORDS[option][locale]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="narration-style">{tr("Style")}</Label>
          <NativeSelect id="narration-style" value={style} onChange={(event) => setStyle(event.target.value as Style)}>
            {STYLES.map((option) => (
              <option key={option} value={option}>
                {STYLE_WORDS[option][locale]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="narration-pace">{tr("Pace")}</Label>
          <NativeSelect id="narration-pace" value={pace} onChange={(event) => setPace(event.target.value as Pace)}>
            {PACES.map((option) => (
              <option key={option} value={option}>
                {PACE_WORDS[option][locale]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="narration-quality">{tr("Quality")}</Label>
          <NativeSelect id="narration-quality" value={quality} onChange={(event) => setQuality(event.target.value as "PREVIEW" | "FINAL")}>
            <option value="PREVIEW">{tr("Preview — quick, for hearing the words")}</option>
            <option value="FINAL" disabled={!canFinal}>
              {tr("Final — the premium voice")}
            </option>
          </NativeSelect>
        </div>
      </div>

      {kind === "CUSTOM" ? (
        <div className="space-y-1.5">
          <Label htmlFor="narration-text">{tr("The words")}</Label>
          <Textarea id="narration-text" rows={5} value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder={tr("Paste what should be read. Paragraphs become breaths.")} />
        </div>
      ) : null}

      {quality === "FINAL" && !approved ? <p className="text-2xs leading-4 text-warning">{tr("The words are not approved yet. A preview costs a fraction; the premium voice is best spent once the edition is final.")}</p> : null}
      {!canFinal ? <p className="text-2xs leading-4 text-muted-foreground">{overview.features.premiumVoices ? tr("The premium voice is not connected on this Briefly yet; previews still work.") : tr("The premium voice is not included in your plan; previews still work.")}</p> : null}

      <details className="group" open={advanced} onToggle={(event) => setAdvanced((event.target as HTMLDetailsElement).open)}>
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
          {tr("Advanced")}
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={secondVoice} onCheckedChange={(checked) => setSecondVoice(checked === true)} />
            {tr("Let a second voice read interviews and quotations")}
          </label>
          {overview.features.multipleTakes ? (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={takes === 2} onCheckedChange={(checked) => setTakes(checked === true ? 2 : 1)} />
              {tr("Record a second take to choose from (spends twice the minutes)")}
            </label>
          ) : null}
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-2xs text-muted-foreground">
          {overview.allowance.limitMinutes === null
            ? tr("Unlimited minutes on your plan.")
            : `${Math.round(overview.allowance.usedSeconds / 60)} / ${overview.allowance.limitMinutes} ${tr("minutes used this month")}`}
        </p>
        <Button type="submit" variant="brand" size="sm" loading={pending} disabled={kind === "ARTICLE" && !articleId}>
          <AudioLines />{" "}{tr("Make the narration")}</Button>
      </div>
    </form>
  );
}
