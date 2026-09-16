"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, GitCompare, Lock, Play, RefreshCw, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { compareVersionsAction, downloadAssetAction, requestExportAction, retryRenderAction } from "@/app/(newsroom)/editions/[editionId]/exports/actions";
import type { PublicationKind } from "@/server/publication/versions";
import { formatBytes } from "@/server/media/constants";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";

export type VersionView = {
  id: string;
  label: string;
  kind: string;
  status: string;
  sequence: number;
  isImmutable: boolean;
  notes: string | null;
  createdAt: Date;
  createdByName: string | null;
  pageCount: number | null;
  renderMs: number | null;
  renderLog: { at: string; level: string; message: string }[];
  layoutStats: Record<string, number> | null;
  assets: { id: string; kind: string; fileName: string; sizeBytes: number | null; pageCount: number | null }[];
};

const STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "muted" | "info"> = {
  READY: "success",
  RENDERING: "info",
  PENDING: "warning",
  FAILED: "destructive",
  SUPERSEDED: "muted",
};

const KIND_LABELS: Record<PublicationKind, string> = {
  DRAFT: "Draft",
  EDITORIAL_REVIEW: "Editorial review",
  FINAL_REVIEW: "Final review",
  PUBLISHED: "Published (v1.0)",
};

export function ExportPanel({
  editionId,
  versions,
  allowedKinds,
  canRun,
}: {
  editionId: string;
  versions: VersionView[];
  allowedKinds: PublicationKind[];
  canRun: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<PublicationKind>(allowedKinds[0] ?? "DRAFT");
  const [notes, setNotes] = useState("");
  const [logFor, setLogFor] = useState<VersionView | null>(null);
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof compareVersionsAction>> | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        router.refresh();
      } else toast.error(res.error ?? "Failed");
    });
  }

  function download(assetId: string) {
    startTransition(async () => {
      const res = await downloadAssetAction(assetId);
      if (res.ok) window.location.href = res.data.url;
      else toast.error(res.error);
    });
  }

  function runCompare() {
    if (!compare) return;
    startTransition(async () => {
      const res = await compareVersionsAction(compare.a, compare.b);
      setComparison(res);
      if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {canRun ? (
        <section className="rounded-lg border border-border bg-card p-3.5">
          <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="export-kind">Version type</Label>
              <NativeSelect id="export-kind" value={kind} onChange={(e) => setKind(e.target.value as PublicationKind)}>
                {allowedKinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-notes">What changed (optional)</Label>
              <Textarea id="export-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} placeholder="Second pass after the Carrefour corrections" />
            </div>
            <Button
              variant="brand"
              loading={pending}
              onClick={() =>
                run(async () => {
                  const res = await requestExportAction(editionId, kind, notes);
                  if (res.ok) setNotes("");
                  return res;
                })
              }
            >
              <Play /> Generate PDF and DOCX
            </Button>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground">
            Both files are rendered from one snapshot of the edition, so the PDF and the Word document always describe the same issue.
          </p>
        </section>
      ) : null}

      <ul className="space-y-2.5">
        {versions.map((v) => {
          const pdf = v.assets.find((a) => a.kind === "PDF");
          const docx = v.assets.find((a) => a.kind === "DOCX");
          return (
            <li key={v.id} data-version={v.label} className="rounded-lg border border-border bg-card p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular text-sm font-semibold">{v.label}</span>
                <Badge variant={STATUS_TONE[v.status] ?? "muted"}>{v.status.toLowerCase()}</Badge>
                <Badge variant="outline">{KIND_LABELS[v.kind as PublicationKind] ?? v.kind}</Badge>
                {v.isImmutable ? (
                  <Badge variant="brand" className="gap-1">
                    <Lock className="size-2.5" /> Immutable
                  </Badge>
                ) : null}
                <span className="ml-auto text-2xs text-muted-foreground">
                  {v.createdByName ?? "System"} · {relativeTime(v.createdAt)}
                </span>
              </div>

              {v.notes ? <p className="mt-1.5 text-xs text-muted-foreground">{v.notes}</p> : null}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                {v.pageCount ? <span className="tabular">{v.pageCount} pages</span> : null}
                {v.renderMs ? <span className="tabular">rendered in {(v.renderMs / 1000).toFixed(1)}s</span> : null}
                {v.layoutStats?.continuationPagesAdded ? <span className="tabular">{v.layoutStats.continuationPagesAdded} continuation pages</span> : null}
                {v.layoutStats?.paragraphsSplit ? <span className="tabular">{v.layoutStats.paragraphsSplit} paragraphs split</span> : null}
                <span>{formatDateTime(v.createdAt)}</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {pdf ? (
                  <Button size="xs" variant="outline" disabled={pending} onClick={() => download(pdf.id)}>
                    <Download /> PDF
                    <span className="text-muted-foreground">{pdf.sizeBytes ? formatBytes(pdf.sizeBytes) : ""}</span>
                  </Button>
                ) : null}
                {docx ? (
                  <Button size="xs" variant="outline" disabled={pending} onClick={() => download(docx.id)}>
                    <FileText /> DOCX
                    <span className="text-muted-foreground">{docx.sizeBytes ? formatBytes(docx.sizeBytes) : ""}</span>
                  </Button>
                ) : null}
                {canRun && v.status === "FAILED" && !v.isImmutable ? (
                  <Button size="xs" variant="outline" loading={pending} onClick={() => run(() => retryRenderAction(editionId, v.id))}>
                    <RefreshCw /> Render again
                  </Button>
                ) : null}
                {canRun && v.status === "PENDING" && !v.isImmutable ? (
                  <Button size="xs" variant="outline" loading={pending} onClick={() => run(() => retryRenderAction(editionId, v.id))}>
                    <Play /> Render now
                  </Button>
                ) : null}
                {v.renderLog.length ? (
                  <Button size="xs" variant="ghost" onClick={() => setLogFor(v)}>
                    <ScrollText /> Render log ({v.renderLog.length})
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {versions.length > 1 ? (
        <section className="rounded-lg border border-border bg-card p-3.5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cmp-a">Compare</Label>
              <NativeSelect id="cmp-a" className="w-40" value={compare?.a ?? versions[1].id} onChange={(e) => setCompare((c) => ({ a: e.target.value, b: c?.b ?? versions[0].id }))}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-b">with</Label>
              <NativeSelect id="cmp-b" className="w-40" value={compare?.b ?? versions[0].id} onChange={(e) => setCompare((c) => ({ a: c?.a ?? versions[1].id, b: e.target.value }))}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={pending}
              onClick={() => {
                if (!compare) setCompare({ a: versions[1].id, b: versions[0].id });
                runCompare();
              }}
            >
              <GitCompare /> Compare
            </Button>
          </div>
          {comparison?.ok ? (
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <Diff label="Articles added" items={comparison.data.articlesAdded.map((a) => a.headline)} />
              <Diff label="Articles removed" items={comparison.data.articlesRemoved.map((a) => a.headline)} />
              <Diff label="Headlines changed" items={comparison.data.headlineChanges.map((h) => `${h.from} → ${h.to}`)} />
              <div>
                <dt className="label-caps">Size</dt>
                <dd className="tabular mt-1 text-muted-foreground">
                  {signed(comparison.data.pageCountChange)} pages, {signed(comparison.data.wordCountChange)} words
                </dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}

      <Dialog open={!!logFor} onOpenChange={(v) => !v && setLogFor(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Render log — {logFor?.label}</DialogTitle>
            <DialogDescription>Every step the renderer recorded for this version.</DialogDescription>
          </DialogHeader>
          <ol className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-2xs">
            {logFor?.renderLog.map((entry, i) => (
              <li key={i} className={cn("flex gap-2", entry.level === "error" && "text-destructive", entry.level === "warn" && "text-warning")}>
                <span className="shrink-0 text-muted-foreground">{new Date(entry.at).toLocaleTimeString("en-GB")}</span>
                <span className="break-all">{entry.message}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

function Diff({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <dt className="label-caps">
        {label} <span className="tabular">({items.length})</span>
      </dt>
      <dd className="mt-1 space-y-0.5 text-muted-foreground">
        {items.length ? items.map((t, i) => <p key={i}>{t}</p>) : <p>None</p>}
      </dd>
    </div>
  );
}
