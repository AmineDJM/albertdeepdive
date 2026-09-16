"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { anonymiseContributorAction, setContributorActiveAction } from "../actions";

export function ContributorDangerZone({ contributorId, isActive }: { contributorId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className="rounded-lg border border-destructive/30 p-4">
      <h3 className="text-[13px] font-semibold">Privacy & account</h3>
      <p className="mt-1 text-xs text-muted-foreground">Deactivating stops invitations. Anonymising removes personal data (GDPR deletion request) while keeping the editorial provenance of past submissions.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" loading={pending} onClick={() => startTransition(async () => { const r = await setContributorActiveAction(contributorId, !isActive); r.ok ? toast.success(r.message) : toast.error(r.error); router.refresh(); })}>
          {isActive ? "Deactivate" : "Reactivate"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">Anonymise personal data</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this contributor's personal data?</AlertDialogTitle>
              <AlertDialogDescription>Name, email, notes and tags will be replaced. This cannot be undone. Submissions remain attributed to an anonymised contributor.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => startTransition(async () => { const r = await anonymiseContributorAction(contributorId); r.ok ? toast.success(r.message) : toast.error(r.error); router.refresh(); })}>Anonymise</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
