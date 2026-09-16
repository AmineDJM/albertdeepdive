"use client";

import { ChartCard } from "@/components/analytics/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type HeatmapRow = { key: string; label: string; values: Record<string, number>; total: number };
export type HeatmapColumn = { key: string; label: string };

/** Five steps of a single hue, mixed into the card surface: light means little, dark means a lot. */
const STEPS = [0, 12, 28, 46, 68];

function stepFor(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** Step 0 keeps a faint track so the grid still reads as a grid where nothing was published. */
function fill(step: number) {
  return step === 0 ? "var(--viz-hover)" : `color-mix(in oklch, var(--series-1) ${STEPS[step]}%, var(--viz-surface))`;
}

/**
 * A magnitude grid (rows × columns) on a sequential single-hue ramp. Every cell prints its own
 * number, so the colour is a second reading of the value and never the only one; a scale legend
 * and a table twin complete it.
 */
export function HeatmapCard({ title, description, rows, columns, max, unit = "stories", className, emptyText = "Nothing planned yet." }: { title: string; description?: string; rows: HeatmapRow[]; columns: HeatmapColumn[]; max: number; unit?: string; className?: string; emptyText?: string }) {
  const empty = !rows.length || !columns.length || max <= 0;
  return (
    <ChartCard
      title={title}
      description={description}
      empty={empty}
      emptyText={emptyText}
      className={className}
      table={
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Section</TableHead>
                {columns.map((c) => (
                  <TableHead key={c.key} className="text-right">
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="py-1.5">{r.label}</TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} className="tabular py-1.5 text-right">
                      {r.values[c.key] ?? 0}
                    </TableCell>
                  ))}
                  <TableCell className="tabular py-1.5 text-right font-medium">{r.total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      }
      chart={
        <div className="px-2 pb-1">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[420px] border-separate border-spacing-[2px]">
              <caption className="sr-only">{`${title}: ${unit} per section and edition`}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-[38%] px-1 pb-1 text-left text-2xs font-medium text-muted-foreground">
                    Section
                  </th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className="px-1 pb-1 text-center text-2xs font-medium text-muted-foreground">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="truncate px-1 py-0.5 text-left text-xs font-normal">
                      {r.label}
                    </th>
                    {columns.map((c) => {
                      const value = r.values[c.key] ?? 0;
                      const step = stepFor(value, max);
                      return (
                        <td key={c.key} className="p-0">
                          <div className="tabular flex h-7 items-center justify-center rounded-[4px] text-xs font-medium text-[var(--viz-text)]" style={{ background: fill(step) }} title={`${r.label} · ${c.label}: ${value} ${unit}`}>
                            {value === 0 ? <span className="text-muted-foreground">·</span> : value}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2.5 flex items-center gap-2 px-1 text-2xs text-muted-foreground">
            <span>None</span>
            <span className="flex gap-[2px]" aria-hidden>
              {STEPS.map((_, i) => (
                <span key={i} className="size-3 rounded-[3px] border border-border/60" style={{ background: fill(i) }} />
              ))}
            </span>
            <span>{max} {unit}</span>
          </div>
        </div>
      }
    />
  );
}
