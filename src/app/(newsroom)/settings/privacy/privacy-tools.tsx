"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/settings/key-value";
import { exportContributorDataAction, saveRetentionAction } from "./actions";

export function RetentionForm({ retentionDays, summary }: { retentionDays: number; summary: { cutoff: Date; staleEmails: number; staleAuditRows: number; dormantInactiveContributors: number } }) {
  const router = useRouter();
  const [days, setDays] = useState(retentionDays);
  const [pending, start] = useTransition();
  const years = (days / 365).toFixed(1);
  return (
    <SettingsCard id="retention" title="Data retention" description="How long personal data (emails, audit rows, dormant contributor records) is kept before it becomes eligible for purge.">
      <form
        className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await saveRetentionAction(days);
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success(res.message);
            router.refresh();
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="retention-days">Retention (days)</Label>
          <Input id="retention-days" type="number" min={30} max={3650} step={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="tabular" />
          <p className="text-2xs text-muted-foreground">≈ {years} years. Between 30 days and 10 years.</p>
          <Button type="submit" size="sm" loading={pending} disabled={days === retentionDays || days < 30 || days > 3650}>
            <Save /> Save retention
          </Button>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="label-caps mb-2">Older than the current policy</div>
          <ul className="space-y-1">
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">Cut-off date</span><span className="tabular">{summary.cutoff.toISOString().slice(0, 10)}</span></li>
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">Email log rows</span><span className="tabular">{summary.staleEmails}</span></li>
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">Audit log rows</span><span className="tabular">{summary.staleAuditRows}</span></li>
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">Dormant deactivated contributors</span><span className="tabular">{summary.dormantInactiveContributors}</span></li>
          </ul>
          <p className="mt-2 text-2xs text-muted-foreground">Purging is a deliberate operation run by an administrator from the database runbook; this figure tells you what it would touch. Editorial content (stories, articles, published issues) is never purged.</p>
        </div>
      </form>
    </SettingsCard>
  );
}

export function ExportTool() {
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  function download(fileName: string, json: string) {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return (
    <SettingsCard id="export" title="Export a contributor's data" description="GDPR access request: everything the newsroom holds about one person, as a JSON file. The export is recorded in the audit log.">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await exportContributorDataAction(email.trim());
            if (!res.ok) {
              toast.error(res.error === "Contributor not found" ? "No contributor with this email" : res.error);
              return;
            }
            download(res.data.fileName, res.data.json);
            toast.success(`${res.data.fileName} downloaded`);
          });
        }}
      >
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="export-email">Contributor email</Label>
          <Input id="export-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="firstname.lastname@albertschool.com" />
        </div>
        <Button type="submit" size="default" loading={pending} disabled={!/\S+@\S+\.\S+/.test(email)}>
          <Download /> Export JSON
        </Button>
      </form>
    </SettingsCard>
  );
}
