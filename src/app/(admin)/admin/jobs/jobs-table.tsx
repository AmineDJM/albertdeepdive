"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/newsroom/data-table";
import { cancelJobAction, retryJobAction } from "@/app/(newsroom)/automations/actions";
import { useUi } from "@/components/i18n/provider";
import { formatDateTime, relativeTime } from "@/lib/utils";
import type { AdminJobRow } from "@/server/platform/support";

const TONE: Record<AdminJobRow["status"], "info" | "success" | "destructive" | "muted" | "warning"> = { QUEUED: "muted", RUNNING: "info", SUCCEEDED: "success", FAILED: "destructive", DEAD: "destructive", CANCELLED: "warning" };

function duration(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** Every organisation's jobs, with the two things a person does to one: try again, or stop it. */
export function AdminJobsTable({ rows }: { rows: AdminJobRow[] }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error ?? tr("That did not work"));
      else {
        if (result.message) toast.success(result.message);
        router.refresh();
      }
    });
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      dense
      empty={{ title: tr("No jobs match"), description: tr("Nothing has run with these filters.") }}
      columns={[
        {
          key: "job",
          header: tr("Job"),
          cell: (row) => (
            <button type="button" onClick={() => setOpen(open === row.id ? null : row.id)} className="text-left" data-no-row-link>
              <span className="block font-mono text-xs">{row.type}</span>
              {row.editionLabel ? <span className="block text-2xs text-muted-foreground">{row.editionLabel}</span> : null}
              {open === row.id && row.lastError ? <span className="mt-1 block max-w-xl whitespace-pre-wrap font-mono text-2xs text-destructive">{row.lastError}</span> : null}
              {open === row.id && row.progress ? <span className="mt-1 block text-2xs text-muted-foreground">{row.progress.done} / {row.progress.total} {row.progress.message ?? ""}</span> : null}
            </button>
          ),
        },
        { key: "org", header: tr("Organization"), cell: (row) => (row.organizationId ? <Link href={`/admin/organizations/${row.organizationId}`} className="text-xs hover:underline" data-no-row-link>{row.organizationName ?? row.organizationId.slice(0, 8)}</Link> : <span className="text-2xs text-muted-foreground">—</span>) },
        { key: "started", header: tr("Started"), cell: (row) => <span className="text-xs text-muted-foreground" title={formatDateTime(row.startedAt ?? row.runAt)}>{relativeTime(row.startedAt ?? row.runAt)}</span> },
        { key: "duration", header: tr("Duration"), cell: (row) => <span className="tabular text-xs">{duration(row.durationMs)}</span>, align: "right" },
        { key: "status", header: tr("Status"), cell: (row) => <Badge variant={TONE[row.status]}>{row.status.toLowerCase()}</Badge> },
        { key: "retries", header: tr("Tries"), cell: (row) => <span className="tabular text-xs">{row.attempts} / {row.maxAttempts}</span>, align: "right" },
        {
          key: "actions",
          header: "",
          cell: (row) => (
            <span className="flex justify-end gap-1" data-no-row-link>
              {row.status === "FAILED" || row.status === "DEAD" || row.status === "CANCELLED" ? (
                <Button variant="ghost" size="xs" disabled={pending} onClick={() => run(() => retryJobAction(row.id))}>
                  <RotateCcw /> {tr("Retry")}
                </Button>
              ) : null}
              {row.status === "QUEUED" || row.status === "RUNNING" ? (
                <Button variant="ghost" size="xs" disabled={pending} onClick={() => run(() => cancelJobAction(row.id))}>
                  <XCircle /> {tr("Cancel")}
                </Button>
              ) : null}
            </span>
          ),
          align: "right",
        },
      ]}
    />
  );
}
