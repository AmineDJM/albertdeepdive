"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Columns2, GitBranch, History, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocale, useUi } from "@/components/i18n/provider";
import { cn, formatDateTime } from "@/lib/utils";
import { editImageAction, rejectVersionAction, restoreVersionAction } from "@/app/(newsroom)/images/actions";
import { ImageComposer } from "./image-composer";
import type { ImageLineView, ImageVersionView, ReferenceCandidate } from "@/server/images/views";

/**
 * A picture's versions.
 *
 * Every change ever asked for, in order, none of them lost. The current one is marked; any other
 * can be compared with it, made current again, or used as the start of a new branch. A version
 * thrown out stays in the line, greyed, so the record of what was tried is kept. What made each
 * version — the model, the tries, the cost — appears only for the people the console lets see it.
 */

const STATUS_WORDS: Record<ImageVersionView["status"], { en: string; fr: string }> = {
  QUEUED: { en: "Queued", fr: "En attente" },
  RUNNING: { en: "Being made", fr: "En cours" },
  READY: { en: "Ready", fr: "Prête" },
  FAILED: { en: "Did not come out", fr: "Échec" },
  REJECTED: { en: "Thrown out", fr: "Écartée" },
};
const SENSITIVITY_WORDS = { LOW: { en: "Free", fr: "Libre" }, MEDIUM: { en: "Careful", fr: "Prudent" }, HIGH: { en: "Protected", fr: "Protégé" } } as const;

export function VersionHistory({ line, mediaId, candidates, canManage }: { line: ImageLineView; mediaId: string; candidates: ReferenceCandidate[]; canManage: boolean }) {
  const tr = useUi();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [compareId, setCompareId] = useState<string | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [split, setSplit] = useState(50);

  useEffect(() => {
    if (!line.busy) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [line.busy, router]);

  const here = line.versions.find((version) => version.mediaId === mediaId) ?? line.current;
  const compare = useMemo(() => line.versions.find((version) => version.id === compareId) ?? null, [compareId, line.versions]);
  const base = branchFrom ? line.versions.find((version) => version.id === branchFrom) ?? null : null;

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

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold">{base && base.id !== here?.id ? `${tr("Edit from version")} ${base.version}` : tr("Describe the change")}</h3>
            {base && base.id !== here?.id ? (
              <Button type="button" variant="ghost" size="xs" onClick={() => setBranchFrom(null)}>
                {tr("Back to this version")}
              </Button>
            ) : null}
          </div>
          {line.busy ? <p className="mb-2 text-xs text-muted-foreground">{tr("A version is being made. You can queue another change; they are made in order.")}</p> : null}
          <ImageComposer
            mode="edit"
            candidates={candidates}
            onSubmit={(input) => editImageAction({ versionId: base?.id ?? here?.id ?? null, mediaId: base || here ? null : mediaId, instruction: input.instruction, references: input.references, advanced: input.advanced })}
            onDone={() => setBranchFrom(null)}
          />
        </div>
      ) : null}

      {compare && here ? (
        <div className="rounded-lg border border-border bg-card p-3 shadow-xs">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              <strong>{tr("Compare")}</strong> · v{compare.version} {tr("against")} v{here.version}
            </span>
            <Button type="button" variant="ghost" size="xs" onClick={() => setCompareId(null)}>
              {tr("Close")}
            </Button>
          </div>
          <div className="relative mx-auto max-h-[480px] overflow-hidden rounded-md bg-muted" style={{ aspectRatio: here.width && here.height ? `${here.width} / ${here.height}` : "3 / 2" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={here.previewUrl ?? ""} alt={`v${here.version}`} className="absolute inset-0 size-full object-contain" />
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${split}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={compare.previewUrl ?? ""} alt={`v${compare.version}`} className="absolute inset-0 size-full max-w-none object-contain" style={{ width: `${10000 / split}%` }} />
            </div>
            <div className="absolute inset-y-0 w-px bg-white/90 shadow" style={{ left: `${split}%` }} />
            <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-2xs text-white">v{compare.version}</span>
            <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-2xs text-white">v{here.version}</span>
          </div>
          <input type="range" min={5} max={95} value={split} onChange={(event) => setSplit(Number(event.target.value))} className="mt-2 w-full accent-brand" aria-label={tr("Compare slider")} />
        </div>
      ) : null}

      <ol className="space-y-2" data-testid="image-versions">
        {[...line.versions].reverse().map((version) => {
          const isHere = version.id === here?.id;
          const inProgress = version.status === "QUEUED" || version.status === "RUNNING";
          return (
            <li key={version.id} className={cn("flex gap-3 rounded-lg border border-border bg-card p-3 shadow-xs", version.status === "REJECTED" && "opacity-60", isHere && "ring-1 ring-brand")}>
              <div className="size-16 shrink-0 overflow-hidden rounded-md bg-muted">
                {version.thumbUrl ? (
                  version.mediaId && !isHere ? (
                    <Link href={`/media/${version.mediaId}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={version.thumbUrl} alt={version.label} className={cn("size-full object-cover", version.status === "REJECTED" && "grayscale")} />
                    </Link>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={version.thumbUrl} alt={version.label} className="size-full object-cover" />
                  )
                ) : (
                  <div className={cn("size-full", inProgress && "animate-pulse bg-brand-soft")} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                  <span className="tabular">v{version.version}</span>
                  <span className="truncate">{version.label}</span>
                  <Badge variant={version.status === "READY" ? "success" : version.status === "FAILED" ? "destructive" : version.status === "REJECTED" ? "muted" : "info"}>{STATUS_WORDS[version.status][locale]}</Badge>
                  {version.isCurrent ? <Badge variant="brand">{tr("Current")}</Badge> : null}
                  {isHere ? <Badge variant="outline">{tr("This page")}</Badge> : null}
                  {version.sensitivity !== "LOW" && version.operation !== "import" ? <Badge variant="outline">{SENSITIVITY_WORDS[version.sensitivity][locale]}</Badge> : null}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={version.instruction}>
                  {version.operation === "import" ? tr("The original, as it was added to the library.") : version.instruction}
                </p>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {formatDateTime(new Date(version.createdAt))}
                  {version.qa ? ` · ${tr("check")} ${Math.round(version.qa.score * 100)}/100` : ""}
                  {version.operation === "regenerate" ? ` · ${tr("remade from the original")}` : ""}
                </p>
                {version.error ? <p className="mt-1 text-xs text-destructive">{version.error}</p> : null}
                {version.qa?.issues.length && version.status === "READY" ? <p className="mt-1 text-2xs text-warning">{version.qa.issues.join(" · ")}</p> : null}
                {version.routing ? (
                  <details className="mt-1 text-2xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      {tr("Routing")} · {version.routing.modelLabel ?? version.routing.model} ({version.routing.provider}) · {version.routing.attempts.length} {tr("tries")} · {version.routing.latencyMs ? `${(version.routing.latencyMs / 1000).toFixed(1)} s` : "—"} · {version.routing.costCents ? `${(version.routing.costCents / 100).toFixed(3)} €` : "—"}
                    </summary>
                    <div className="mt-1 space-y-0.5 font-mono">
                      <p>candidates: {version.routing.candidates.join(" → ") || "—"}</p>
                      {Object.entries(version.routing.reasons).map(([key, reason]) => (
                        <p key={key}>
                          {key}: {reason}
                        </p>
                      ))}
                      {version.routing.attempts.map((attempt, index) => (
                        <p key={index}>
                          {attempt.provider}/{attempt.model} · {attempt.latencyMs} ms · {attempt.error ? `error: ${attempt.error}` : `qa ${attempt.qaScore ?? "—"}`}
                        </p>
                      ))}
                      {version.routing.prompt ? <p className="whitespace-pre-wrap font-sans">{version.routing.prompt}</p> : null}
                    </div>
                  </details>
                ) : null}
              </div>
              {canManage && version.status === "READY" ? (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {!isHere ? (
                    <Button type="button" variant="ghost" size="xs" onClick={() => setCompareId(compareId === version.id ? null : version.id)} title={tr("Compare with this page's version")}>
                      <Columns2 /> {tr("Compare")}
                    </Button>
                  ) : null}
                  {!version.isCurrent ? (
                    <Button type="button" variant="ghost" size="xs" onClick={() => run(() => restoreVersionAction(version.id))} disabled={pending} title={tr("Make this the current version")}>
                      <RotateCcw /> {tr("Restore")}
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="xs" onClick={() => setBranchFrom(branchFrom === version.id ? null : version.id)} title={tr("Start a new change from this version")}>
                    <GitBranch /> {tr("Branch")}
                  </Button>
                  {version.operation !== "import" ? (
                    <Button type="button" variant="ghost" size="xs" className="text-destructive" onClick={() => run(() => rejectVersionAction(version.id))} disabled={pending}>
                      <Trash2 /> {tr("Throw out")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {line.versions.length <= 1 ? (
        <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <History className="size-3.5" /> {tr("Every change becomes a new version here. The original stays untouched.")}
        </p>
      ) : null}
    </div>
  );
}
