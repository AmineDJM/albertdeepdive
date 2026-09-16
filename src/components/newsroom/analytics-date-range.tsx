"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";

const PRESETS: { value: string; label: string; days: number | null }[] = [
  { value: "all", label: "All time", days: null },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "12m", label: "Last 12 months", days: 365 },
];

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * URL-synced activity window (`from` / `to`, inclusive days). The selected preset is computed on
 * the server from the same two params, so the control has no state of its own to drift.
 */
export function DateRangeFilter({ preset }: { preset: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(next: URLSearchParams) {
    next.delete("page");
    startTransition(() => router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false }));
  }

  function choosePreset(value: string) {
    const next = new URLSearchParams(params.toString());
    const found = PRESETS.find((p) => p.value === value);
    if (!found || found.days === null) {
      next.delete("from");
      next.delete("to");
    } else {
      const to = new Date();
      const from = new Date(to.getTime() - found.days * 86_400_000);
      next.set("from", isoDay(from));
      next.set("to", isoDay(to));
    }
    apply(next);
  }

  function setBound(key: "from" | "to", value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    apply(next);
  }

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="Activity window" value={PRESETS.some((p) => p.value === preset) ? preset : "custom"} onChange={(e) => choosePreset(e.target.value)} className="w-auto min-w-36 pr-8">
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range</option>
      </NativeSelect>
      <div className="flex items-center gap-1.5 rounded-md border border-input bg-card px-2 shadow-xs">
        <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {/* The browser paints its own chrome (caret, spin buttons) into a date field before React hydrates, which React would otherwise report as a mismatch. */}
        <Input suppressHydrationWarning type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setBound("from", e.target.value)} className="h-7 w-[8.5rem] border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" />
        <span className="text-2xs text-muted-foreground">to</span>
        <Input suppressHydrationWarning type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setBound("to", e.target.value)} className="h-7 w-[8.5rem] border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" />
      </div>
      {pending ? <span className="text-2xs text-muted-foreground">Updating…</span> : null}
    </div>
  );
}
