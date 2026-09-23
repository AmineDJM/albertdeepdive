"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { cn } from "@/lib/utils";
import { RIGHTS_STATUS_LABELS } from "@/lib/constants";
import { RIGHTS_DOT_CLASS, RIGHTS_STATUSES, type RightsStatus } from "@/server/media/constants";
import {
  bulkArchiveAction,
  bulkDeleteAction,
  bulkDescribeAction,
  bulkSetRightsAction,
} from "@/app/(newsroom)/editions/[editionId]/media/actions";
import { useUi } from "@/components/i18n/provider";

export function BulkActionBar({
  editionId,
  ids,
  canManage,
  canRights,
  onDone,
}: {
  editionId: string | null;
  ids: string[];
  canManage: boolean;
  canRights: boolean;
  onDone: () => void;
}) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<RightsStatus | null>(null);
  const [note, setNote] = useState("");
  const n = ids.length;
  const plural = n === 1 ? "asset" : "assets";

  function applyRights() {
    if (!status) return;
    startTransition(async () => {
      const res = await bulkSetRightsAction(editionId, ids, status, note.trim() || null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setStatus(null);
      setNote("");
      onDone();
      router.refresh();
    });
  }

  function archive() {
    startTransition(async () => {
      const res = await bulkArchiveAction(editionId, ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      onDone();
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await bulkDeleteAction(editionId, ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      onDone();
      router.refresh();
    });
  }

  function describe() {
    startTransition(async () => {
      const res = await bulkDescribeAction(editionId, ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      onDone();
      router.refresh();
    });
  }

  return (
    <div
      role="toolbar"
      aria-label={tr("Bulk actions")}
      className="border-border bg-card/95 supports-[backdrop-filter]:bg-card/85 sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 shadow-lg backdrop-blur"
    >
      <span className="tabular text-[13px] font-medium">
        {n} {plural}{" "}{tr("selected")}</span>
      <span className="bg-border mx-1 h-4 w-px" />
      {canRights ? (
        <Popover open={status !== null} onOpenChange={(open) => !open && setStatus(null)}>
          <div className="flex items-center gap-1">
            <span className="label-caps mr-1">{tr("Rights")}</span>
            {RIGHTS_STATUSES.map((st) => (
              <PopoverTrigger asChild key={st}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatus(st)}
                  aria-label={`Set rights to ${RIGHTS_STATUS_LABELS[st]}`}
                  className={cn(status === st && "border-brand")}
                >
                  <span className={cn("size-2 rounded-full", RIGHTS_DOT_CLASS[st])} />
                  {RIGHTS_STATUS_LABELS[st]}
                </Button>
              </PopoverTrigger>
            ))}
          </div>
          <PopoverContent align="start" side="top" className="w-80 space-y-3">
            <div className="text-[13px] font-medium">
              {tr("Set")}{" "}{n} {plural}{" "}{tr("to")}{" "}{status ? RIGHTS_STATUS_LABELS[status] : ""}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-rights-note">{tr("Note (why)")}</Label>
              <Textarea
                id="bulk-rights-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  status === "RED"
                    ? "e.g. person pictured did not consent"
                    : "e.g. contributor confirmed by email on 12 May"
                }
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStatus(null)}>
                {tr("Cancel")}</Button>
              <Button size="sm" loading={pending} onClick={applyRights}>
                {tr("Apply")}</Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      {canManage ? (
        <>
          <span className="bg-border mx-1 h-4 w-px" />
          <Button variant="outline" size="sm" onClick={describe} loading={pending}>
            <Sparkles />{" "}{tr("Describe with AI")}</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Archive />{" "}{tr("Archive")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {tr("Archive")}{" "}{n} {plural}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {tr("Archived assets disappear from the library and the pickers but keep their files, links and history. You can restore them from the Archived filter.")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={archive}>{tr("Archive")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive" loading={pending}>
                <Trash2 />{" "}{tr("Delete")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{n === 1 ? tr("Delete 1 picture for good?") : tr("Delete {count} pictures for good?", { count: n })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tr("The files and every size of them are erased, and they are taken out of the stories and pages that use them. This cannot be undone.")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={remove} className="bg-destructive text-white hover:bg-destructive/90">
                  {tr("Delete")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onDone}
        aria-label={tr("Clear selection")}
      >
        <X />{" "}{tr("Deselect")}</Button>
    </div>
  );
}
