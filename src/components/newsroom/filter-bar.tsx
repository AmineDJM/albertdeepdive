"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type FilterOption = { value: string; label: string };
export type FilterDef = { key: string; label: string; options: FilterOption[]; allLabel?: string };

/** URL-synced filter bar: selects + search. Server components read the params. */
export function FilterBar({ filters, searchKey = "q", searchPlaceholder = "Search…", className, children }: { filters?: FilterDef[]; searchKey?: string | null; searchPlaceholder?: string; className?: string; children?: React.ReactNode }) {
  const tr = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchKey ? (params.get(searchKey) ?? "") : "");

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
      next.delete("page");
      startTransition(() => router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false }));
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (!searchKey) return;
    const current = params.get(searchKey) ?? "";
    if (query === current) return;
    const t = setTimeout(() => update(searchKey, query), 300);
    return () => clearTimeout(t);
  }, [query, searchKey, params, update]);

  const active = [...params.keys()].filter((k) => k !== "page" && k !== searchKey);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {searchKey ? (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} className="h-8 w-56 pl-8" aria-label={tr("Search")} />
        </div>
      ) : null}
      {filters?.map((f) => (
        <NativeSelect key={f.key} aria-label={f.label} value={params.get(f.key) ?? "all"} onChange={(e) => update(f.key, e.target.value)} className="w-auto min-w-32 pr-8">
          <option value="all">{f.allLabel ?? `All ${f.label.toLowerCase()}`}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      ))}
      {children}
      {active.length ? (
        <Button variant="ghost" size="sm" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>
          <X />{" "}{tr("Clear")}</Button>
      ) : null}
      {pending ? <span className="text-2xs text-muted-foreground">{tr("Updating…")}</span> : null}
    </div>
  );
}
