"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type LinkTab = { key: string; label: string; count?: number | null };

/** Underline tabs driven by a `?tab=` search param. Other params are dropped when switching. */
export function LinkTabs({ tabs, active, param = "tab", keep = [] }: { tabs: LinkTab[]; active: string; param?: string; keep?: string[] }) {
  const tr = useUi();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <nav className="flex h-9 items-center gap-4 border-b border-border" aria-label={tr("Views")}>
      {tabs.map((t) => {
        const next = new URLSearchParams();
        next.set(param, t.key);
        for (const k of keep) {
          const v = params.get(k);
          if (v) next.set(k, v);
        }
        const isActive = t.key === active;
        return (
          <Link key={t.key} href={`${pathname}?${next.toString()}`} aria-current={isActive ? "page" : undefined} className={cn("relative flex h-9 items-center gap-1.5 px-0.5 text-[13px] font-medium whitespace-nowrap transition-colors", isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
            {typeof t.count === "number" ? <span className="tabular rounded-sm bg-muted px-1 text-2xs text-muted-foreground">{t.count}</span> : null}
            {isActive ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-brand" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
