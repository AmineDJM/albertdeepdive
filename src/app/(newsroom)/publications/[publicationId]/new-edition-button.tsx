"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/i18n/provider";
import { startNextEditionAction } from "../actions";

/**
 * The action, and there is nothing to fill in.
 *
 * A second edition is not a new project — it is the same newsletter, a month later — so it starts
 * from the last one and opens on its first step. The button says what it will inherit, because a
 * thing that happens without being asked should at least say what it did; everything it decided
 * can be changed from the edition itself.
 */
export function NewEditionButton({ publicationId, inheritsFrom }: { publicationId: string; inheritsFrom: string | null }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startNextEditionAction(publicationId);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(result.message ?? tr("Edition created"));
            router.push(`/editions/${result.data.id}/campaign`);
          })
        }
      >
        <Plus /> {pending ? tr("Starting…") : tr("New edition")}
      </Button>
      {inheritsFrom ? <span className="text-2xs text-muted-foreground">{tr("Starts from")} {inheritsFrom}</span> : null}
    </span>
  );
}
