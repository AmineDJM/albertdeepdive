"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Activity, ArrowLeft, BarChart3, Building2, CircleDollarSign, Coins, Flag, GalleryVerticalEnd, Gauge, LifeBuoy, LogOut, Plug, ScrollText, Server, Users, Wallet } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrieflyMark } from "@/components/brand/briefly-mark";
import { useUi } from "@/components/i18n/provider";
import { signOutAction } from "@/app/(newsroom)/actions";

/**
 * The console's own column: dense, dark, operational.
 *
 * Grouped the way the business is run — customers, revenue, operations, control — and holding
 * only sections that exist. There is no room here for a promise: a heading with no page behind it
 * is not on this list.
 */
export type AdminNavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };
export type AdminNavGroup = { label: string | null; items: AdminNavItem[] };

export function adminNavigation(tr: (text: string) => string): AdminNavGroup[] {
  return [
    { label: null, items: [{ href: "/admin", label: tr("Overview"), icon: Gauge, exact: true }] },
    {
      label: tr("Customers"),
      items: [
        { href: "/admin/organizations", label: tr("Organizations"), icon: Building2 },
        { href: "/admin/users", label: tr("Users"), icon: Users },
      ],
    },
    {
      label: tr("Acquisition"),
      items: [{ href: "/admin/collections", label: tr("Collections"), icon: GalleryVerticalEnd }],
    },
    {
      label: tr("Revenue"),
      items: [
        { href: "/admin/plans", label: tr("Plans & pricing"), icon: CircleDollarSign },
        { href: "/admin/billing", label: tr("Billing"), icon: Wallet },
      ],
    },
    {
      label: tr("Operations"),
      items: [
        { href: "/admin/analytics", label: tr("Platform analytics"), icon: BarChart3 },
        { href: "/admin/costs", label: tr("Usage & costs"), icon: Coins },
        { href: "/admin/providers", label: tr("Providers"), icon: Plug },
        { href: "/admin/jobs", label: tr("Jobs"), icon: Activity },
      ],
    },
    {
      label: tr("Control"),
      items: [
        { href: "/admin/flags", label: tr("Feature flags"), icon: Flag },
        { href: "/admin/audit", label: tr("Audit log"), icon: ScrollText },
        { href: "/admin/support", label: tr("Support"), icon: LifeBuoy },
        { href: "/admin/system", label: tr("System"), icon: Server },
      ],
    },
  ];
}

export function AdminSidebar({ user, workspaceHref }: { user: { name: string; email: string }; workspaceHref: string | null }) {
  const tr = useUi();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const groups = adminNavigation(tr);
  return (
    <aside className="flex h-full w-[224px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center gap-2 px-4">
        <BrieflyMark className="size-5" />
        <span className="text-[13px] font-semibold tracking-tight text-foreground">Briefly</span>
        <span className="rounded-[4px] border border-border px-1 py-px text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{tr("Admin")}</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin" aria-label={tr("Admin")}>
        {groups.map((group, index) => (
          <div key={group.label ?? index} className={cn(index > 0 && "mt-3")}>
            {group.label ? <p className="label-caps px-2 pb-1">{group.label}</p> : null}
            <ul className="space-y-px">
              {group.items.map((item) => {
                const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors duration-150", active ? "bg-sidebar-accent font-medium text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground")}>
                      <item.icon className={cn("size-3.5 shrink-0", active ? "text-brand" : "text-muted-foreground")} strokeWidth={1.75} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-sidebar-border p-2">
        {workspaceHref ? (
          <Link href={workspaceHref} className="flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground">
            <ArrowLeft className="size-3.5 text-muted-foreground" /> {tr("Back to the workspace")}
          </Link>
        ) : null}
        <div className="flex items-center gap-2 px-1.5 py-1">
          <Avatar className="size-6">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-2xs text-muted-foreground">{user.email}</span>
          </span>
          <button type="button" onClick={() => startTransition(async () => { await signOutAction(); })} aria-label={tr("Sign out")} title={tr("Sign out")} className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground">
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
