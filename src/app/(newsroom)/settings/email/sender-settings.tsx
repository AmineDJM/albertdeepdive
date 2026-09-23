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

type Result = { ok: boolean; error?: string; message?: string };

function useRun() {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? tr("That did not work"));
        return;
      }
      if (result.message) toast.success(result.message);
      router.refresh();
    });
  return { pending, run };
}

export type SenderFormProps = {
  /** The workspace's own name, which the sender follows until another is chosen. */
  workspaceName: string;
  /** The name as chosen, or null when it follows the workspace's name. */
  customName: string | null;
  replyTo: string | null;
  /** The address underneath when it is not on the workspace's own domain. */
  sharedAddress: string;
  /** The workspace's own domain, once connected; `ready` once mail actually leaves from it. */
  domain: { name: string; localPart: string; ready: boolean } | null;
  /** Replies to the address underneath reach nobody, so a reply address matters. */
  repliesUnread: boolean;
};

/**
 * The sender, as the workspace chooses it: the name on every message, where replies go, and the
 * address on its own domain once it has one. The line on top is what a reader's inbox will show,
 * redrawn as the fields change, so nobody has to imagine the result.
 */
export function SenderForm({ workspaceName, customName, replyTo: savedReplyTo, sharedAddress, domain, repliesUnread }: SenderFormProps) {
  const tr = useUi();
  const { pending, run } = useRun();
  const [senderName, setSenderName] = useState(customName ?? "");
  const [replyTo, setReplyTo] = useState(savedReplyTo ?? "");
  const [localPart, setLocalPart] = useState(domain?.localPart ?? "newsletter");

  const name = senderName.trim() || workspaceName;
  const address = domain?.ready ? `${localPart.trim().toLowerCase() || "newsletter"}@${domain.name}` : sharedAddress;

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => updateSenderAction({ senderName, replyTo, ...(domain ? { localPart } : {}) }));
      }}
    >
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5">
        <p className="text-muted-foreground">{tr("Your readers see")}</p>
        <p className="mt-0.5 text-[14px]" data-testid="sender-preview">
          <span className="font-medium text-foreground">{name}</span>{" "}<span className="font-mono text-muted-foreground">&lt;{address}&gt;</span>
        </p>
        {replyTo.trim() ? (
          <p className="text-muted-foreground">
            {tr("Replies go to")}{" "}<span className="font-mono">{replyTo.trim().toLowerCase()}</span>
          </p>
        ) : null}
      </div>

      <div className={domain ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2"}>
        <div className="space-y-1.5">
          <Label htmlFor="sender-name">{tr("Sender name")}</Label>
          <Input id="sender-name" value={senderName} onChange={(event) => setSenderName(event.target.value)} placeholder={workspaceName} maxLength={80} />
          <p className="text-xs text-muted-foreground">{tr("Empty: your workspace's name.")}</p>
        </div>
        {domain ? (
          <div className="space-y-1.5">
            <Label htmlFor="sender-local">{tr("Address")}</Label>
            <div className="flex items-center gap-1">
              <Input id="sender-local" value={localPart} onChange={(event) => setLocalPart(event.target.value)} className="font-mono" />
              <span className="shrink-0 font-mono text-xs text-muted-foreground">@{domain.name}</span>
            </div>
            {domain.ready ? null : <p className="text-xs text-muted-foreground">{tr("Used as soon as your domain is ready.")}</p>}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="reply-to">{tr("Replies go to")}</Label>
          <Input id="reply-to" type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="editors@yourdomain.com" />
          <p className={repliesUnread && !replyTo.trim() ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
            {repliesUnread && !replyTo.trim() ? tr("Until your domain is ready, replies to the sending address reach nobody. Add yours.") : tr("Empty: replies go to the sending address.")}
          </p>
        </div>
      </div>

      <Button type="submit" size="sm" loading={pending}>
        {tr("Save sender")}</Button>
    </form>
  );
}

/** The way back to Briefly's sending address, under the same name. */
export function RemoveDomainButton() {
  const tr = useUi();
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive"
      disabled={pending}
      onClick={() => {
        if (window.confirm(tr("Remove this domain? Your editions will go out from Briefly's sending address again, still under your name, until you connect one."))) run(() => disconnectDomainAction());
      }}
    >
      <Trash2 />{" "}{tr("Remove domain")}</Button>
  );
}
