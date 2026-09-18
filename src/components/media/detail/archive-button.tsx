"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
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
import { archiveAction, restoreAction } from "@/app/(newsroom)/media/[mediaId]/actions";
import { useUi } from "@/components/i18n/provider";

export function ArchiveButton({
  assetId,
  editionId,
  isArchived,
  usedIn,
}: {
  assetId: string;
  editionId: string | null;
  isArchived: boolean;
  usedIn: number;
}) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(fn: typeof archiveAction) {
    startTransition(async () => {
      const res = await fn(assetId, editionId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }
  if (isArchived) {
    return (
      <Button variant="outline" size="sm" loading={pending} onClick={() => run(restoreAction)}>
        <ArchiveRestore /> {" "}{tr("Restore")}</Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" loading={pending}>
          <Archive /> {" "}{tr("Archive")}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("Archive this asset?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {tr("It disappears from the library and the pickers but keeps its files, story links and history.")}{" "}{usedIn
              ? ` It is currently used in ${usedIn} stor${usedIn === 1 ? "y" : "ies"}; detach it first if it must not be exported.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => run(archiveAction)}>{tr("Archive")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
