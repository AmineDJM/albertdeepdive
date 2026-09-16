"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type ArchiveTab = { key: string; label: string; count?: number };

/** Link-based tabs that keep the search query while switching views. */
export function ArchiveTabs({ tabs, active }: { tabs: ArchiveTab[]; active: string }) {
  const params = useSearchParams();
  const q = params.get("q");
  return (
    <nav className="flex h-9 items-center gap-4 border-b border-border" aria-label="Archive views">
      {tabs.map((t) => {
        const href = `/archive?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
        const isActive = t.key === active;
        return (
          <Link key={t.key} href={href} aria-current={isActive ? "page" : undefined} className={cn("relative flex h-9 items-center gap-1.5 px-0.5 text-[13px] font-medium whitespace-nowrap transition-colors", isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
            {typeof t.count === "number" ? <span className="tabular rounded-sm bg-muted px-1 text-2xs text-muted-foreground">{t.count}</span> : null}
            {isActive ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-brand" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
