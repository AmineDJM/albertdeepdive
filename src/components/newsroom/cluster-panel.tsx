"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { createAllStoriesAction, createStoryFromClusterAction, dismissClusterAction, mergeClustersAction } from "@/app/(newsroom)/editions/[editionId]/stories/actions";
import { truncate } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type PendingCluster = { id: string; title: string; status: string; score: number | null; members: { id: string; title: string }[] };

/**
 * Clusters waiting to become stories. Editors can merge two clusters that describe the same event,
 * dismiss noise, or promote a cluster to a story candidate.
 */
export function ClusterPanel({ editionId, clusters, canEdit }: { editionId: string; clusters: PendingCluster[]; canEdit: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        setSelected(new Set());
        router.refresh();
      } else toast.error(res.error ?? "Failed");
    });
  }

  return (
    <aside className="h-fit rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="label-caps flex items-center gap-1.5">
          <Layers className="size-3.5" /> {" "}{tr("Clusters without a story")}</span>
        <span className="tabular text-2xs text-muted-foreground">{clusters.length}</span>
      </div>

      {clusters.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">{tr("Every cluster has become a story.")}</p>
      ) : (
        <>
          <ul className="max-h-[520px] divide-y overflow-y-auto scrollbar-thin">
            {clusters.map((c) => (
              <li key={c.id} className="px-3 py-2">
                <div className="flex items-start gap-2">
                  {canEdit ? (
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.has(c.id)}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (v === true) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        })
                      }
                      aria-label={`Select ${c.title}`}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{truncate(c.title, 60)}</p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {c.members.length} {" "}{tr("source")}{c.members.length === 1 ? "" : "s"}
                      {c.score !== null ? ` · score ${c.score}` : ""}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {c.members.slice(0, 3).map((m) => (
                        <li key={m.id} className="truncate text-2xs text-muted-foreground">
                          · {truncate(m.title, 46)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Badge variant={c.status === "CONFIRMED" ? "success" : "info"}>{c.status === "CONFIRMED" ? "Confirmed" : "Proposed"}</Badge>
                </div>
                {canEdit ? (
                  <div className="mt-1.5 flex gap-1">
                    <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => createStoryFromClusterAction(editionId, c.id))}>
                      <Plus /> {" "}{tr("Make story")}</Button>
                    <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => dismissClusterAction(editionId, c.id))} title={tr("Dismiss")}>
                      <X />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {canEdit ? (
            <div className="flex flex-wrap gap-1.5 border-t px-3 py-2">
              {selected.size >= 2 ? (
                <Button size="xs" variant="outline" loading={pending} onClick={() => run(() => mergeClustersAction(editionId, [...selected]))}>
                  {tr("Merge")}{" "}{selected.size}
                </Button>
              ) : null}
              <Button size="xs" variant="brand" loading={pending} onClick={() => run(() => createAllStoriesAction(editionId))}>
                <Sparkles /> {" "}{tr("Create all stories")}</Button>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
