"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Palette, RefreshCw, Trash2 } from "lucide-react";
import { deletePackAction, recomposeAction, renderPackAction } from "../actions";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

/**
 * What you can do to a finished pack.
 *
 * "Set in my current brand" is the one worth having: change an accent colour in Brand settings and
 * every pack ever made can be brought up to date without a model call and without anybody rewriting
 * a headline. The words are the brief; the look is the brand; they are separate on purpose.
 */
export function PackControls({ packId, status, hasBrief }: { packId: string; status: string; hasBrief: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "That did not work");
        return;
      }
      if (result.message) toast.success(result.message);
      if (after) after();
      else router.refresh();
    });

  return (
    <div className="flex items-center gap-2">
      {hasBrief ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => recomposeAction(packId))}>
          <Palette /> Set in my current brand
        </Button>
      ) : null}
      <Button variant="outline" size="sm" disabled={pending || status === "RENDERING"} onClick={() => run(() => renderPackAction(packId))}>
        <RefreshCw /> {status === "RENDERING" ? "Rendering…" : "Render again"}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Delete pack" disabled={pending}>
            <Trash2 />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pack?</AlertDialogTitle>
            <AlertDialogDescription>The frames and the caption go with it. Your edition and your photographs are untouched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(() => deletePackAction(packId), () => router.push("/studio"))}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
