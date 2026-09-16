"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crop, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CropSuggestion } from "@/server/db/schema/submissions";
import type { MediaVariantView } from "@/server/media/library";
import { formatBytes } from "@/server/media/constants";
import { clearCropAction, setCropAction } from "@/app/(newsroom)/media/[mediaId]/actions";

/** Shows the region a crop would keep, using the (proportional) web preview positioned with CSS. */
function CropPreview({
  previewUrl,
  width,
  crop,
}: {
  previewUrl: string;
  width: number;
  crop: CropSuggestion;
}) {
  return (
    <div
      className="bg-muted relative w-full overflow-hidden rounded"
      style={{ aspectRatio: `${crop.width} / ${crop.height}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt=""
        className="absolute max-w-none"
        style={{
          width: `${(width / crop.width) * 100}%`,
          left: `${(-crop.x / crop.width) * 100}%`,
          top: `${(-crop.y / crop.height) * 100}%`,
        }}
      />
    </div>
  );
}

export function CropsPanel({
  assetId,
  editionId,
  width,
  height,
  previewUrl,
  suggestions,
  crop,
  canManage,
}: {
  assetId: string;
  editionId: string | null;
  width: number;
  height: number;
  previewUrl: string;
  suggestions: CropSuggestion[];
  crop: MediaVariantView | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function generate(c: CropSuggestion) {
    setBusy(c.name);
    startTransition(async () => {
      const res = await setCropAction(assetId, editionId, {
        name: c.name,
        aspect: c.aspect,
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
      });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await clearCropAction(assetId, editionId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  if (!width || !height)
    return <p className="text-muted-foreground text-xs">No dimensions known for this asset.</p>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {suggestions.map((c) => {
          const current =
            crop?.cropSpec?.name === c.name &&
            crop.cropSpec.x === c.x &&
            crop.cropSpec.y === c.y &&
            crop.cropSpec.width === c.width &&
            crop.cropSpec.height === c.height;
          return (
            <div key={c.name} className="border-border bg-card space-y-1.5 rounded-lg border p-2">
              <CropPreview previewUrl={previewUrl} width={width} crop={c} />
              <div className="flex items-center justify-between gap-1">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium capitalize">{c.name}</div>
                  <div className="tabular text-2xs text-muted-foreground">
                    {c.aspect} · {c.width}×{c.height}
                  </div>
                </div>
                {current ? <Badge variant="brand">current</Badge> : null}
              </div>
              {canManage ? (
                <Button
                  size="xs"
                  variant={current ? "ghost" : "outline"}
                  className="w-full"
                  loading={pending && busy === c.name}
                  disabled={pending && busy !== c.name}
                  onClick={() => generate(c)}
                >
                  <Crop /> {current ? "Regenerate" : "Generate crop"}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {crop ? (
        <div className="border-border bg-card flex items-center gap-3 rounded-lg border p-2">
          <a
            href={crop.url}
            target="_blank"
            rel="noreferrer"
            className="bg-muted block w-28 shrink-0 overflow-hidden rounded"
            style={{ aspectRatio: `${crop.width} / ${crop.height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={crop.url} alt="Current crop" className="size-full object-cover" />
          </a>
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium">
              Current crop{crop.cropSpec ? `: ${crop.cropSpec.name} (${crop.cropSpec.aspect})` : ""}
            </div>
            <div className="tabular text-muted-foreground">
              {crop.width}×{crop.height} · {crop.format.toUpperCase()} ·{" "}
              {formatBytes(crop.sizeBytes)}
            </div>
          </div>
          <Button asChild size="xs" variant="outline">
            <a href={crop.downloadUrl}>
              <Download /> Download
            </a>
          </Button>
          {canManage ? (
            <Button
              size="xs"
              variant="ghost"
              aria-label="Remove crop"
              loading={pending}
              onClick={remove}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-2xs text-muted-foreground">
          No crop generated yet. Crops are cut from the original file at full resolution and used by
          the layout templates.
        </p>
      )}
    </div>
  );
}
