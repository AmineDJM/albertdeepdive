"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { deleteContributorsAction, setContributorsActiveAction } from "./actions";
import { SelectionBar, useSelection } from "@/components/newsroom/selection";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { ActionResult } from "@/lib/action-result";
import { useUi } from "@/components/i18n/provider";

/**
 * What may be done to several contributors at once. Hiding is deactivating: they are not invited
 * again and leave the default list, and come back with one click. Deleting asks first and says what
 * stays — what they sent in is the newsroom's record, not theirs.
 */
export function ContributorsBulkBar() {
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
    <SelectionBar noun={{ one: "contributor", other: "contributors" }}>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setContributorsActiveAction(ids, false))}>
        <EyeOff /> {" "}{tr("Hide")}</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setContributorsActiveAction(ids, true))}>
        <Eye /> {" "}{tr("Show")}</Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending} className="text-destructive hover:text-destructive">
            <Trash2 /> {" "}{tr("Delete")}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("Delete")}{" "}{ids.length === 1 ? "this contributor" : `these ${ids.length} contributors`}?</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("Their invitations and pool memberships go. What they sent in stays, with the author cleared, because the record of what was published belongs to the newsroom. To remove personal data while keeping the record, anonymise instead. This cannot be undone.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("Keep")}{" "}{ids.length === 1 ? "them" : "them"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(() => deleteContributorsAction(ids))}>{tr("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SelectionBar>
  );
}
