"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, CircleSlash, Loader2, Rocket, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { closeAndProcessAction, runToPublishedAction } from "@/app/(newsroom)/editions/[editionId]/actions";
import type { AutopilotResult, AutopilotStepStatus } from "@/server/editorial/autopilot";

const STEP_ICON: Record<AutopilotStepStatus, { icon: typeof Check; className: string }> = {
  done: { icon: Check, className: "text-emerald-600" },
  skipped: { icon: CircleSlash, className: "text-muted-foreground" },
  failed: { icon: X, className: "text-destructive" },
  blocked: { icon: TriangleAlert, className: "text-amber-600" },
};

/**
 * The one-click pilot: closes the collection, runs the AI, writes and approves every article, lays
 * the issue out, exports it and publishes — auto-clearing the gates it is allowed to. Never emails a
 * reader. Shows a step-by-step log of what it did.
 */
export function AutopilotButton({ editionId }: { editionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, startRun] = useTransition();
  const [result, setResult] = useState<AutopilotResult | null>(null);

  const [dirty, setDirty] = useState(false);

  function run(target: "publish" | "organise") {
    setResult(null);
    // Note: we deliberately do NOT router.refresh() here — that would run inside the transition and
    // keep the spinner up through the refresh, hiding the step log. We refresh when the dialog closes.
    startRun(async () => {
      const res = await (target === "publish" ? runToPublishedAction(editionId) : closeAndProcessAction(editionId));
      if (res.ok) {
        setResult(res.data);
        setDirty(true);
        if (res.data.published || res.data.blockers.length === 0) toast.success(res.message ?? "Done");
        else toast.warning(res.message ?? "Stopped early");
      } else {
        toast.error(res.error);
      }
    });
  }

  function onOpenChange(v: boolean) {
    setOpen(v);
    if (!v) {
      setResult(null);
      if (dirty) {
        setDirty(false);
        router.refresh();
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="brand" title="Build the whole issue automatically and publish it">
          <Rocket /> Auto-pilot
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Run the whole issue automatically</DialogTitle>
          <DialogDescription>
            The pilot closes the collection, runs the AI, writes and approves every article, lays the pages out, exports the PDF and DOCX and publishes the issue — clearing the quality gates it is allowed to.
            It never emails anyone. You can stop at editorial review instead and take over by hand.
          </DialogDescription>
        </DialogHeader>

        {running ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-4 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>Building the issue — this can take a minute. Please keep this open…</span>
          </div>
        ) : result ? (
          <div className="space-y-3">
            <ol className="divide-y divide-border overflow-hidden rounded-md border border-border">
              {result.steps.map((step, i) => {
                const { icon: Icon, className } = STEP_ICON[step.status];
                return (
                  <li key={`${step.key}-${i}`} className="flex items-start gap-3 px-3 py-2 text-[13px]">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{step.label}</span>
                      {step.detail ? <span className="block truncate text-2xs text-muted-foreground">{step.detail}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className={`rounded-md px-3 py-2 text-xs ${result.published ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"}`}>
              {result.published
                ? "The issue is published and locked. Nothing was emailed to any reader."
                : result.blockers.length
                  ? `Stopped before publishing. Remaining blockers: ${result.blockers.join(", ")}.`
                  : `Finished at “${result.finalStatus}”.`}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-4 py-4 text-xs text-muted-foreground">
            Tip: fill the edition with the “Simulate returns” button first if it has no submissions yet.
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => run("organise")} loading={running} disabled={running}>
                Organise only
              </Button>
              <Button variant="brand" onClick={() => run("publish")} loading={running} disabled={running}>
                <Rocket /> Build &amp; publish <ChevronRight />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
