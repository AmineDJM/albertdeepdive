"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, ImagePlus, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";
import type { StudioReply } from "@/server/editorial/edition-studio/converse";
import type { StagedChange } from "@/server/editorial/edition-studio/revisions";
import { applyRevisionAction, discardDraftAction, removeChangeAction, studioSayAction, studioStateAction, undoRevisionAction } from "./actions";

/**
 * The issue, and the conversation about it.
 *
 * Side by side on purpose. An assistant that describes a page you cannot see is asking to be taken
 * on trust; with the issue rendered beside the thread, "page 6 is a fifth full" is something you
 * check in a glance. The preview is the same address the printer's proof comes from, so it is the
 * issue rather than a drawing of it.
 */

type Uploaded = { id: string; fileName: string };

export function ReviseWorkbench({ editionId, initial }: { editionId: string; initial: StudioReply }) {
  const tr = useUi();
  const router = useRouter();
  const [state, setState] = useState<StudioReply>(initial);
  const [message, setMessage] = useState("");
  const [attached, setAttached] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  // Bumped after anything that changes the paper, so the proof beside the thread is never stale.
  const [proofKey, setProofKey] = useState(0);
  const threadEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [state.turns.length]);

  const refresh = useCallback(async () => {
    const next = await studioStateAction(editionId);
    if (next.ok) setState(next.data);
    setProofKey((k) => k + 1);
    router.refresh();
  }, [editionId, router]);

  const draft = state.revisions.draft;
  const waiting = draft?.changes ?? [];
  const allowance = state.revisions.allowance;
  const spent = allowance.limit !== null && !allowance.allowed;

  function send() {
    const said = message.trim();
    if (!said) return;
    startTransition(async () => {
      const result = await studioSayAction(editionId, said, attached.map((a) => a.id));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setState(result.data);
      setMessage("");
      setAttached([]);
      // Saying "apply it" spends the revision there and then, so the proof beside the thread is a
      // picture of the issue as it was a moment ago until this runs.
      if (result.data.turns.at(-1)?.intent === "apply") {
        setProofKey((k) => k + 1);
        router.refresh();
      }
    });
  }

  async function upload(files: FileList | File[]) {
    const list = [...files].filter((file) => file.type.startsWith("image/"));
    if (!list.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const file of list) form.append("file", file, file.name);
      form.append("editionId", editionId);
      const response = await fetch("/api/uploads", { method: "POST", body: form });
      const body = (await response.json()) as { assets?: Uploaded[]; error?: string };
      if (!response.ok || !body.assets?.length) throw new Error(body.error ?? tr("The photographs would not upload"));
      setAttached((current) => [...current, ...body.assets!.map((a) => ({ id: a.id, fileName: a.fileName }))]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function remove(changeId: string) {
    startTransition(async () => {
      const result = await removeChangeAction(editionId, changeId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      await refresh();
    });
  }

  function discard() {
    startTransition(async () => {
      const result = await discardDraftAction(editionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? tr("The list is empty again"));
      await refresh();
    });
  }

  function apply() {
    startTransition(async () => {
      const result = await applyRevisionAction(editionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? tr("Done"));
      await refresh();
    });
  }

  function undo(revisionId: string) {
    startTransition(async () => {
      const result = await undoRevisionAction(editionId, revisionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? tr("Put back the way it was"));
      await refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm">{tr("The issue as it stands")}</CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary">{tr("{n} pages", { n: state.snapshot.edition.pages })}</Badge>
            <Button asChild size="sm" variant="ghost">
              <a href={`/print/edition/${editionId}`} target="_blank" rel="noreferrer">
                {tr("Open")} <ExternalLink />
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <iframe
            key={proofKey}
            src={`/print/edition/${editionId}`}
            title={tr("The issue as it stands")}
            className="h-[38rem] w-full border-0 bg-white lg:h-[46rem]"
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm">{tr("Waiting to be applied")}</CardTitle>
            <span className="text-2xs text-muted-foreground">
              {allowance.limit === null
                ? tr("no limit on this plan")
                : tr("{left} left on this issue", { left: allowance.remaining ?? 0 })}
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {!waiting.length ? (
              <>
                <p className="text-xs text-muted-foreground">{tr("Nothing yet. Ask for a change below and it lands here first — nothing happens to the issue until you apply the list.")}</p>
                {/* Asking is not the only way. The pages and the copy are editable by hand next door,
                    and saying so here is cheaper than letting somebody conclude the chat is the only door. */}
                <p className="text-2xs text-muted-foreground">
                  {tr("Rather do it yourself?")}{" "}
                  <a className="underline underline-offset-2" href={`/editions/${editionId}/layout`}>
                    {tr("Move the pages")}
                  </a>{" "}
                  {tr("or")}{" "}
                  <a className="underline underline-offset-2" href={`/editions/${editionId}/articles`}>
                    {tr("edit the words")}
                  </a>
                  {tr(" — neither costs a revision.")}
                </p>
              </>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {waiting.map((change: StagedChange) => (
                    <li key={change.id} className="flex items-start gap-2 rounded-lg border border-border p-2">
                      {change.notable ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> : <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="min-w-0 flex-1 text-xs">{tr(change.text, change.values)}</span>
                      <Button size="icon-sm" variant="ghost" disabled={pending} onClick={() => remove(change.id)} aria-label={tr("Take this off the list")}>
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={apply} loading={pending} disabled={spent}>
                    <Sparkles /> {tr("Apply the list")}</Button>
                  <Button size="sm" variant="ghost" onClick={discard} disabled={pending}>
                    <Trash2 /> {tr("Clear")}</Button>
                </div>
                <p className="text-2xs text-muted-foreground">
                  {spent
                    ? (allowance.message ?? tr("This issue has used every revision your plan includes."))
                    : `${tr("Applying runs all of it at once, re-measures the issue and remakes the formats. That is one revision.")} ${tr("Say “apply” when you are ready, or press the button.")}`}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm">{tr("Ask for a change")}</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="max-h-[22rem] min-h-[8rem] flex-1 space-y-2.5 overflow-y-auto pr-1">
              {!state.turns.length ? (
                <p className="text-xs text-muted-foreground">
                  {tr("Say it the way you would to a colleague: “it's too dense, nobody will read it”, “the cover interview deserves more room”, or drop photographs in and say where they go.")}
                </p>
              ) : (
                state.turns.map((turn) => (
                  <div
                    key={turn.id}
                    className={cn(
                      "rounded-lg px-2.5 py-2 text-xs",
                      turn.role === "user" ? "bg-muted/60" : "border border-border",
                      // A turn that spent a revision is not a remark, and reads as its own event.
                      turn.intent === "apply" ? "border-brand bg-brand-soft/30" : null,
                      turn.intent === "confirm" ? "border-warning" : null,
                    )}
                  >
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                    {turn.operations.length ? (
                      <p className="mt-1 text-2xs text-muted-foreground">{tr("{n} added to the list", { n: turn.operations.length })}</p>
                    ) : null}
                    {turn.intent === "apply" ? <p className="mt-1 text-2xs text-brand">{tr("Applied from here")}</p> : null}
                    {turn.intent === "confirm" ? <p className="mt-1 text-2xs text-warning">{tr("Waiting on your yes")}</p> : null}
                  </div>
                ))
              )}
              <div ref={threadEnd} />
            </div>

            <Separator />

            {attached.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {attached.map((asset) => (
                  <li key={asset.id}>
                    <Badge variant="secondary" className="gap-1">
                      {asset.fileName}
                      <button type="button" onClick={() => setAttached((current) => current.filter((a) => a.id !== asset.id))} aria-label={tr("Remove")}>
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void upload(e.dataTransfer.files);
              }}
              className={cn("rounded-lg border border-dashed p-1.5 transition-colors", dragging ? "border-brand bg-brand-soft/40" : "border-border")}
            >
              <Textarea
                value={message}
                disabled={pending}
                rows={3}
                placeholder={tr("What should change?")}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                }}
                className="border-0 bg-transparent focus-visible:ring-0"
              />
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <div className="flex items-center gap-1.5">
                  <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
                  <Button size="sm" variant="ghost" loading={uploading} onClick={() => fileInput.current?.click()}>
                    <ImagePlus /> {tr("Photographs")}</Button>
                  <span className="text-2xs text-muted-foreground">{tr("or drop them here")}</span>
                </div>
                <Button size="sm" onClick={send} loading={pending} disabled={!message.trim()}>
                  <Send /> {tr("Send")}</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {state.revisions.history.length ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{tr("Revisions on this issue")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.revisions.history.map((revision) => (
                <div key={revision.id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {revision.status === "APPLIED" ? tr("Revision {n}", { n: revision.number ?? 0 }) : tr("A revision that did not go through")}
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      {tr("{n} change(s)", { n: revision.changes.length })}
                      {revision.pagesBefore !== null && revision.pagesAfter !== null && revision.pagesBefore !== revision.pagesAfter
                        ? ` · ${tr("{before} → {after} pages", { before: revision.pagesBefore, after: revision.pagesAfter })}`
                        : null}
                    </p>
                    {revision.rerenders.map((line, i) => (
                      <p key={i} className="text-2xs text-muted-foreground">
                        {line.subject}: {line.detail}
                      </p>
                    ))}
                    {revision.error ? <p className="text-2xs text-destructive">{revision.error}</p> : null}
                  </div>
                  {revision.restorePointId ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => undo(revision.id)}>
                      <RotateCcw /> {tr("Undo")}</Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
