"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, ExternalLink, Mail, Plug, PlugZap, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { FieldError, SettingsCard } from "@/components/settings/key-value";
import { connectGmailAction, disconnectGmailAction, pollInboxAction, sendTestEmailAction, testGmailAction } from "@/app/(newsroom)/settings/email/actions";
import type { GmailStatus } from "@/server/email/gmail";

const APP_PASSWORD_URL = "https://myaccount.google.com/apppasswords";

/**
 * Connecting the newsroom mailbox. The only thing an operator has to fetch from Google is a
 * 16-character app password; there is no Google Cloud project and no third-party email provider.
 */
export function GmailConnection({ status, appName }: { status: GmailStatus; appName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"test" | "connect" | "send" | "poll" | null>(null);
  const [address, setAddress] = useState(status.address ?? "");
  const [displayName, setDisplayName] = useState(status.displayName ?? appName);
  const [password, setPassword] = useState("");
  // Collecting replies is the point of connecting a mailbox, so a new connection starts with it on.
  const [receiveEnabled, setReceiveEnabled] = useState(status.connected ? status.receiveEnabled : true);
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);

  function run(kind: typeof busy, fn: () => Promise<{ ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[]> }>, after?: () => void) {
    setBusy(kind);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.ok) {
        setErrors(null);
        toast.success(res.message ?? "Done");
        after?.();
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? null);
        toast.error(res.error ?? "Failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Newsroom mailbox"
        description="Invitations, reminders and requests for more information are sent from this address, and replies come back to it."
        action={
          status.connected ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="warning">Not connected</Badge>
          )
        }
      >
        {status.connected ? (
          <div className="space-y-3">
            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="label-caps">Address</dt>
                <dd className="mt-0.5">{status.address}</dd>
              </div>
              <div>
                <dt className="label-caps">Sender name</dt>
                <dd className="mt-0.5">{status.displayName}</dd>
              </div>
              <div>
                <dt className="label-caps">App password</dt>
                <dd className="tabular mt-0.5 text-muted-foreground">{status.passwordHint}</dd>
              </div>
              <div>
                <dt className="label-caps">Replies</dt>
                <dd className="mt-0.5">{status.receiveEnabled ? "Filed in the newsroom inbox" : "Not collected"}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" loading={pending && busy === "send"} disabled={pending} onClick={() => run("send", () => sendTestEmailAction(status.address!))}>
                <Send /> Send a test to myself
              </Button>
              {status.receiveEnabled ? (
                <Button size="sm" variant="outline" loading={pending && busy === "poll"} disabled={pending} onClick={() => run("poll", () => pollInboxAction())}>
                  <Download /> Check for replies now
                </Button>
              ) : null}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={pending}>
                    <Unplug /> Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect this mailbox?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The newsroom stops sending and receiving email until another mailbox is connected. Messages already sent are kept in the mailbox log.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run("connect", () => disconnectGmailAction(), () => setPassword(""))}>Disconnect</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft/40 p-2.5 text-xs">
            <Mail className="mt-px size-3.5 shrink-0 text-warning" />
            <span>
              Until a mailbox is connected, invitations are written to the development mailbox instead of being sent. Contributors receive nothing.
            </span>
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title={status.connected ? "Change the mailbox" : "Connect a Gmail mailbox"}
        description="Google refuses an ordinary account password, so use an app password. It takes a minute and needs no Google Cloud project."
      >
        <ol className="mb-3 space-y-1 text-xs text-muted-foreground">
          <li>
            1. Turn on 2-Step Verification on the Google account, then open{" "}
            <a href={APP_PASSWORD_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
              App passwords <ExternalLink className="size-3" />
            </a>
            .
          </li>
          <li>2. Create one for “Albert Deep Dive”. Google shows 16 characters in four groups.</li>
          <li>3. Paste it below. Spaces do not matter. It is encrypted before it is stored, and never shown again.</li>
        </ol>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gmail-address">Gmail address</Label>
            <Input id="gmail-address" type="email" autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="newsroom@albertschool.com" aria-invalid={Boolean(errors?.address)} />
            <FieldError errors={errors} name="address" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gmail-name">Sender name</Label>
            <Input id="gmail-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={appName} aria-invalid={Boolean(errors?.displayName)} />
            <FieldError errors={errors} name="displayName" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gmail-password">App password</Label>
            <Input id="gmail-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="abcd efgh ijkl mnop" className="tabular" aria-invalid={Boolean(errors?.password)} />
            <FieldError errors={errors} name="password" />
          </div>
        </div>

        <label className="mt-3 flex items-start gap-2.5 rounded-md border border-border p-2.5">
          <Switch id="gmail-receive" checked={receiveEnabled} onCheckedChange={setReceiveEnabled} />
          <span className="text-xs">
            <span className="font-medium">File replies in the newsroom inbox</span>
            <span className="mt-0.5 block text-muted-foreground">
              A reply from a contributor becomes a submission to triage, attributed to them. Messages from anyone else are left alone.
            </span>
          </span>
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            loading={pending && busy === "test"}
            disabled={pending || !address.trim() || !password.trim()}
            onClick={() => run("test", () => testGmailAction({ address: address.trim(), password }))}
          >
            <PlugZap /> Test the sign-in
          </Button>
          <Button
            size="sm"
            variant="brand"
            loading={pending && busy === "connect"}
            disabled={pending || !address.trim() || !displayName.trim() || !password.trim()}
            onClick={() => run("connect", () => connectGmailAction({ address: address.trim(), displayName: displayName.trim(), password, receiveEnabled }), () => setPassword(""))}
          >
            <Plug /> {status.connected ? "Save the mailbox" : "Connect the mailbox"}
          </Button>
        </div>
      </SettingsCard>
    </div>
  );
}
