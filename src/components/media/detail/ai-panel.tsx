"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";
import type { MediaDetail } from "@/server/media/library";
import { describeAction } from "@/app/(newsroom)/media/[mediaId]/actions";

export function AiPanel({
  assetId,
  editionId,
  description,
  tags,
  lastJob,
  canManage,
}: {
  assetId: string;
  editionId: string | null;
  description: string | null;
  tags: string[];
  lastJob: MediaDetail["lastDescribeJob"];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function describe() {
    startTransition(async () => {
      const res = await describeAction(assetId, editionId);
      if (!res.ok) {
        toast.error("Could not describe this image", { description: res.error });
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }
  return (
    <div className="space-y-2.5">
      {description ? (
        <p className="text-[13px] leading-5">{description}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          No AI description yet. The description feeds alt text, search and the media
          recommendations for stories — people are never named.
        </p>
      )}
      {tags.length ? (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground">
          {lastJob
            ? `${lastJob.model}${lastJob.cached ? " (cached)" : ""} · ${relativeTime(lastJob.createdAt)}${lastJob.status !== "SUCCEEDED" ? ` · ${lastJob.status.toLowerCase()}` : ""}`
            : ""}
        </span>
        {canManage ? (
          <Button size="sm" variant="outline" loading={pending} onClick={describe}>
            <Sparkles /> {description ? "Describe again" : "Describe with AI"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
