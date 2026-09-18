"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, RefreshCw, Send } from "lucide-react";
import { remindInvoiceAction, retryInvoiceAction } from "./actions";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/i18n/provider";

/**
 * The three things somebody does about an invoice: look at it, charge the card again, or ask.
 *
 * "Charge again" is only offered while the invoice is open, and the reminder only while there is
 * still something to remind anybody of.
 */
export function InvoiceControls({ invoice }: { invoice: { id: string; status: string; hostedUrl: string | null } }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? tr("That did not work"));
        return;
      }
      toast.success(result.message ?? tr("Done"));
      router.refresh();
    });

  const open = invoice.status === "open";
  const owed = open || invoice.status === "uncollectible";

  return (
    <span className="flex items-center justify-end gap-1">
      {invoice.hostedUrl ? (
        <Button variant="ghost" size="sm" asChild>
          <a href={invoice.hostedUrl} target="_blank" rel="noreferrer">
            <ExternalLink />{" "}{tr("Open")}</a>
        </Button>
      ) : null}
      {open ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => retryInvoiceAction(invoice.id))}>
          <RefreshCw />{" "}{tr("Charge again")}</Button>
      ) : null}
      {owed ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => remindInvoiceAction(invoice.id))}>
          <Send />{" "}{tr("Send reminder")}</Button>
      ) : null}
    </span>
  );
}
