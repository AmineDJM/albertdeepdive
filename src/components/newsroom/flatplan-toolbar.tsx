"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { regeneratePlanAction, runCopyfitAction } from "@/app/(newsroom)/editions/[editionId]/layout/actions";

/**
 * The two things an editor triggers from the flatplan: re-running the page allocation (which pages
 * exist, in which order, with which template) and re-running the print engine's copyfit pass (how
 * the text actually flows on those pages).
 */
export function FlatplanToolbar({ editionId, lockedPages, planned, onlyPlan = false }: { editionId: string; lockedPages: number; planned: number; onlyPlan?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [includeCandidates, setIncludeCandidates] = useState(false);
  const [busy, setBusy] = useState<"plan" | "copyfit" | null>(null);

  function regenerate() {
    setBusy("plan");
    startTransition(async () => {
      const result = await regeneratePlanAction(editionId, includeCandidates);
      setBusy(null);
      if (result.ok) {
        toast.success(result.message ?? "Plan regenerated", {
          description: result.data.warnings[0] ?? "The copyfit pass runs again as the flatplan reloads.",
        });
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function copyfit() {
    setBusy("copyfit");
    startTransition(async () => {
      const result = await runCopyfitAction(editionId);
      setBusy(null);
      if (result.ok) {
        toast.success("Copyfit pass finished", { description: result.message });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      {onlyPlan ? null : (
        <Button size="sm" variant="outline" onClick={copyfit} loading={pending && busy === "copyfit"} disabled={pending}>
          <RefreshCw /> Run copyfit
        </Button>
      )}
      <Button size="sm" variant="brand" onClick={() => setOpen(true)} disabled={pending} loading={pending && busy === "plan"}>
        <Wand2 /> Re-plan pages
      </Button>
      {onlyPlan ? null : (
        <Button asChild size="sm" variant="ghost">
          <a href={`/print/edition/${editionId}`} target="_blank" rel="noreferrer">
            Print preview <ExternalLink />
          </a>
        </Button>
      )}

      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild the page allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              The deterministic allocator rebuilds the whole flatplan from the sections and the selected stories: cover, contents, one page per story (short items packed
              two to four per news page), Business Deep Dives kept together, and a back page.
              {lockedPages > 0
                ? lockedPages === 1
                  ? " One locked page keeps its number and its story; everything else is re-flowed around it."
                  : ` ${lockedPages} locked pages keep their number and their story; everything else is re-flowed around them.`
                : ` No page is locked, so the current plan (${planned} pages) is replaced entirely. Lock a page first to keep it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5">
            <Checkbox id="include-candidates" checked={includeCandidates} onCheckedChange={(value) => setIncludeCandidates(value === true)} />
            <Label htmlFor="include-candidates" className="text-xs leading-snug font-normal">
              Also place story candidates that have not been selected yet
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                regenerate();
              }}
            >
              {pending && busy === "plan" ? "Re-planning…" : "Re-plan pages"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
