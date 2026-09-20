"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { launchCampaignAction } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import { useUi } from "@/components/i18n/provider";

/**
 * Send the invitations, which is the one irreversible thing on this screen.
 *
 * Advanced keeps it in a menu beside reopening, extending and the two reminders. Standard needs
 * one button and the plain sentence the server answers with — including the awkward one, where
 * nobody was invited because everybody wrote last month.
 */
export function SendInvitations({ editionId }: { editionId: string }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      data-testid="send-invitations"
      onClick={() =>
        start(async () => {
          const result = await launchCampaignAction(editionId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message);
          router.refresh();
        })
      }
    >
      <Send /> {tr("Ask them now")}
    </Button>
  );
}
