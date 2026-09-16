"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function EditionTabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav className="ml-auto flex h-full items-center gap-0.5 overflow-x-auto" aria-label="Edition sections">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} className={cn("relative flex h-11 items-center px-2.5 text-xs font-medium whitespace-nowrap transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")} aria-current={active ? "page" : undefined}>
            {t.label}
            {active ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-brand" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
