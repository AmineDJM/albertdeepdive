"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { anonymiseContributorAction, setContributorActiveAction } from "../actions";
import { useUi } from "@/components/i18n/provider";

export function ContributorDangerZone({ contributorId, isActive }: { contributorId: string; isActive: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className="rounded-lg border border-destructive/30 p-4">
      <h3 className="text-[13px] font-semibold">{tr("Privacy & account")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{tr("Deactivating stops invitations. Anonymising removes personal data (GDPR deletion request) while keeping the editorial provenance of past submissions.")}</p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" loading={pending} onClick={() => startTransition(async () => { const r = await setContributorActiveAction(contributorId, !isActive); if (r.ok) toast.success(r.message); else toast.error(r.error); router.refresh(); })}>
          {isActive ? "Deactivate" : "Reactivate"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">{tr("Anonymise personal data")}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("Remove this contributor's personal data?")}</AlertDialogTitle>
              <AlertDialogDescription>{tr("Name, email, notes and tags will be replaced. This cannot be undone. Submissions remain attributed to an anonymised contributor.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => startTransition(async () => { const r = await anonymiseContributorAction(contributorId); if (r.ok) toast.success(r.message); else toast.error(r.error); router.refresh(); })}>{tr("Anonymise")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
