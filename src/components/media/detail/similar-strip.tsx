"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MediaDetail, SimilarAsset } from "@/server/media/library";
import { formatDimensions, RIGHTS_DOT_CLASS } from "@/server/media/constants";
import {
  clearDuplicateAction,
  markDuplicateAction,
  recheckDuplicatesAction,
} from "@/app/(newsroom)/media/[mediaId]/actions";
import { useUi } from "@/components/i18n/provider";

function relationLabel(s: SimilarAsset) {
  if (s.relation === "exact") return "Identical file";
  if (s.relation === "near") return `Near-duplicate · ${s.distance} bits apart`;
  if (s.relation === "similar") return `Similar · ${s.distance} bits apart`;
  return "Same similarity group";
}

export function SimilarStrip({
  assetId,
  editionId,
  similar,
  duplicateOf,
  canManage,
}: {
  assetId: string;
  editionId: string | null;
  similar: SimilarAsset[];
  duplicateOf: MediaDetail["duplicateOf"];
  canManage: boolean;
}) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {duplicateOf ? (
        <div className="border-destructive/30 bg-destructive/5 flex items-center gap-3 rounded-lg border px-3 py-2">
          {duplicateOf.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={duplicateOf.thumbUrl} alt="" className="size-10 rounded object-cover" />
          ) : null}
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium">{tr("Marked as a duplicate")}</div>
            <div className="text-muted-foreground truncate">
              {tr("of")}{" "}
              <Link
                href={`/media/${duplicateOf.id}`}
                className="underline-offset-2 hover:underline"
              >
                {duplicateOf.caption || duplicateOf.fileName}
              </Link>
              {tr(". Duplicates are hidden from pickers and never exported.")}</div>
          </div>
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              loading={pending}
              onClick={() => run(() => clearDuplicateAction(assetId, editionId))}
            >
              <Undo2 /> {" "}{tr("Not a duplicate")}</Button>
          ) : null}
        </div>
      ) : null}
      {similar.length ? (
        <ul
          className="flex scrollbar-thin gap-2.5 overflow-x-auto pb-1"
          aria-label={tr("Similar assets")}
        >
          {similar.map((s) => (
            <li
              key={s.id}
              className="border-border bg-card w-44 shrink-0 overflow-hidden rounded-lg border"
            >
              <Link href={`/media/${s.id}`} className="bg-muted relative block aspect-[4/3]">
                {s.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.thumbUrl}
                    alt=""
                    className={cn("size-full object-cover", s.isArchived && "opacity-60 grayscale")}
                  />
                ) : null}
                <span
                  className={cn(
                    "absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2 ring-white",
                    RIGHTS_DOT_CLASS[s.rightsStatus],
                  )}
                />
                {s.duplicateOfId === assetId ? (
                  <Badge variant="red" className="absolute bottom-1.5 left-1.5">
                    {tr("duplicate of this")}</Badge>
                ) : null}
              </Link>
              <div className="space-y-1 px-2 py-1.5">
                <div className="truncate text-xs font-medium" title={s.caption || s.fileName}>
                  {s.caption || s.fileName}
                </div>
                <div className="text-2xs text-muted-foreground">
                  {relationLabel(s)} · {formatDimensions(s.width, s.height)}
                  {s.qualityScore !== null ? ` · Q ${s.qualityScore}` : ""}
                </div>
                {canManage && duplicateOf?.id !== s.id && s.duplicateOfId !== assetId ? (
                  <Button
                    size="xs"
                    variant="outline"
                    className="w-full"
                    loading={pending}
                    onClick={() => run(() => markDuplicateAction(assetId, editionId, s.id))}
                  >
                    <Copy /> {" "}{tr("Duplicate of this")}</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">{tr("No similar asset in this edition.")}</p>
      )}
      {canManage ? (
        <Button
          size="xs"
          variant="ghost"
          loading={pending}
          onClick={() => run(() => recheckDuplicatesAction(assetId, editionId))}
        >
          <RefreshCw /> {" "}{tr("Re-check duplicates")}</Button>
      ) : null}
    </div>
  );
}
