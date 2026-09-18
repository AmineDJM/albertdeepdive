"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronRight, Download, Globe, GlobeLock, Info, RefreshCw, Trash2 } from "lucide-react";
import { deleteNarrationAction, narrationDownloadAction, publishNarrationAction, regeneratePassageAction } from "@/app/(newsroom)/speech/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocale, useUi } from "@/components/i18n/provider";
import { LANGUAGE_NAMES, type SpeechLanguage } from "@/lib/speech/language";
import type { NarrationChapter, NarrationQa } from "@/server/db/schema/speech";
import { cn, formatDateTime } from "@/lib/utils";

/**
 * What was made, and what to do with it.
 *
 * One card per narration: the player, the chapters to jump to, what the check found with a button
 * to redo the passage it names, and the ways out — to the readers, to a file, to the bin. While one
 * is still being made the page asks again every few seconds, so nobody has to.
 */

export type NarrationView = {
  id: string;
  title: string;
  kind: string;
  quality: string;
  status: string;
  language: string;
  languageSource: string;
  voiceName: string | null;
  durationSeconds: number | null;
  createdAt: string;
  url: string | null;
  takeUrls: { take: number; url: string }[];
  chapters: NarrationChapter[];
  qa: NarrationQa | null;
  publishedAt: string | null;
  error: string | null;
  passages: { index: number; plain: string; speaker: string; chapter: string | null }[];
  costCents: number;
  canPublish: boolean;
};

const KIND_WORDS: Record<string, { en: string; fr: string }> = {
  EDITION: { en: "Whole edition", fr: "Édition complète" },
  ARTICLE: { en: "One article", fr: "Un article" },
  SUMMARY: { en: "Digest", fr: "L'essentiel" },
  EXECUTIVE: { en: "Executive briefing", fr: "Briefing" },
  VIDEO: { en: "Film narration", fr: "Voix du film" },
  CUSTOM: { en: "Custom text", fr: "Texte libre" },
};

const STATUS_WORDS: Record<string, { en: string; fr: string }> = {
  QUEUED: { en: "Queued", fr: "En attente" },
  ADAPTING: { en: "Adapting the words", fr: "Adaptation des mots" },
  NARRATING: { en: "Recording", fr: "Enregistrement" },
  MASTERING: { en: "Mastering", fr: "Mastering" },
  READY: { en: "Ready", fr: "Prête" },
  FAILED: { en: "Needs attention", fr: "À vérifier" },
};

const IN_PROGRESS = new Set(["QUEUED", "ADAPTING", "NARRATING", "MASTERING"]);

function clock(seconds: number): string {
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function NarrationList({ narrations }: { narrations: NarrationView[] }) {
  const router = useRouter();
  const busy = narrations.some((narration) => IN_PROGRESS.has(narration.status));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [busy, router]);
  return (
    <ul className="space-y-3">
      {narrations.map((narration) => (
        <NarrationCard key={narration.id} narration={narration} />
      ))}
    </ul>
  );
}

function NarrationCard({ narration }: { narration: NarrationView }) {
  const tr = useUi();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const audio = useRef<HTMLAudioElement>(null);
  const [showWords, setShowWords] = useState(false);
  const names = LANGUAGE_NAMES[locale];
  const inProgress = IN_PROGRESS.has(narration.status);

  const run = (action: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? tr("That did not work"));
        return;
      }
      if (result.message) toast.success(result.message);
      router.refresh();
    });

  const download = (take?: number) =>
    startTransition(async () => {
      const result = await narrationDownloadAction(narration.id, take);
      if (result.ok) window.location.href = result.data.url;
      else toast.error(result.error);
    });

  const seek = (seconds: number) => {
    if (!audio.current) return;
    audio.current.currentTime = seconds;
    void audio.current.play();
  };

  const defects = narration.qa?.findings.filter((finding) => finding.severity === "defect") ?? [];
  const notes = narration.qa?.findings.filter((finding) => finding.severity === "note") ?? [];

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
            <span className="truncate">{narration.title}</span>
            <Badge variant={narration.status === "READY" ? "success" : narration.status === "FAILED" ? "destructive" : "info"}>{STATUS_WORDS[narration.status]?.[locale] ?? narration.status.toLowerCase()}</Badge>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {KIND_WORDS[narration.kind]?.[locale] ?? narration.kind} · {names[narration.language as SpeechLanguage] ?? narration.language.toUpperCase()}
            {narration.voiceName ? ` · ${narration.voiceName}` : ""} · {narration.quality === "FINAL" ? tr("Final") : tr("Preview")}
            {narration.durationSeconds ? ` · ${clock(narration.durationSeconds)}` : ""} · {formatDateTime(narration.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {narration.status === "READY" && narration.canPublish ? (
            <Button size="xs" variant={narration.publishedAt ? "outline" : "ghost"} disabled={pending} onClick={() => run(() => publishNarrationAction(narration.id, !narration.publishedAt))}>
              {narration.publishedAt ? <GlobeLock /> : <Globe />}{" "}{narration.publishedAt ? tr("Unpublish") : tr("Publish to readers")}</Button>
          ) : null}
          {narration.url ? (
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => download()}>
              <Download />{" "}{tr("Download")}</Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            className="text-destructive"
            disabled={pending || inProgress}
            onClick={() => {
              if (window.confirm(tr("Delete this narration? The audio is removed for good."))) run(() => deleteNarrationAction(narration.id));
            }}
          >
            <Trash2 />{" "}{tr("Delete")}</Button>
        </div>
      </div>

      {narration.error ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-coral-soft bg-coral-soft/40 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-coral-deep" />
          {narration.error}
        </p>
      ) : null}
      {inProgress ? <p className="mt-3 text-xs text-muted-foreground">{tr("Being made. This page updates on its own.")}</p> : null}

      {narration.url ? (
        <div className="mt-3 space-y-2">
          <audio ref={audio} controls preload="none" src={narration.url} className="w-full" />
          {narration.takeUrls.map((take) => (
            <div key={take.take} className="flex items-center gap-2">
              <span className="text-2xs text-muted-foreground">{tr("Take")}{" "}{take.take}</span>
              <audio controls preload="none" src={take.url} className="h-8 flex-1" />
              <Button size="xs" variant="ghost" onClick={() => download(take.take)}>
                <Download />
              </Button>
            </div>
          ))}
          {narration.publishedAt ? <p className="text-2xs text-green-deep">{tr("Readers can listen to this on the web edition.")}</p> : null}
        </div>
      ) : null}

      {narration.chapters.length > 1 ? (
        <ol className="mt-3 flex flex-wrap gap-1.5">
          {narration.chapters.map((chapter) => (
            <li key={`${chapter.passageIndex}-${chapter.startSeconds}`}>
              <button type="button" onClick={() => seek(chapter.startSeconds)} className="rounded-md border border-border px-2 py-0.5 text-2xs text-muted-foreground hover:border-brand hover:text-foreground">
                <span className="tabular">{clock(chapter.startSeconds)}</span> · {chapter.title}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {narration.qa ? (
        <div className="mt-3 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs">
            {narration.qa.ok ? <Check className="size-3.5 text-green-deep" /> : <AlertTriangle className="size-3.5 text-coral-deep" />}
            {narration.qa.summary}
          </p>
          {[...defects, ...notes].map((finding, position) => (
            <div key={position} className="flex flex-wrap items-center gap-2 text-xs">
              {finding.severity === "defect" ? <AlertTriangle className="size-3 shrink-0 text-coral-deep" /> : <Info className="size-3 shrink-0 text-muted-foreground" />}
              <span className={cn(finding.severity === "defect" ? "text-foreground" : "text-muted-foreground")}>
                {finding.passage !== null ? <span className="font-medium">{tr("Passage")}{" "}{finding.passage + 1}: </span> : null}
                {finding.message}
              </span>
              {finding.passage !== null && !inProgress ? (
                <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => regeneratePassageAction(narration.id, finding.passage as number))}>
                  <RefreshCw />{" "}{tr("Regenerate this passage")}</Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {narration.passages.length ? (
        <details className="group mt-3" open={showWords} onToggle={(event) => setShowWords((event.target as HTMLDetailsElement).open)}>
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
            {tr("The words as spoken")} · {narration.passages.length} {tr("passages")}
          </summary>
          <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-2 text-xs leading-5 scrollbar-thin">
            {narration.passages.map((passage) => (
              <li key={passage.index} className="flex gap-2">
                <span className="w-6 shrink-0 text-right text-2xs text-muted-foreground tabular">{passage.index + 1}</span>
                <span className={cn(passage.speaker === "second" && "italic")}>{passage.plain}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </li>
  );
}
