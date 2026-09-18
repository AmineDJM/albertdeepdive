"use client";

import { ChartCard } from "@/components/analytics/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUi } from "@/components/i18n/provider";

export type FunnelRow = { key: string; label: string; value: number; hint?: string };

const nf = new Intl.NumberFormat("en-GB");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * An ordered drop-off chart: one bar per stage, all in categorical slot 1 (the stages are one
 * series, not competing entities). Every stage carries its own value and the share it kept from
 * the previous stage, so nothing depends on bar length or colour alone.
 */
export function FunnelCard({ title, description, rows, className }: { title: string; description?: string; rows: FunnelRow[]; className?: string }) {
  const tr = useUi();
  const max = Math.max(0, ...rows.map((r) => r.value));
  const empty = !rows.length || max === 0;
  return (
    <ChartCard
      title={title}
      description={description}
      empty={empty}
      emptyText="No contributions in this window yet."
      className={className}
      table={
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{tr("Stage")}</TableHead>
                <TableHead className="text-right">{tr("Count")}</TableHead>
                <TableHead className="text-right">{tr("Of previous")}</TableHead>
                <TableHead className="text-right">{tr("Of start")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.key}>
                  <TableCell className="py-1.5">{r.label}</TableCell>
                  <TableCell className="tabular py-1.5 text-right">{nf.format(r.value)}</TableCell>
                  <TableCell className="tabular py-1.5 text-right">{i === 0 ? "—" : pct(r.value, rows[i - 1].value)}</TableCell>
                  <TableCell className="tabular py-1.5 text-right">{i === 0 ? "100%" : pct(r.value, rows[0].value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      }
      chart={
        <ol className="space-y-2 px-2 py-1" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`}>
          {rows.map((r, i) => {
            const width = max > 0 ? Math.max(2, Math.round((r.value / max) * 100)) : 0;
            const kept = i === 0 ? null : pct(r.value, rows[i - 1].value);
            return (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-xs font-medium">{r.label}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="tabular text-xs font-semibold">{nf.format(r.value)}</span>
                    {kept ? <span className="tabular text-2xs text-muted-foreground">{kept} {" "}{tr("kept")}</span> : <span className="text-2xs text-muted-foreground">{tr("start")}</span>}
                  </span>
                </div>
                <div className="mt-1 h-3 w-full overflow-hidden rounded-[4px] bg-[var(--viz-hover)]" title={`${r.label}: ${nf.format(r.value)}${r.hint ? ` — ${r.hint}` : ""}`}>
                  <div className="h-full rounded-[4px] transition-[width]" style={{ width: `${width}%`, background: "var(--series-1)" }} />
                </div>
                {r.hint ? <p className="mt-0.5 text-2xs text-muted-foreground">{r.hint}</p> : null}
              </li>
            );
          })}
        </ol>
      }
    />
  );
}
