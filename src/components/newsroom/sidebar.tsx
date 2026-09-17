"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, Command as CommandIcon } from "lucide-react";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";
import { NAV_GROUPS } from "./nav";
import { cn } from "@/lib/utils";
import { roleHasPermission, type Role } from "@/lib/auth/permissions";
import { STATUS_LABELS, type EditionStatus } from "@/lib/editorial/edition-state";
import { Kbd } from "@/components/ui/kbd";
import { useTranslations } from "@/components/i18n/provider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type SidebarEdition = { id: string; label: string; issueLabel: string; status: EditionStatus };

export function Sidebar({ role, workspace, workspaces, impersonated, currentEdition, editions, badges, onOpenSearch }: { role: Role; workspace: { name: string; role: string } | null; workspaces: WorkspaceOption[]; impersonated: boolean; currentEdition: SidebarEdition | null; editions: SidebarEdition[]; badges: { inbox: number; flags: number }; onOpenSearch: () => void }) {
  const pathname = usePathname();
  const t = useTranslations();
  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <WorkspaceSwitcher current={workspace} options={workspaces} impersonated={impersonated} />
      <div className="px-3 pb-2 pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center justify-between gap-2 rounded-md border border-sidebar-border bg-card px-2.5 py-1.5 text-left shadow-xs transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
            <span className="min-w-0">
              <span className="label-caps block">Working on</span>
              <span className="block truncate text-[13px] font-medium text-foreground">{currentEdition ? `${currentEdition.label} · ${currentEdition.issueLabel}` : "No edition"}</span>
              {currentEdition ? <span className="block truncate text-2xs text-muted-foreground">{STATUS_LABELS[currentEdition.status]}</span> : null}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[216px]">
            <DropdownMenuLabel>Switch edition</DropdownMenuLabel>
            {editions.map((e) => (
              <DropdownMenuItem key={e.id} asChild>
                <Link href={`/editions/${e.id}`} className="flex flex-col items-start gap-0">
                  <span className="text-[13px]">{e.label} · {e.issueLabel}</span>
                  <span className="text-2xs text-muted-foreground">{STATUS_LABELS[e.status]}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/editions">All editions</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin" aria-label="Main">
        {NAV_GROUPS.map((group, gi) => {
          const items = group.items.filter((item) => !item.permission || roleHasPermission(role, item.permission));
          if (!items.length) return null;
          return (
            <div key={gi} className="mb-2">
              {group.label ? <div className="label-caps px-2 pt-2 pb-1">{t(group.label)}</div> : null}
              <ul className="space-y-px">
                {items.map((item) => {
                  const href = item.editionScoped && currentEdition ? `/editions/${currentEdition.id}/${item.href.slice(1)}` : item.href;
                  const active = item.editionScoped ? pathname.includes(`/${item.href.slice(1)}`) && pathname.startsWith("/editions/") : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const badge = item.badgeKey ? badges[item.badgeKey] : 0;
                  return (
                    <li key={item.href}>
                      <Link href={href} className={cn("group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors", active ? "bg-sidebar-accent font-medium text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-foreground")} aria-current={active ? "page" : undefined}>
                        <item.icon className={cn("size-4", active ? "text-brand" : "text-muted-foreground group-hover:text-foreground")} />
                        <span className="flex-1 truncate">{t(item.label)}</span>
                        {badge ? <span className="tabular rounded-sm bg-brand-soft px-1 text-2xs font-semibold text-brand-foreground">{badge}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        <button type="button" onClick={onOpenSearch} className="flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-card px-2 text-left text-xs text-muted-foreground shadow-xs transition-colors hover:text-foreground">
          <CommandIcon className="size-3.5" />
          <span className="flex-1">Search or jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
    </aside>
  );
}
