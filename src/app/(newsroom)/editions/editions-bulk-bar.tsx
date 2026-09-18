"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { deleteEditionsAction, setEditionsHiddenAction } from "./actions";
import { SelectionBar, useSelection } from "@/components/newsroom/selection";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { ActionResult } from "@/lib/action-result";
import { useUi } from "@/components/i18n/provider";

/**
 * What may be done to several editions at once. Hiding is one click and reversible; deleting asks
 * first and says what goes with them, because "delete" on an edition means its stories, its
 * campaign and its rendered files — not a row.
 */
export function EditionsBulkBar({ canDelete }: { canDelete: boolean }) {
  const tr = useUi();
  const { selected, clear } = useSelection();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const ids = [...selected];

  const run = (action: () => Promise<ActionResult<{ count: number }>>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Done");
      clear();
      router.refresh();
    });

  return (
    <SelectionBar noun={{ one: "edition", other: "editions" }}>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setEditionsHiddenAction(ids, true))}>
        <EyeOff />{" "}{tr("Hide")}</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setEditionsHiddenAction(ids, false))}>
        <Eye />{" "}{tr("Show")}</Button>
      {canDelete ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending} className="text-destructive hover:text-destructive">
              <Trash2 />{" "}{tr("Delete")}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("Delete")}{" "}{ids.length === 1 ? "this edition" : `these ${ids.length} editions`}?</AlertDialogTitle>
              <AlertDialogDescription>
                {tr("Stories, submissions, campaigns, rendered files and the automation history go with")}{" "}{ids.length === 1 ? "it" : "them"}{tr(". Your media library and your contributors stay. This cannot be undone.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("Keep")}{" "}{ids.length === 1 ? "it" : "them"}</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => deleteEditionsAction(ids))}>{tr("Delete")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </SelectionBar>
  );
}
