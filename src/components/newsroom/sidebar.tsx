"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, Command as CommandIcon, Inbox, Sparkles } from "lucide-react";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";
import { NAV_ITEMS, resolveNavItem } from "./nav";
import { cn } from "@/lib/utils";
import { type Role } from "@/lib/auth/permissions";
import { STATUS_LABELS, type EditionStatus } from "@/lib/editorial/edition-state";
import { Kbd } from "@/components/ui/kbd";
import { useTranslations } from "@/components/i18n/provider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUi } from "@/components/i18n/provider";

export type SidebarEdition = { id: string; label: string; issueLabel: string; status: EditionStatus };

/**
 * The edition you are working on.
 *
 * It used to be a dropdown trigger with five nav items stapled underneath — the same five the
 * edition's own tab bar already shows. The items are gone; what they were really carrying, the two
 * counts that say something needs a person, moved onto the card itself and links straight to the
 * screen that resolves them. Nothing to read when there is nothing to do.
 *
 * The name and the switcher are siblings, not nested: a button inside a button is invalid HTML and
 * the browser will helpfully rearrange it for you.
 */
function WorkingOn({ current, editions, badges }: { current: SidebarEdition | null; editions: SidebarEdition[]; badges: { inbox: number; flags: number } }) {
  const tr = useUi();
  const t = useTranslations();
  return (
    <div className="px-3 pb-2 pt-2">
      <div className="rounded-md border border-sidebar-border bg-card shadow-xs">
        <div className="flex items-stretch">
          {current ? (
            <Link href={`/editions/${current.id}`} className="min-w-0 flex-1 rounded-l-md px-2.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent">
              <span className="label-caps block">{t("nav.workingOn")}</span>
              <span className="block truncate text-[13px] font-medium text-foreground">
                {current.label} · {current.issueLabel}
              </span>
              <span className="block truncate text-2xs text-muted-foreground">{tr(STATUS_LABELS[current.status])}</span>
            </Link>
          ) : (
            <Link href="/editions" className="min-w-0 flex-1 rounded-l-md px-2.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent">
              <span className="label-caps block">{t("nav.workingOn")}</span>
              <span className="block truncate text-[13px] font-medium text-muted-foreground">{t("nav.noEdition")}</span>
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("nav.switchEdition")}
              className="flex w-8 shrink-0 items-center justify-center rounded-r-md border-l border-sidebar-border text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ChevronsUpDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[216px]">
              <DropdownMenuLabel>{t("nav.switchEdition")}</DropdownMenuLabel>
              {editions.map((e) => (
                <DropdownMenuItem key={e.id} asChild>
                  <Link href={`/editions/${e.id}`} className="flex flex-col items-start gap-0">
                    <span className="text-[13px]">
                      {e.label} · {e.issueLabel}
                    </span>
                    <span className="text-2xs text-muted-foreground">{tr(STATUS_LABELS[e.status])}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/editions">{t("nav.allEditions")}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {current && (badges.inbox > 0 || badges.flags > 0) ? (
          <div className="flex gap-1 border-t border-sidebar-border px-1.5 py-1.5">
            {badges.inbox > 0 ? (
              <Link href={`/editions/${current.id}/inbox`} className="flex flex-1 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
                <Inbox className="size-3 shrink-0" />
                <span className="tabular font-semibold text-brand-foreground">{badges.inbox}</span>
                <span className="truncate">{t("nav.toReview")}</span>
              </Link>
            ) : null}
            {badges.flags > 0 ? (
              <Link href={`/editions/${current.id}/stories`} className="flex flex-1 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
                <Sparkles className="size-3 shrink-0" />
                <span className="tabular font-semibold text-brand-foreground">{badges.flags}</span>
                <span className="truncate">{t("nav.flagged")}</span>
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Sidebar({
  role,
  workspace,
  workspaces,
  impersonated,
  currentEdition,
  editions,
  badges,
  onOpenSearch,
}: {
  role: Role;
  workspace: { name: string; role: string } | null;
  workspaces: WorkspaceOption[];
  impersonated: boolean;
  currentEdition: SidebarEdition | null;
  editions: SidebarEdition[];
  badges: { inbox: number; flags: number };
  onOpenSearch: () => void;
}) {
  const tr = useUi();
  const pathname = usePathname();
  const t = useTranslations();
  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <WorkspaceSwitcher current={workspace} options={workspaces} impersonated={impersonated} />
      <WorkingOn current={currentEdition} editions={editions} badges={badges} />
      <nav className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin" aria-label={tr("Main")}>
        <ul className="space-y-px">
          {NAV_ITEMS.map((item) => {
            const resolved = resolveNavItem(role, item, pathname);
            if (!resolved) return null;
            return (
              <li key={item.href}>
                <Link
                  href={resolved.href}
                  // Each area owns a hue, and the icon carries it whether or not you are there — a
                  // colour that only appears on the page you are already looking at cannot help you
                  // find anything. Selection is carried by the tile and the weight instead.
                  style={{ "--area": `var(--${item.hue})`, "--area-soft": `var(--${item.hue}-soft)` } as React.CSSProperties}
                  className={cn(
                    "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                    resolved.active ? "bg-[var(--area-soft)] font-medium text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                  )}
                  aria-current={resolved.active ? "page" : undefined}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-[5px] transition-colors",
                      resolved.active ? "bg-[var(--area)] text-white" : "bg-[var(--area-soft)] text-[var(--area)] group-hover:bg-[var(--area)] group-hover:text-white",
                    )}
                  >
                    <item.icon className="size-3.5" />
                  </span>
                  <span className="flex-1 truncate">{t(item.label)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-sidebar-border p-2">
        <button type="button" onClick={onOpenSearch} className="flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-card px-2 text-left text-xs text-muted-foreground shadow-xs transition-colors hover:text-foreground">
          <CommandIcon className="size-3.5" />
          <span className="flex-1">{t("nav.search")}</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
    </aside>
  );
}
