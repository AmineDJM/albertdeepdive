"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeMissingAction } from "@/app/(newsroom)/editions/[editionId]/media/actions";

export function DescribeMissingButton({
  editionId,
  missing,
}: {
  editionId: string;
  missing: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      disabled={!missing}
      title={
        missing
          ? `Queue AI descriptions for ${missing} asset${missing === 1 ? "" : "s"} without one`
          : "Every asset already has a description"
      }
      onClick={() =>
        startTransition(async () => {
          const res = await describeMissingAction(editionId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(res.message);
          router.refresh();
        })
      }
    >
      <Sparkles /> Describe {missing ? `${missing} ` : ""}with AI
    </Button>
  );
}
