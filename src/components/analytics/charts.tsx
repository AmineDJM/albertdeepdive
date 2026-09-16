"use client";

import { useId, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ChartDatum = { label: string; value: number; [key: string]: string | number | null };
export type SeriesDef = { key: string; label: string; role?: 1 | 2 | 3 };

const nf = new Intl.NumberFormat("en-GB");
const fmt = (v: number | null | undefined, format?: (n: number) => string) => (v === null || v === undefined ? "—" : format ? format(v) : nf.format(v));

const TICK = { fontSize: 11, fill: "var(--viz-muted)" } as const;

function Swatch({ role, shape = "rect" }: { role: 1 | 2 | 3; shape?: "rect" | "line" }) {
  return shape === "line" ? (
    <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: `var(--series-${role})` }} />
  ) : (
    <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: `var(--series-${role})` }} />
  );
}

/** Card shell: title, optional legend, chart/table toggle (the table is the accessible twin of every chart). */
export function ChartCard({ title, description, series, shape = "rect", empty, emptyText = "Nothing to chart yet.", chart, table, className }: { title: string; description?: string; series?: SeriesDef[]; shape?: "rect" | "line"; empty: boolean; emptyText?: string; chart: React.ReactNode; table: React.ReactNode; className?: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const id = useId();
  return (
    <section className={cn("viz-root flex flex-col rounded-lg border border-border bg-card shadow-xs", className)} aria-labelledby={`${id}-title`}>
      <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-[13px] font-semibold">
            {title}
          </h3>
          {description ? <p className="mt-0.5 text-2xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {series && series.length > 1 ? (
            <ul className="flex items-center gap-3 text-2xs text-muted-foreground" aria-label="Legend">
              {series.map((s, i) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <Swatch role={s.role ?? ((i + 1) as 1 | 2 | 3)} shape={shape} />
                  {s.label}
                </li>
              ))}
            </ul>
          ) : null}
          {!empty ? (
            <div className="inline-flex h-6 items-center rounded-md bg-muted p-0.5" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={view === "chart"} onClick={() => setView("chart")} className={cn("inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground", view === "chart" && "bg-card text-foreground shadow-xs")} aria-label="Chart view">
                <BarChart3 className="size-3.5" />
              </button>
              <button type="button" role="tab" aria-selected={view === "table"} onClick={() => setView("table")} className={cn("inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground", view === "table" && "bg-card text-foreground shadow-xs")} aria-label="Table view">
                <Table2 className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <div className="px-2 pb-3">
        {empty ? <p className="px-2 py-10 text-center text-xs text-muted-foreground">{emptyText}</p> : view === "chart" ? chart : <div className="px-2">{table}</div>}
      </div>
    </section>
  );
}

function ValueTooltip({ active, payload, label, series, format }: { active?: boolean; payload?: { dataKey?: string | number; value?: number | string; name?: string }[]; label?: string | number; series: SeriesDef[]; format?: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      <ul className="space-y-0.5">
        {payload.map((p, i) => {
          const def = series.find((s) => s.key === p.dataKey) ?? series[i];
          const role = def?.role ?? ((i + 1) as 1 | 2 | 3);
          return (
            <li key={String(p.dataKey ?? i)} className="flex items-center gap-2">
              <Swatch role={role} shape="line" />
              <span className="tabular font-semibold text-foreground">{fmt(typeof p.value === "number" ? p.value : Number(p.value), format)}</span>
              <span className="text-muted-foreground">{def?.label ?? p.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DataTableView({ data, series, format }: { data: ChartDatum[]; series: SeriesDef[]; format?: (n: number) => string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Label</TableHead>
            {series.map((s) => (
              <TableHead key={s.key} className="text-right">
                {s.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((d) => (
            <TableRow key={d.label}>
              <TableCell className="py-1.5">{d.label}</TableCell>
              {series.map((s) => (
                <TableCell key={s.key} className="tabular py-1.5 text-right">
                  {fmt(typeof d[s.key] === "number" ? (d[s.key] as number) : null, format)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Single-series bars: `horizontal` lays the bars across (long category names), otherwise columns. */
export function BarChartCard({ title, description, data, valueLabel, horizontal = false, format, height, className, emptyText }: { title: string; description?: string; data: ChartDatum[]; valueLabel: string; horizontal?: boolean; format?: (n: number) => string; height?: number; className?: string; emptyText?: string }) {
  const series: SeriesDef[] = [{ key: "value", label: valueLabel, role: 1 }];
  const empty = !data.length || data.every((d) => !d.value);
  const h = height ?? (horizontal ? Math.max(140, 26 * data.length + 36) : 220);
  const labelEvery = data.length <= 14;
  const longest = Math.max(0, ...data.map((d) => d.label.length));
  return (
    <ChartCard title={title} description={description} series={series} empty={empty} emptyText={emptyText} className={className} table={<DataTableView data={data} series={series} format={format} />} chart={
      <div style={{ height: h }} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${fmt(d.value, format)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          {horizontal ? (
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 0, left: 4 }} barCategoryGap={6} accessibilityLayer>
              <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v: number) => fmt(v, format)} />
              <YAxis type="category" dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} width={Math.min(180, Math.max(64, longest * 6.4))} interval={0} />
              <Tooltip cursor={{ fill: "var(--viz-hover)" }} content={<ValueTooltip series={series} format={format} />} />
              <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                {labelEvery ? <LabelList dataKey="value" position="right" offset={6} fill="var(--viz-text)" fontSize={11} formatter={(v: unknown) => (typeof v === "number" && v > 0 ? fmt(v, format) : "")} /> : null}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -12 }} barCategoryGap="28%" accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} interval={data.length > 10 ? "preserveStartEnd" : 0} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v: number) => fmt(v, format)} />
              <Tooltip cursor={{ fill: "var(--viz-hover)" }} content={<ValueTooltip series={series} format={format} />} />
              <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                {labelEvery ? <LabelList dataKey="value" position="top" offset={5} fill="var(--viz-text)" fontSize={11} formatter={(v: unknown) => (typeof v === "number" && v > 0 ? fmt(v, format) : "")} /> : null}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    } />
  );
}

/** Two series side by side per category (e.g. submissions vs selected stories per campus). */
export function GroupedBarCard({ title, description, data, series, format, height = 220, className, emptyText }: { title: string; description?: string; data: ChartDatum[]; series: [SeriesDef, SeriesDef]; format?: (n: number) => string; height?: number; className?: string; emptyText?: string }) {
  const defs: SeriesDef[] = series.map((s, i) => ({ ...s, role: s.role ?? ((i + 1) as 1 | 2) }));
  const empty = !data.length || data.every((d) => defs.every((s) => !d[s.key]));
  return (
    <ChartCard title={title} description={description} series={defs} empty={empty} emptyText={emptyText} className={className} table={<DataTableView data={data} series={defs} format={format} />} chart={
      <div style={{ height }} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${defs.map((s) => `${s.label} ${fmt(d[s.key] as number, format)}`).join(", ")}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -12 }} barGap={2} barCategoryGap="28%" accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} interval={0} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v: number) => fmt(v, format)} />
            <Tooltip cursor={{ fill: "var(--viz-hover)" }} content={<ValueTooltip series={defs} format={format} />} />
            {defs.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={`var(--series-${s.role})`} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false}>
                <LabelList dataKey={s.key} position="top" offset={5} fill="var(--viz-text)" fontSize={10.5} formatter={(v: unknown) => (typeof v === "number" && v > 0 ? fmt(v, format) : "")} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    } />
  );
}

/** Single-series area over time with a crosshair tooltip; the tooltip also lists the running total. */
export function AreaChartCard({ title, description, data, valueLabel, cumulativeLabel = "Running total", height = 220, className, emptyText }: { title: string; description?: string; data: (ChartDatum & { cumulative?: number })[]; valueLabel: string; cumulativeLabel?: string; height?: number; className?: string; emptyText?: string }) {
  const series: SeriesDef[] = [{ key: "value", label: valueLabel, role: 1 }, { key: "cumulative", label: cumulativeLabel, role: 2 }];
  const empty = !data.length || data.every((d) => !d.value);
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] ?? { label: "", value: 0 });
  return (
    <ChartCard title={title} description={description} series={[series[0]]} shape="line" empty={empty} emptyText={emptyText} className={className} table={<DataTableView data={data} series={series} />} chart={
      <div style={{ height }} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: -12 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }} content={<ValueTooltip series={series} />} />
            <Area type="monotone" dataKey="value" name={valueLabel} stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: "var(--viz-surface)", strokeWidth: 2, fill: "var(--series-1)" }} isAnimationActive={false}>
              <LabelList dataKey="value" position="top" offset={6} fill="var(--viz-text)" fontSize={11} formatter={(v: unknown) => (typeof v === "number" && v > 0 && v === peak.value ? String(v) : "")} />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    } />
  );
}
