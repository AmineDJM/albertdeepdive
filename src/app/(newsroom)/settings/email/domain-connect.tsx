"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Globe, Settings2 } from "lucide-react";
import { connectDomainAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUi } from "@/components/i18n/provider";

const LABELS = ["news", "mail", "newsletter", "updates"] as const;

/** "https://www.Acme.com/about" → "acme.com", for the preview under the field. Validation is the server's. */
function rootOf(input: string): string {
  return input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "").replace(/\.$/, "");
}

/**
 * Connecting a domain, in one field.
 *
 * The customer types acme.com. Briefly says it will send from news.acme.com, why, and what the
 * sender will look like; everything else is behind "Advanced" for the few who want a different
 * subdomain, name or address. Nothing here mentions the provider, keys or DKIM.
 */
export function DomainConnect({ suggestion, organizationName, configured }: { suggestion: { root: string; sending: string } | null; organizationName: string; configured: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [domain, setDomain] = useState(suggestion?.root ?? "");
  const [label, setLabel] = useState<string>("news");
  const [customLabel, setCustomLabel] = useState("");
  const [senderName, setSenderName] = useState(organizationName);
  const [localPart, setLocalPart] = useState("newsletter");

  const root = useMemo(() => rootOf(domain), [domain]);
  const chosenLabel = label === "custom" ? customLabel.trim().toLowerCase() || "news" : label;
  const alreadySub = root.split(".").length >= 3 && (LABELS as readonly string[]).includes(root.split(".")[0]);
  const sending = root ? (alreadySub ? root : `${chosenLabel}.${root}`) : "";
  const address = sending ? `${localPart.trim().toLowerCase() || "newsletter"}@${sending}` : "";

  const submit = () =>
    startTransition(async () => {
      const result = await connectDomainAction({ domain, subdomain: alreadySub ? undefined : chosenLabel, senderName: senderName.trim() || undefined, localPart: localPart.trim() || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? tr("Domain registered"));
      router.refresh();
    });

  if (!open) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[14px] font-medium">{tr("Send from your own domain")}</p>
          <p className="mt-0.5 max-w-prose text-xs leading-5 text-muted-foreground">{tr("Your readers see your name and your address, and your mail is judged on your own reputation. It takes one field and a few DNS records; Briefly does the rest.")}</p>
        </div>
        <Button onClick={() => setOpen(true)} className="shrink-0">
          <Globe />{" "}{tr("Connect my domain")}</Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="domain">{tr("Domain")}</Label>
        <Input id="domain" name="domain" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="acme.com" autoComplete="off" autoFocus required />
        <p className="text-xs text-muted-foreground">{tr("The domain of your website. Example:")}{" "}<span className="font-mono">acme.com</span></p>
      </div>

      {sending ? (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5">
          <p>
            {tr("Briefly will send from")}{" "}<span className="font-mono font-medium text-foreground">{sending}</span>
            {alreadySub ? null : <span className="text-muted-foreground">{" "}— {tr("a subdomain keeps your company's own mail separate and safe.")}</span>}
          </p>
          <p className="text-muted-foreground">
            {tr("Your readers will see")}{" "}<span className="font-medium text-foreground">{senderName.trim() || organizationName}</span>{" "}<span className="font-mono">&lt;{address}&gt;</span>
          </p>
        </div>
      ) : null}

      <button type="button" onClick={() => setAdvanced((value) => !value)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <Settings2 className="size-3.5" />{" "}{advanced ? tr("Hide advanced settings") : tr("Advanced settings")}</button>

      {advanced ? (
        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          {!alreadySub ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{tr("Subdomain")}</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {[...LABELS, "custom"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setLabel(option)}
                    aria-pressed={label === option}
                    className={label === option ? "rounded-md border border-brand bg-brand/10 px-2.5 py-1 font-mono text-xs" : "rounded-md border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"}
                  >
                    {option === "custom" ? tr("other…") : `${option}.`}
                  </button>
                ))}
                {label === "custom" ? <Input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="hello" className="h-8 w-40 font-mono text-xs" aria-label={tr("Custom subdomain")} /> : null}
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="senderName">{tr("Sender name")}</Label>
            <Input id="senderName" value={senderName} onChange={(event) => setSenderName(event.target.value)} placeholder={organizationName} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="localPart">{tr("Address")}</Label>
            <div className="flex items-center gap-1">
              <Input id="localPart" value={localPart} onChange={(event) => setLocalPart(event.target.value)} placeholder="newsletter" className="font-mono" />
              <span className="shrink-0 font-mono text-xs text-muted-foreground">@{sending || "…"}</span>
            </div>
          </div>
        </div>
      ) : null}

      {!configured ? <p className="text-xs text-warning">{tr("Email delivery is not connected on this Briefly yet, so the domain cannot be registered until its administrator finishes setting it up.")}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" loading={pending} disabled={!root}>
          {tr("Continue")}{" "}<ArrowRight />
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          {tr("Not now")}</Button>
      </div>
    </form>
  );
}
