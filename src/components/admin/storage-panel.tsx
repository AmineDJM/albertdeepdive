"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Copy, HardDrive, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { auditStorageAction, migrateStorageAction, storageHealthAction, verifyChecksumsAction } from "@/app/(admin)/admin/storage/actions";
import type { ChecksumResult, StorageAudit, StorageHealth } from "@/server/storage/audit";
import type { MigrationReport } from "@/server/storage/migrate";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/newsroom/page-header";
import { useUi } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";

/**
 * The four questions about storage that nobody could answer from a screen.
 *
 * Is it configured; does it actually work; is everything the database expects still in it; and is
 * what is in it the right bytes. Each is a button rather than a figure on page load, because each
 * one costs a round trip to the bucket and the honest thing is to let somebody ask rather than
 * charge them for asking every time they open the console.
 *
 * Nothing here prints a credential. The endpoint is shown by host, and the bucket by name.
 */
export function StoragePanel({ provider, bucket, endpointHost, localDir }: { provider: string; bucket: string | null; endpointHost: string | null; localDir: string }) {
  const tr = useUi();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [audit, setAudit] = useState<StorageAudit | null>(null);
  const [checksums, setChecksums] = useState<ChecksumResult[] | null>(null);
  const [migration, setMigration] = useState<MigrationReport | null>(null);

  function run<T>(name: string, action: () => Promise<ActionResult<T>>, onDone: (value: T) => void) {
    setBusy(name);
    startTransition(async () => {
      const result = await action();
      setBusy(null);
      if (result.ok) onDone(result.data);
      else toast.error(result.error);
    });
  }

  const onLocal = provider === "local";

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <SectionTitle>{tr("Where the files are")}</SectionTitle>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">{tr("Provider")}</dt>
          <dd className="font-medium">
            {onLocal ? tr("The machine's own disk") : tr("Object storage (S3 protocol)")}
          </dd>
          {bucket ? (
            <>
              <dt className="text-muted-foreground">{tr("Bucket")}</dt>
              <dd className="font-mono">{bucket}</dd>
            </>
          ) : null}
          {endpointHost ? (
            <>
              <dt className="text-muted-foreground">{tr("Endpoint")}</dt>
              <dd className="font-mono">{endpointHost}</dd>
            </>
          ) : null}
          {onLocal ? (
            <>
              <dt className="text-muted-foreground">{tr("Directory")}</dt>
              <dd className="font-mono">{localDir}</dd>
            </>
          ) : null}
        </dl>
        {onLocal ? (
          <p className="mt-3 flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-2xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>
              {tr(
                "Customer files are on this machine's disk. That is right for a laptop and wrong for any host that replaces its container: the rows survive in the database, the pictures do not, and every thumbnail comes back broken. Connect a bucket under Providers → Object storage, then copy what is here into it.",
              )}
            </span>
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>{tr("Does it work")}</SectionTitle>
          <Button size="xs" variant="outline" loading={pending && busy === "health"} onClick={() => run("health", storageHealthAction, setHealth)}>
            <RefreshCw /> {tr("Run a round trip")}
          </Button>
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          {tr("Writes a small object, reads it back byte for byte, signs a URL for it and deletes it. A bucket that accepts a write and refuses a read is configured and broken, and only trying says so.")}
        </p>
        {health ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge ok={health.wrote} label={tr("Wrote")} />
              <Badge ok={health.read} label={tr("Read back")} />
              <Badge ok={health.signed} label={tr("Signed a URL")} />
              <Badge ok={health.deleted} label={tr("Deleted")} />
              <span className="text-2xs text-muted-foreground">{health.latencyMs} ms</span>
            </div>
            {health.error ? <p className="text-2xs text-destructive">{health.error}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>{tr("Is everything still there")}</SectionTitle>
          <div className="flex gap-2">
            <Button size="xs" variant="outline" loading={pending && busy === "audit"} onClick={() => run("audit", auditStorageAction, setAudit)}>
              <HardDrive /> {tr("Audit the objects")}
            </Button>
            <Button size="xs" variant="ghost" loading={pending && busy === "sums"} onClick={() => run("sums", () => verifyChecksumsAction(25), setChecksums)}>
              <ShieldCheck /> {tr("Check 25 digests")}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          {tr("Compares every key the database expects with what the bucket actually holds, in both directions. A missing object is a broken picture somebody is looking at right now; an orphan is storage nobody is paying attention to.")}
        </p>
        {audit ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-4 text-xs">
              <Figure label={tr("Expected")} value={audit.expected} />
              <Figure label={tr("In storage")} value={audit.present} />
              <Figure label={tr("Missing")} value={audit.missing.length} tone={audit.missing.length ? "bad" : "good"} />
              <Figure label={tr("Orphans")} value={audit.orphans.length} tone={audit.orphans.length ? "warn" : "good"} />
            </div>
            {audit.byWorkspace.length ? (
              <ul className="space-y-1 text-2xs">
                {audit.byWorkspace.map((row) => (
                  <li key={row.organizationId ?? "none"} className="flex justify-between gap-4">
                    <span>{row.name}</span>
                    <span className="tabular text-destructive">
                      {row.missing} {tr("missing")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-2xs text-muted-foreground">{tr("Every object the database expects is in storage.")}</p>
            )}
            {audit.missing.length ? (
              <details className="text-2xs">
                <summary className="cursor-pointer text-muted-foreground">{tr("Show the missing keys")}</summary>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {audit.missing.slice(0, 40).map((row) => (
                    <li key={row.key} className="truncate">
                      {row.key} <span className="text-muted-foreground">({row.kind})</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
        {checksums ? (
          <p className="mt-3 text-2xs">
            {checksums.filter((row) => row.ok).length}/{checksums.length} {tr("digests match what was ingested")}
            {checksums.some((row) => !row.ok) ? (
              <span className="text-destructive"> — {checksums.filter((row) => !row.ok).length} {tr("do not")}</span>
            ) : null}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>{tr("Move the disk into the bucket")}</SectionTitle>
          <div className="flex gap-2">
            <Button size="xs" variant="outline" loading={pending && busy === "dry"} onClick={() => run("dry", () => migrateStorageAction(true), setMigration)}>
              <Copy /> {tr("Dry run")}
            </Button>
            <Button size="xs" loading={pending && busy === "migrate"} disabled={onLocal} onClick={() => run("migrate", () => migrateStorageAction(false), setMigration)}>
              {tr("Copy for real")}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          {tr("The keys do not change, so nothing in the database needs rewriting and no published link breaks. Every copy is read back and checked against the digest recorded at ingest. Nothing is deleted from the disk.")}
        </p>
        {migration ? (
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <Figure label={tr("Considered")} value={migration.considered} />
            <Figure label={migration.dryRun ? tr("Would copy") : tr("Copied")} value={migration.copied} tone="good" />
            <Figure label={tr("Already there")} value={migration.alreadyThere} />
            <Figure label={tr("Gone from the disk too")} value={migration.missingLocally} tone={migration.missingLocally ? "bad" : "good"} />
            <Figure label={tr("Failed")} value={migration.failed} tone={migration.failed ? "bad" : "good"} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs", ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
      {ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
      {label}
    </span>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" | "warn" }) {
  return (
    <span className="flex flex-col">
      <span className="text-muted-foreground text-2xs">{label}</span>
      <span className={cn("tabular text-sm font-medium", tone === "bad" && "text-destructive", tone === "warn" && "text-warning", tone === "good" && "text-success")}>
        {value}
      </span>
    </span>
  );
}

