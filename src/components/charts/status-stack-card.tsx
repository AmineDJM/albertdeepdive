"use client";

import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
import { ChartCard } from "@/components/analytics/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type StatusSeries = { key: string; label: string; tone: "success" | "warning" | "destructive" };
export type StatusStackRow = { key: string; label: string; values: Record<string, number>; total: number };

const TONE: Record<StatusSeries["tone"], string> = { success: "var(--success)", warning: "var(--warning)", destructive: "var(--destructive)" };

/** The tone names its own icon, so a status is never carried by colour alone. */
const ICON: Record<StatusSeries["tone"], React.ComponentType<{ className?: string }>> = { success: CircleCheck, warning: TriangleAlert, destructive: CircleSlash };

const nf = new Intl.NumberFormat("en-GB");

/**
 * Part-to-whole across a reserved status palette (cleared / unclear / blocked). Status colour
 * never stands alone: each series carries an icon and a word in the legend, every segment is
 * labelled in the row summary, and the table twin holds the exact counts.
 */
export function StatusStackCard({ title, description, rows, series, unit = "assets", className, emptyText = "Nothing to show yet." }: { title: string; description?: string; rows: StatusStackRow[]; series: StatusSeries[]; unit?: string; className?: string; emptyText?: string }) {
  const empty = !rows.length || rows.every((r) => r.total === 0);
  return (
    <ChartCard
      title={title}
      description={description}
      empty={empty}
      emptyText={emptyText}
      className={className}
      table={
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Edition</TableHead>
                {series.map((s) => (
                  <TableHead key={s.key} className="text-right">
                    {s.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="py-1.5">{r.label}</TableCell>
                  {series.map((s) => (
                    <TableCell key={s.key} className="tabular py-1.5 text-right">
                      {nf.format(r.values[s.key] ?? 0)}
                    </TableCell>
                  ))}
                  <TableCell className="tabular py-1.5 text-right font-medium">{nf.format(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      }
      chart={
        <div className="space-y-3 px-2 py-1">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Legend">
            {series.map((s) => {
              const Icon = ICON[s.tone];
              return (
                <li key={s.key} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <span aria-hidden className="inline-flex size-3.5 items-center justify-center rounded-[3px]" style={{ background: TONE[s.tone] }}>
                    <Icon className="size-2.5 text-white" />
                  </span>
                  {s.label}
                </li>
              );
            })}
          </ul>
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-xs font-medium">{r.label}</span>
                  <span className="tabular shrink-0 text-2xs text-muted-foreground">
                    {series.map((s, i) => `${nf.format(r.values[s.key] ?? 0)} ${s.label.toLowerCase()}${i < series.length - 1 ? " · " : ""}`).join("")}
                  </span>
                </div>
                <div className="mt-1 flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px] bg-[var(--viz-hover)]">
                  {series.map((s) => {
                    const value = r.values[s.key] ?? 0;
                    if (!value || !r.total) return null;
                    return <span key={s.key} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ width: `${(value / r.total) * 100}%`, background: TONE[s.tone] }} title={`${r.label} · ${s.label}: ${nf.format(value)} ${unit}`} />;
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      }
    />
  );
}
