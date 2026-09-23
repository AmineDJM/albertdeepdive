"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rereadNewsletterLookAction } from "../actions";
import { useUi } from "@/components/i18n/provider";

/** Read the newsletter's address again, for when its site or page has changed. */
export function RereadLookButton({ publicationId }: { publicationId: string }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await rereadNewsletterLookAction(publicationId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          if (result.data?.ownBrand) toast.success(result.message);
          else toast.warning(result.message);
          router.refresh();
        })
      }
    >
      <RefreshCw />{" "}{tr("Read it again")}</Button>
  );
}
