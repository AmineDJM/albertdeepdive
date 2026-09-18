"use client";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { enumLabel } from "@/lib/utils";
import type { PreviewRow, RowStatus } from "@/server/audience/import";
import { useUi } from "@/components/i18n/provider";

const STATUS_META: Record<RowStatus, { label: string; variant: "success" | "info" | "muted" }> = {
  create: { label: "New", variant: "success" },
  update: { label: "Update", variant: "info" },
  skip: { label: "Skip", variant: "muted" },
};

/** Read-only preview of the resolved rows with their status and any per-row issue badges. */
export function ImportPreviewTable({ rows }: { rows: PreviewRow[] }) {
  const tr = useUi();
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right tabular">#</TableHead>
            <TableHead>{tr("Recipient")}</TableHead>
            <TableHead>{tr("Email")}</TableHead>
            <TableHead>{tr("Segment")}</TableHead>
            <TableHead>{tr("Organisation")}</TableHead>
            <TableHead>{tr("Campus")}</TableHead>
            <TableHead>{tr("Status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const meta = STATUS_META[r.status];
            const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
            return (
              <TableRow key={r.line} className={r.status === "skip" ? "opacity-70" : undefined}>
                <TableCell className="text-right text-2xs text-muted-foreground tabular">{r.line}</TableCell>
                <TableCell className="font-medium">{name || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.email || "—"}</TableCell>
                <TableCell className="text-xs">{tr(enumLabel(r.segment))}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.organisation || "—"}</TableCell>
                <TableCell className="text-xs">
                  {r.campusId ? r.campusLabel : <span className="text-muted-foreground">{tr("School-wide")}</span>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    {r.badges.map((b, i) => (
                      <Badge key={i} variant={b.tone === "destructive" ? "destructive" : b.tone === "warning" ? "warning" : b.tone === "info" ? "info" : "muted"}>
                        {b.label}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
