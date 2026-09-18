"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

/**
 * The one tab bar.
 *
 * Used for the tabs inside an edition and for the tabs that group the workspace pages, so those two
 * levels look and behave the same and nobody has to learn a second pattern. `exact` exists because
 * an edition's control room lives at the parent path of all its siblings.
 */
export function TabBar({ tabs, className, align = "start" }: { tabs: { href: string; label: string; exact?: boolean }[]; className?: string; align?: "start" | "end" }) {
  const tr = useUi();
  const pathname = usePathname();
  return (
    <nav className={cn("flex h-full items-center gap-0.5 overflow-x-auto scrollbar-thin", align === "end" && "ml-auto", className)} aria-label={tr("Sections")}>
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn("relative flex h-9 items-center px-2.5 text-xs font-medium whitespace-nowrap transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
            {active ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-brand" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
