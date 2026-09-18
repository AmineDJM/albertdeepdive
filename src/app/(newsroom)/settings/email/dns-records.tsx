"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, RefreshCw, Zap } from "lucide-react";
import { checkDomainAction } from "./actions";
import type { DnsRecord } from "@/server/db/schema/email";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUi } from "@/components/i18n/provider";
import { relativeTime } from "@/lib/utils";

function CopyButton({ value, label }: { value: string; label: string }) {
  const tr = useUi();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`${tr("Copy")} ${label}`}
      title={tr("Copy")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error(tr("Could not copy — select the text instead."));
        }
      }}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/**
 * The records, and nothing to decide.
 *
 * Each one can be copied whole or by field, named the way the customer's DNS editor asks for it.
 * The screen refreshes itself while it waits and says when it last looked, so nobody has to press
 * anything; the button is there for the impatient, not the process.
 */
export function DnsRecords({ domain }: { domain: { status: string; domainName: string; rootDomain: string; records: DnsRecord[]; dnsHost: string | null; dnsHostUrl: string | null; oneClickUrl: string | null; lastCheckedAt: string | null; lastError: string | null } }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const waiting = domain.status !== "READY";

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  const check = () =>
    startTransition(async () => {
      const result = await checkDomainAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? tr("Checked"));
      router.refresh();
    });

  const required = domain.records.filter((record) => record.type !== "CAA");
  const found = required.filter((record) => record.found).length;

  return (
    <div className="space-y-3">
      {domain.oneClickUrl ? (
        <div className="flex flex-col gap-2 rounded-md border border-brand/40 bg-brand/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5">
            <span className="font-medium">{tr("Your DNS host can add these records for you.")}</span>{" "}
            <span className="text-muted-foreground">{tr("One confirmation on their side and you are done.")}</span>
          </p>
          <Button size="sm" asChild>
            <a href={domain.oneClickUrl} target="_blank" rel="noreferrer">
              <Zap />{" "}{tr("Connect DNS in one click")}</a>
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          {domain.dnsHost ? (
            <>
              {tr("Your DNS is managed at")}{" "}<span className="font-medium text-foreground">{domain.dnsHost}</span>.{" "}
              {tr("Add the records below there")}
            </>
          ) : (
            tr("Add the records below wherever your domain's DNS is managed")
          )}
          {" — "}
          {tr("names are relative to")}{" "}<span className="font-mono">{domain.rootDomain}</span>.
        </p>
        {domain.dnsHostUrl ? (
          <Button size="sm" variant="outline" asChild>
            <a href={domain.dnsHostUrl} target="_blank" rel="noreferrer">
              <ExternalLink />{" "}{tr("Open DNS settings")}</a>
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-left text-2xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{tr("Type")}</th>
              <th className="px-3 py-2">{tr("Name")}</th>
              <th className="px-3 py-2">{tr("Value")}</th>
              <th className="px-3 py-2 text-right">{tr("Status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {domain.records.map((record) => (
              <tr key={`${record.type}-${record.fqdn}-${record.value}`} className="align-top">
                <td className="px-3 py-2">
                  <span className="font-mono font-medium">{record.type}</span>
                  <span className="block text-2xs text-muted-foreground">{record.kind}</span>
                  {record.priority !== undefined ? <span className="block text-2xs text-muted-foreground">{tr("priority")} {record.priority}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1">
                    <span className="font-mono break-all">{record.host}</span>
                    <CopyButton value={record.host} label={tr("name")} />
                  </span>
                  <span className="block font-mono text-2xs text-muted-foreground break-all">{record.fqdn}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-start gap-1">
                    <span className="font-mono break-all">{record.value}</span>
                    <CopyButton value={record.value} label={tr("value")} />
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {record.found ? <Badge variant="success">{tr("found")}</Badge> : record.type === "CAA" ? <Badge variant="muted">{tr("optional")}</Badge> : <Badge variant="muted">{tr("not found yet")}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {found}/{required.length}{" "}{tr("records found.")}{" "}
          {tr("We check every few minutes and will tell you as soon as it is ready — nothing to press.")}
          {domain.lastCheckedAt ? <span>{" "}{tr("Last checked")}{" "}{relativeTime(domain.lastCheckedAt)}.</span> : null}
        </p>
        <Button size="sm" variant="ghost" onClick={check} disabled={pending}>
          <RefreshCw className={pending ? "animate-spin" : ""} />{" "}{tr("Check now")}</Button>
      </div>
      {domain.lastError && domain.status === "NEEDS_ATTENTION" ? <p className="text-xs text-warning">{domain.lastError}</p> : null}
    </div>
  );
}
