"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { disconnectDomainAction, updateSenderAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUi } from "@/components/i18n/provider";

/** Advanced settings: the name and address on the envelope, and the way back to "via Briefly". */
export function SenderSettings({ domain }: { domain: { domainName: string; senderName: string; senderLocalPart: string; replyTo: string | null } }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [senderName, setSenderName] = useState(domain.senderName);
  const [localPart, setLocalPart] = useState(domain.senderLocalPart);
  const [replyTo, setReplyTo] = useState(domain.replyTo ?? "");

  const run = (action: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? tr("That did not work"));
        return;
      }
      if (result.message) toast.success(result.message);
      router.refresh();
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => updateSenderAction({ senderName, localPart, replyTo }));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="sender-name">{tr("Sender name")}</Label>
          <Input id="sender-name" value={senderName} onChange={(event) => setSenderName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sender-local">{tr("Address")}</Label>
          <div className="flex items-center gap-1">
            <Input id="sender-local" value={localPart} onChange={(event) => setLocalPart(event.target.value)} className="font-mono" />
            <span className="shrink-0 font-mono text-xs text-muted-foreground">@{domain.domainName}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reply-to">{tr("Replies go to")}</Label>
          <Input id="reply-to" type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder={tr("same address")} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {tr("Save sender")}</Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() => {
            if (window.confirm(tr("Remove this domain? Your editions will go out via Briefly again until you connect one."))) run(() => disconnectDomainAction());
          }}
        >
          <Trash2 />{" "}{tr("Remove domain")}</Button>
      </div>
    </form>
  );
}
