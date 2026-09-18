"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, RefreshCw } from "lucide-react";
import { syncSubscriptionAction } from "./actions";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/i18n/provider";

/** Pull one subscription's real state from Stripe, and a door to the customer there. */
export function SubscriptionControls({ organizationId, stripeCustomerId, stripeSubscriptionId, livemode }: { organizationId: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null; livemode: boolean | null }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const dashboard = `https://dashboard.stripe.com/${livemode === false ? "test/" : ""}customers/${stripeCustomerId ?? ""}`;

  return (
    <span className="flex items-center justify-end gap-1">
      {stripeCustomerId ? (
        <Button variant="ghost" size="sm" asChild>
          <a href={dashboard} target="_blank" rel="noreferrer" title={tr("Open in Stripe")}>
            <ExternalLink />{" "}{tr("Stripe")}</a>
        </Button>
      ) : null}
      {stripeSubscriptionId ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await syncSubscriptionAction(organizationId);
              if (!result.ok) {
                toast.error(result.error ?? tr("That did not work"));
                return;
              }
              toast.success(result.message ?? tr("Done"));
              router.refresh();
            })
          }
        >
          <RefreshCw />{" "}{tr("Refresh")}</Button>
      ) : null}
    </span>
  );
}
