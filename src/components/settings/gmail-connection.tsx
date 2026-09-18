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
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

const APP_PASSWORD_URL = "https://myaccount.google.com/apppasswords";

/**
 * Connecting the newsroom mailbox. The only thing an operator has to fetch from Google is a
 * 16-character app password; there is no Google Cloud project and no third-party email provider.
 */
const OAUTH_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Gmail connected. Invitations and reminders will be sent from this address." },
  denied: { ok: false, text: "You cancelled the Google sign-in. Nothing was changed." },
  bad_state: { ok: false, text: "The sign-in link expired. Start again from this page." },
  no_refresh_token: { ok: false, text: "Google did not return a refresh token. Remove this app under myaccount.google.com/permissions, then connect again." },
  no_address: { ok: false, text: "Could not read the mailbox address from Google. Try again." },
  oauth_unavailable: { ok: false, text: "Google sign-in is not configured on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." },
  error: { ok: false, text: "Something went wrong connecting to Google. Try again." },
};

export function GmailConnection({ status, appName, oauthAvailable, oauthRedirectUri, result }: { status: GmailStatus; appName: string; oauthAvailable: boolean; oauthRedirectUri: string; result: string | null }) {
  const tr = useUi();
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

  const banner = result ? OAUTH_RESULT[result] ?? null : null;

  return (
    <div className="space-y-4">
      {banner ? (
        <p className={cn("flex items-start gap-2 rounded-md border p-2.5 text-xs", banner.ok ? "border-success/40 bg-success-soft/40" : "border-destructive/40 bg-destructive-soft/40")}>
          {banner.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" /> : <Mail className="mt-px size-3.5 shrink-0 text-destructive" />}
          <span>{banner.text}</span>
        </p>
      ) : null}

      {oauthAvailable && !(status.connected && status.mode === "password") ? (
        <SettingsCard
          title={tr("Connect with Google")}
          description={tr("One click. Google asks you to approve, and the mailbox is connected — no password to create or paste.")}
          action={status.connected && status.mode === "oauth" ? <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" /> {" "}{tr("Connected")}</Badge> : null}
        >
          {status.connected && status.mode === "oauth" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{tr("Signed in as")}{" "}<span className="font-medium text-foreground">{status.address}</span>.</span>
              <Button size="sm" variant="outline" asChild>
                <a href="/api/settings/gmail/start">{tr("Reconnect")}</a>
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="brand" asChild>
              <a href="/api/settings/gmail/start">
                <svg viewBox="0 0 48 48" className="size-4" aria-hidden><path fill="#4285F4" d="M45 24c0-1.6-.1-3.1-.4-4.6H24v9.1h11.8c-.5 2.8-2 5.1-4.4 6.7v5.6h7.1C42.7 37 45 31 45 24z"/><path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.6c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.2H4.3v5.8C7.9 41.1 15.3 46 24 46z"/><path fill="#FBBC05" d="M11.6 27.9c-.5-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.8H4.3C2.8 16.8 2 20.3 2 24s.8 7.2 2.3 10.1l7.3-6.2z"/><path fill="#EA4335" d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4 30 2 24 2 15.3 2 7.9 6.9 4.3 14.1l7.3 5.8C13.3 14.6 18.2 10.7 24 10.7z"/></svg>
                {tr("Sign in with Google")}</a>
            </Button>
          )}
          <p className="mt-2 text-2xs text-muted-foreground">{tr("Works with a Google Workspace or Gmail address. You approve the exact permissions on Google’s own screen.")}</p>
        </SettingsCard>
      ) : null}

      {!oauthAvailable ? (
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-2xs text-muted-foreground">
          <ExternalLink className="mt-px size-3 shrink-0" />
          <span>{tr("To turn on one-click “Sign in with Google”, set")}{" "}<code>GOOGLE_CLIENT_ID</code> {" "}{tr("and")}{" "}<code>GOOGLE_CLIENT_SECRET</code> {" "}{tr("on the server and register this redirect URI in Google Cloud:")}{" "}<code className="break-all">{oauthRedirectUri}</code>{tr(". Until then, use an app password below.")}</span>
        </p>
      ) : null}

      <SettingsCard
        title={tr("Newsroom mailbox")}
        description={tr("Invitations, reminders and requests for more information are sent from this address, and replies come back to it.")}
        action={
          status.connected ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" /> {" "}{tr("Connected")}</Badge>
          ) : (
            <Badge variant="warning">{tr("Not connected")}</Badge>
          )
        }
      >
        {status.connected ? (
          <div className="space-y-3">
            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="label-caps">{tr("Address")}</dt>
                <dd className="mt-0.5">{status.address}</dd>
              </div>
              <div>
                <dt className="label-caps">{tr("Sender name")}</dt>
                <dd className="mt-0.5">{status.displayName}</dd>
              </div>
              <div>
                <dt className="label-caps">{tr("App password")}</dt>
                <dd className="tabular mt-0.5 text-muted-foreground">{status.passwordHint}</dd>
              </div>
              <div>
                <dt className="label-caps">{tr("Replies")}</dt>
                <dd className="mt-0.5">{status.receiveEnabled ? "Filed in the newsroom inbox" : "Not collected"}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" loading={pending && busy === "send"} disabled={pending} onClick={() => run("send", () => sendTestEmailAction(status.address!))}>
                <Send /> {" "}{tr("Send a test to myself")}</Button>
              {status.receiveEnabled ? (
                <Button size="sm" variant="outline" loading={pending && busy === "poll"} disabled={pending} onClick={() => run("poll", () => pollInboxAction())}>
                  <Download /> {" "}{tr("Check for replies now")}</Button>
              ) : null}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={pending}>
                    <Unplug /> {" "}{tr("Disconnect")}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{tr("Disconnect this mailbox?")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {tr("The newsroom stops sending and receiving email until another mailbox is connected. Messages already sent are kept in the mailbox log.")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run("connect", () => disconnectGmailAction(), () => setPassword(""))}>{tr("Disconnect")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft/40 p-2.5 text-xs">
            <Mail className="mt-px size-3.5 shrink-0 text-warning" />
            <span>
              {tr("Until a mailbox is connected, invitations are written to the development mailbox instead of being sent. Contributors receive nothing.")}</span>
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title={oauthAvailable ? "Or connect with an app password" : status.connected ? "Change the mailbox" : "Connect a Gmail mailbox"}
        description={tr("Google refuses an ordinary account password, so use an app password. It takes a minute and needs no Google Cloud project.")}
      >
        <ol className="mb-3 space-y-1 text-xs text-muted-foreground">
          <li>
            {tr("1. Turn on 2-Step Verification on the Google account, then open")}{" "}
            <a href={APP_PASSWORD_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
              {tr("App passwords")}{" "}<ExternalLink className="size-3" />
            </a>
            .
          </li>
          <li>{tr("2. Create one for “Briefly”. Google shows 16 characters in four groups.")}</li>
          <li>{tr("3. Paste it below. Spaces do not matter. It is encrypted before it is stored, and never shown again.")}</li>
        </ol>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gmail-address">{tr("Gmail address")}</Label>
            <Input id="gmail-address" type="email" autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={tr("newsroom@example.com")} aria-invalid={Boolean(errors?.address)} />
            <FieldError errors={errors} name="address" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gmail-name">{tr("Sender name")}</Label>
            <Input id="gmail-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={appName} aria-invalid={Boolean(errors?.displayName)} />
            <FieldError errors={errors} name="displayName" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gmail-password">{tr("App password")}</Label>
            <Input id="gmail-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr("abcd efgh ijkl mnop")} className="tabular" aria-invalid={Boolean(errors?.password)} />
            <FieldError errors={errors} name="password" />
          </div>
        </div>

        <label className="mt-3 flex items-start gap-2.5 rounded-md border border-border p-2.5">
          <Switch id="gmail-receive" checked={receiveEnabled} onCheckedChange={setReceiveEnabled} />
          <span className="text-xs">
            <span className="font-medium">{tr("File replies in the newsroom inbox")}</span>
            <span className="mt-0.5 block text-muted-foreground">
              {tr("A reply from a contributor becomes a submission to triage, attributed to them. Messages from anyone else are left alone.")}</span>
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
            <PlugZap /> {" "}{tr("Test the sign-in")}</Button>
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
