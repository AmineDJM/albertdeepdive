"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, ListRestart, Play, RefreshCw, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import type { JobRow } from "@/server/automations/read-queue";

import { cancelJobAction, processQueueAction, retryAllDeadAction, retryJobAction } from "@/app/(newsroom)/automations/actions";
import { DataTable } from "@/components/newsroom/data-table";
import { GenericStatusBadge } from "@/components/newsroom/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUi } from "@/components/i18n/provider";


const RETRYABLE = new Set(["FAILED", "DEAD", "CANCELLED"]);

/**
 * Timestamps are formatted on the server and travel as strings: a relative time recomputed during
 * hydration drifts by a second or two and breaks the render.
 */
export type JobRowView = JobRow & { display: { runAtAgo: string; runAt: string; createdAt: string; finishedAt: string | null } };

function duration(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="label-caps mb-1">{label}</div>
      <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(value ?? null, null, 2)}</pre>
    </div>
  );
}

/**
 * The queue as the worker sees it: running and queued jobs first, then failures. Every failed or
 * dead-lettered job can be inspected (payload, result, error) and put back in the queue.
 */
export function JobQueueTable({ rows, canManage }: { rows: JobRowView[]; canManage: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [inspected, setInspected] = useState<JobRowView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(job: JobRowView, run: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    setBusyId(job.id);
    startTransition(async () => {
      const res = await run();
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Done");
      setInspected(null);
      router.refresh();
    });
  }

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(j) => j.id}
        dense
        empty={{ title: tr("The queue is empty"), description: tr("Background work (invitations, AI processing, media, exports, emails) appears here while it runs and stays visible after it finishes."), icon: ListRestart }}
        columns={[
          { key: "type", header: tr("Job"), cell: (j) => (
              <div className="min-w-0">
                <span className="font-mono text-xs font-medium">{j.type}</span>
                <div className="truncate text-2xs text-muted-foreground">
                  {j.editionLabel ? <Link href={`/editions/${j.editionId}`} className="hover:underline" data-no-row-link>{j.editionLabel}</Link> : "No edition"}
                  {j.createdByName ? ` · ${j.createdByName}` : ""}
                  {j.idempotencyKey ? " · idempotent" : ""}
                </div>
              </div>
            ) },
          { key: "status", header: tr("Status"), cell: (j) => (
              <span className="flex items-center gap-1.5">
                <GenericStatusBadge status={j.status} />
                {j.progress ? <span className="tabular text-2xs text-muted-foreground">{j.progress.done}/{j.progress.total}</span> : null}
              </span>
            ) },
          { key: "attempts", header: tr("Attempts"), cell: (j) => <span className="tabular text-xs">{j.attempts}/{j.maxAttempts}</span>, align: "right" },
          { key: "priority", header: tr("Priority"), cell: (j) => <span className="tabular text-xs text-muted-foreground">{j.priority}</span>, align: "right" },
          { key: "runAt", header: tr("Run at"), cell: (j) => <span className="text-xs text-muted-foreground" title={j.display.runAt}>{j.display.runAtAgo}</span> },
          { key: "duration", header: tr("Duration"), cell: (j) => <span className="tabular text-xs text-muted-foreground">{duration(j.durationMs)}</span>, align: "right" },
          { key: "error", header: tr("Last error"), cell: (j) => (j.lastError ? <span className="line-clamp-1 max-w-[22rem] text-2xs text-destructive" title={j.lastError}>{j.lastError}</span> : <span className="text-2xs text-muted-foreground">—</span>) },
          { key: "actions", header: "", cell: (j) => (
              <span className="flex items-center justify-end gap-1" data-no-row-link>
                <Button size="icon-xs" variant="ghost" aria-label={`Inspect ${j.type}`} onClick={() => setInspected(j)}>
                  <Search />
                </Button>
                {canManage && RETRYABLE.has(j.status) ? (
                  <Button size="xs" variant="outline" loading={pending && busyId === j.id} onClick={() => act(j, () => retryJobAction(j.id))}>
                    <RotateCcw />{" "}{tr("Retry")}</Button>
                ) : null}
                {canManage && j.status === "QUEUED" ? (
                  <Button size="xs" variant="ghost" loading={pending && busyId === j.id} onClick={() => act(j, () => cancelJobAction(j.id))}>
                    <Ban />{" "}{tr("Cancel")}</Button>
                ) : null}
              </span>
            ), align: "right" },
        ]}
      />

      <Dialog open={!!inspected} onOpenChange={(o) => !o && setInspected(null)}>
        <DialogContent size="lg">
          {inspected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 font-mono">
                  {inspected.type}
                  <GenericStatusBadge status={inspected.status} />
                  {inspected.attempts >= inspected.maxAttempts && inspected.status === "DEAD" ? <Badge variant="destructive">{tr("Dead letter")}</Badge> : null}
                </DialogTitle>
                <DialogDescription>
                  {tr("Attempt")}{" "}{inspected.attempts}{" "}{tr("of")}{" "}{inspected.maxAttempts}{" "}{tr("· created")}{" "}{inspected.display.createdAt}{" "}{tr("· run at")}{" "}{inspected.display.runAt}
                  {inspected.display.finishedAt ? ` · finished ${inspected.display.finishedAt}` : ""}
                  {inspected.lockedBy ? ` · worker ${inspected.lockedBy}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {inspected.lastError ? (
                  <div>
                    <div className="label-caps mb-1">{tr("Error")}</div>
                    <p className="max-h-40 overflow-auto rounded-md border border-destructive/30 bg-destructive/10 p-2.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-destructive">{inspected.lastError}</p>
                  </div>
                ) : null}
                <Json label={tr("Payload")} value={inspected.payload} />
                {inspected.result ? <Json label={tr("Result")} value={inspected.result} /> : null}
                {inspected.idempotencyKey ? (
                  <div>
                    <div className="label-caps mb-1">{tr("Idempotency key")}</div>
                    <p className="font-mono text-2xs break-all text-muted-foreground">{inspected.idempotencyKey}</p>
                  </div>
                ) : null}
                {canManage && RETRYABLE.has(inspected.status) ? (
                  <Button size="sm" loading={pending && busyId === inspected.id} onClick={() => act(inspected, () => retryJobAction(inspected.id))}>
                    <RotateCcw />{" "}{tr("Retry this job")}</Button>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Manual refresh plus the two queue-wide controls. */
export function QueueControls({ canManage, retryable }: { canManage: boolean; retryable: number }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"refresh" | "drain" | "retry" | null>(null);

  function run(kind: "refresh" | "drain" | "retry") {
    setAction(kind);
    startTransition(async () => {
      if (kind === "refresh") {
        router.refresh();
        setAction(null);
        return;
      }
      const res = kind === "drain" ? await processQueueAction() : await retryAllDeadAction();
      setAction(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Done");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {canManage && retryable > 0 ? (
        <Button size="sm" variant="outline" loading={pending && action === "retry"} onClick={() => run("retry")}>
          <RotateCcw />{" "}{tr("Retry")}{" "}{retryable}{" "}{tr("failed")}</Button>
      ) : null}
      {canManage ? (
        <Button size="sm" variant="outline" loading={pending && action === "drain"} onClick={() => run("drain")}>
          <Play />{" "}{tr("Process queue")}</Button>
      ) : null}
      <Button size="sm" variant="ghost" loading={pending && action === "refresh"} onClick={() => run("refresh")}>
        <RefreshCw />{" "}{tr("Refresh")}</Button>
    </div>
  );
}
