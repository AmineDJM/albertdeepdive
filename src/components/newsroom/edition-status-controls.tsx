"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { transitionEditionAction } from "@/app/(newsroom)/editions/actions";
import { STATUS_LABELS, type EditionStatus } from "@/lib/editorial/edition-state";
import { useUi } from "@/components/i18n/provider";

export function EditionStatusControls({ editionId, current, options }: { editionId: string; current: EditionStatus; options: readonly EditionStatus[] }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<EditionStatus | null>(null);
  if (!options.length) return null;
  function run(to: EditionStatus) {
    startTransition(async () => {
      const res = await transitionEditionAction(editionId, to);
      if (res.ok) {
        toast.success(res.message ?? "Status updated");
        router.refresh();
      } else toast.error(res.error);
      setConfirm(null);
    });
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" loading={pending}>
            {tr("Move edition")}{" "}<ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{tr("From")}{" "}{STATUS_LABELS[current]}</DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuItem key={o} onSelect={() => setConfirm(o)}>
              → {STATUS_LABELS[o]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("Move edition to “")}{confirm ? STATUS_LABELS[confirm] : ""}”?</AlertDialogTitle>
            <AlertDialogDescription>{tr("This changes the phase for everyone in the newsroom. Automations and quality gates follow the edition status.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && run(confirm)}>{tr("Confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
