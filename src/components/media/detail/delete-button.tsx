"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteAction } from "@/app/(newsroom)/media/[mediaId]/actions";
import { useUi } from "@/components/i18n/provider";

/** Deletes the picture for good, after saying what goes with it, then goes back to the library. */
export function DeleteButton({ assetId, editionId, usedIn }: { assetId: string; editionId: string | null; usedIn: number }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run() {
    startTransition(async () => {
      const res = await deleteAction(assetId, editionId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(editionId ? `/editions/${editionId}/media` : "/library");
      router.refresh();
    });
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" loading={pending} className="text-destructive">
          <Trash2 />{" "}{tr("Delete")}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("Delete this picture for good?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {tr("The file and every size of it are erased. This cannot be undone.")}{" "}
            {usedIn === 1 ? tr("It is taken out of the 1 story that uses it.") : usedIn > 1 ? tr("It is taken out of the {count} stories that use it.", { count: usedIn }) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={run} className="bg-destructive text-white hover:bg-destructive/90">
            {tr("Delete")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
