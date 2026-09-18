"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, KeyRound, Unplug } from "lucide-react";
import { connectReaderPaymentsAction, disconnectReaderPaymentsAction } from "./actions";
import type { ReaderPaymentsStatus } from "@/server/payments/readers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useUi } from "@/components/i18n/provider";

/**
 * One secret key, pasted once.
 *
 * The key is tried against Stripe before it is kept, so a typo is a message here rather than a
 * failed checkout for a reader next month. It is stored sealed and never shown again; the card
 * shows the account it belongs to and the last four characters, which is enough to recognise it.
 */
export function PaymentsConnection({ status }: { status: ReaderPaymentsStatus }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const connect = () =>
    startTransition(async () => {
      const result = await connectReaderPaymentsAction(key);
      if (!result.ok) {
        setProblem(result.fieldErrors?.secretKey?.[0] ? `${result.error}. ${result.fieldErrors.secretKey[0]}.` : result.error);
        return;
      }
      setProblem(null);
      setKey("");
      toast.success(result.message ?? "Connected");
      router.refresh();
    });

  const disconnect = () =>
    startTransition(async () => {
      const result = await disconnectReaderPaymentsAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Disconnected");
      router.refresh();
    });

  if (status) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-green-soft text-green-deep">
          <Check className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            {status.accountName ?? "Stripe account"}
            <Badge variant={status.livemode ? "success" : "warning"}>{status.livemode ? "Live" : "Test mode"}</Badge>
          </p>
          <p className="text-xs text-muted-foreground">
            {tr("Key")}{" "}{status.keyHint}{" "}{tr("· connected")}{" "}{new Date(status.connectedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
            {status.accountId ? ` · ${status.accountId}` : ""}
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending}>
              <Unplug />{" "}{tr("Disconnect")}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("Disconnect Stripe?")}</AlertDialogTitle>
              <AlertDialogDescription>{tr("Briefly forgets the key. Paid titles have to be made free first, so nobody is left paying into an account Briefly can no longer see.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("Keep it")}</AlertDialogCancel>
              <AlertDialogAction onClick={disconnect}>{tr("Disconnect")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card px-4 py-4">
      <div className="space-y-1.5">
        <Label htmlFor="stripe-key">{tr("Stripe secret key")}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input id="stripe-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={tr("sk_live_… or a restricted key rk_live_…")} className="pl-8 font-mono" />
          </div>
          <Button onClick={connect} loading={pending} disabled={!key.trim()}>
            {tr("Connect")}</Button>
        </div>
        {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {tr("From your Stripe dashboard: Developers → API keys. A restricted key with write access to Products, Prices, Checkout Sessions, Customers and Subscriptions is enough. Use a test key first if you want to try it without charging anyone; the page says which kind is connected.")}</p>
    </div>
  );
}
