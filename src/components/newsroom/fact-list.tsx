"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addFactAction, rejectFactAction, resolveConflictAction, verifyFactAction } from "@/app/(newsroom)/stories/[storyId]/actions";
import { cn, enumLabel, truncate } from "@/lib/utils";

export type FactItem = {
  id: string;
  statement: string;
  category: string | null;
  confidence: string;
  status: string;
  sourceSubmissionId: string | null;
  sourceExcerpt: string | null;
  notes: string | null;
  conflictGroup: string | null;
};

const CONFIDENCE_TONE: Record<string, "success" | "info" | "warning" | "destructive" | "muted"> = {
  VERIFIED_BY_SUBMISSION: "success",
  EDITOR_VERIFIED: "success",
  STATED_BY_CONTRIBUTOR: "info",
  INFERRED: "warning",
  CONFLICTING: "destructive",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  VERIFIED_BY_SUBMISSION: "Verified by sources",
  EDITOR_VERIFIED: "Verified by an editor",
  STATED_BY_CONTRIBUTOR: "Stated by a contributor",
  INFERRED: "Inferred",
  CONFLICTING: "Sources disagree",
};

/**
 * The fact sheet: every statement with the submission that supports it. Conflicts are never
 * resolved automatically — an editor picks the version that goes to print and says why.
 */
export function FactList({ storyId, facts, submissions, canEdit }: { storyId: string; facts: FactItem[]; submissions: { id: string; title: string; contributorName: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newFact, setNewFact] = useState("");
  const [adding, setAdding] = useState(false);
  const sourceById = new Map(submissions.map((s) => [s.id, s]));
  const active = facts.filter((f) => f.status !== "REJECTED");
  const conflictGroups = new Map<string, FactItem[]>();
  for (const f of active) if (f.conflictGroup) conflictGroups.set(f.conflictGroup, [...(conflictGroups.get(f.conflictGroup) ?? []), f]);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        router.refresh();
      } else toast.error(res.error ?? "Failed");
    });
  }

  if (!active.length) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No facts extracted yet. Run the AI processing to build the fact sheet from the sources.</p>;
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {active.map((fact) => {
          const source = fact.sourceSubmissionId ? sourceById.get(fact.sourceSubmissionId) : null;
          const disputed = fact.status === "DISPUTED" || fact.confidence === "CONFLICTING";
          const rivals = fact.conflictGroup ? (conflictGroups.get(fact.conflictGroup) ?? []).filter((f) => f.id !== fact.id) : [];
          return (
            <li key={fact.id} className={cn("rounded-lg border bg-card px-3 py-2", disputed ? "border-destructive/40 bg-destructive/5" : "border-border")}>
              <div className="flex items-start gap-2">
                {disputed ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">{fact.statement}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant={CONFIDENCE_TONE[fact.confidence] ?? "muted"}>{CONFIDENCE_LABEL[fact.confidence] ?? enumLabel(fact.confidence)}</Badge>
                    {fact.category ? <Badge variant="outline">{enumLabel(fact.category)}</Badge> : null}
                    {fact.status === "RESOLVED" ? <Badge variant="success">Resolved</Badge> : null}
                    {source ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help text-2xs text-muted-foreground underline decoration-dotted">{truncate(source.title, 38)}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">{source.contributorName}</p>
                          {fact.sourceExcerpt ? <p className="mt-1 max-w-xs italic">&ldquo;{fact.sourceExcerpt}&rdquo;</p> : null}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-2xs text-muted-foreground">No source recorded</span>
                    )}
                  </div>
                  {fact.notes ? <p className="mt-1 text-2xs text-muted-foreground">{fact.notes}</p> : null}
                  {disputed && rivals.length ? (
                    <div className="mt-1.5 rounded-md border border-border bg-card p-2">
                      <p className="label-caps">Conflicting version{rivals.length > 1 ? "s" : ""}</p>
                      {rivals.map((r) => (
                        <div key={r.id} className="mt-1 flex items-start justify-between gap-2">
                          <p className="text-xs">{r.statement}</p>
                          {canEdit ? (
                            <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => resolveConflictAction(storyId, fact.id, r.id, "Editor chose this version"))}>
                              Keep this
                            </Button>
                          ) : null}
                        </div>
                      ))}
                      {canEdit ? (
                        <Button size="xs" variant="outline" className="mt-1.5" disabled={pending} onClick={() => run(() => resolveConflictAction(storyId, fact.id, fact.id, "Editor confirmed this version"))}>
                          Keep the statement above
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {canEdit && !disputed ? (
                  <div className="flex shrink-0 gap-1">
                    {fact.confidence !== "EDITOR_VERIFIED" ? (
                      <Button size="icon-xs" variant="ghost" title="Mark as verified" aria-label="Mark as verified" disabled={pending} onClick={() => run(() => verifyFactAction(storyId, fact.id))}>
                        <ShieldCheck />
                      </Button>
                    ) : (
                      <Check className="size-3.5 text-success" />
                    )}
                    <Button size="icon-xs" variant="ghost" title="Reject this fact" aria-label="Reject this fact" disabled={pending} onClick={() => run(() => rejectFactAction(storyId, fact.id))}>
                      <X />
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {canEdit ? (
        adding ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newFact.trim()) return;
              run(async () => {
                const res = await addFactAction(storyId, newFact);
                if (res.ok) {
                  setNewFact("");
                  setAdding(false);
                }
                return res;
              });
            }}
          >
            <Input value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="A fact you verified yourself…" className="text-xs" autoFocus />
            <Button size="sm" type="submit" loading={pending}>
              Add
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
            Add a verified fact
          </Button>
        )
      ) : null}
    </div>
  );
}
