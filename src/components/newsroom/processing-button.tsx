"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { runProcessingNowAction } from "@/app/(newsroom)/editions/[editionId]/inbox/actions";

/**
 * Runs the AI pipeline for the edition: normalise, classify, extract, deduplicate, cluster, build
 * fact sheets, score and create story candidates. Nothing is published; editors decide next.
 */
export function ProcessingButton({ editionId, unprocessed, label = "Run AI processing", variant = "default" }: { editionId: string; unprocessed: number; label?: string; variant?: "default" | "outline" | "brand" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await runProcessingNowAction(editionId);
      if (res.ok) {
        toast.success("AI processing finished", { description: res.message });
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" variant={variant} loading={pending} onClick={() => setOpen(true)}>
        <Sparkles /> {label}
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run the AI pipeline for this edition?</AlertDialogTitle>
            <AlertDialogDescription>
              {unprocessed > 0 ? `${unprocessed} submission${unprocessed === 1 ? "" : "s"} will be normalised, classified and checked for duplicates. ` : "Already processed submissions are skipped. "}
              Submissions are then grouped into story clusters with a sourced fact sheet, scored and turned into story candidates. Nothing is written or published without you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                run();
              }}
            >
              {pending ? "Processing…" : "Run processing"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
