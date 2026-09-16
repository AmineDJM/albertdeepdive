"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowRight, BookCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { archiveEditionAction, moveEditionStatusAction, publishEditionAction } from "@/app/(newsroom)/editions/[editionId]/qa/actions";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { enumLabel } from "@/lib/utils";

export function PublishControls({
  editionId,
  status,
  nextStatuses,
  publishableVersions,
  blockingCount,
  canPublish,
  canEdit,
}: {
  editionId: string;
  status: EditionStatus;
  nextStatuses: readonly EditionStatus[];
  publishableVersions: { id: string; label: string }[];
  blockingCount: number;
  canPublish: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [versionId, setVersionId] = useState(publishableVersions[0]?.id ?? "");
  const [nextStatus, setNextStatus] = useState<EditionStatus | "">(nextStatuses.find((s) => s !== "ARCHIVED") ?? "");

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        router.refresh();
      } else toast.error(res.error ?? "Failed");
    });
  }

  const ready = blockingCount === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && nextStatuses.length ? (
        <>
          <NativeSelect aria-label="Move the edition to" className="h-8 w-44 text-xs" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as EditionStatus)}>
            {nextStatuses.map((s) => (
              <option key={s} value={s}>
                {enumLabel(s)}
              </option>
            ))}
          </NativeSelect>
          <Button size="sm" variant="outline" disabled={pending || !nextStatus} onClick={() => nextStatus && run(() => moveEditionStatusAction(editionId, nextStatus))}>
            Move on <ArrowRight />
          </Button>
        </>
      ) : null}

      {canPublish && status === "FINAL_REVIEW" ? (
        publishableVersions.length ? (
          <>
            <NativeSelect aria-label="Version to publish" className="h-8 w-32 text-xs" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              {publishableVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </NativeSelect>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="brand" disabled={pending || !versionId || !ready}>
                  <BookCheck /> Publish the issue
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Publish this issue?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The version becomes immutable and the edition moves to published. Later corrections need a new edition or a new version, so check the PDF one last time first.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction onClick={() => run(() => publishEditionAction(editionId, versionId))}>Publish</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <ShieldAlert className="size-3.5" /> Generate a v1.0 published version on the exports tab first.
          </span>
        )
      ) : null}

      {canPublish && status === "PUBLISHED" ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>
              <Archive /> Move to the archive
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this issue?</AlertDialogTitle>
              <AlertDialogDescription>It stays readable and downloadable in the archive, but it is closed to further editing.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => archiveEditionAction(editionId))}>Archive</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
