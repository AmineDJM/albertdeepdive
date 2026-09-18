"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Bell, ChevronsUpDown, HelpCircle, Inbox, LogOut, Moon, Search, Shield, Sparkles, Sun, UserRound } from "lucide-react";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";
import { navItemsFor, resolveNavItem, type NavItem } from "./nav";
import { useExperience } from "@/components/experience/provider";
import { cn, initials, relativeTime } from "@/lib/utils";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { STATUS_LABELS, type EditionStatus } from "@/lib/editorial/edition-state";
import { Kbd } from "@/components/ui/kbd";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LanguagePicker } from "@/components/i18n/language-picker";
import { useTranslations, useUi } from "@/components/i18n/provider";
import { BrieflyLogo } from "@/components/brand/briefly-mark";
import { markAllNotificationsReadAction, markNotificationReadAction, signOutAction } from "@/app/(newsroom)/actions";

export type SidebarEdition = { id: string; label: string; issueLabel: string; status: EditionStatus };
export type SidebarNotification = { id: string; title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date; type: string };
export type SidebarPlan = { name: string; usedLabel: string; ratio: number | null; href: string };
export type SidebarUser = { name: string; email: string; role: Role };

/**
 * The one column every screen shares.
 *
 * Top to bottom, in the order a day goes: the product, the workspace, the edition in hand, the six
 * places to work, the two places to set things up, and — at the foot, where a person looks for
 * themselves — the plan, the bell, the search and the account. There is no bar above the page:
 * the page's own header carries its title and its actions, and the column carries everything
 * that is not about this page.
 *
 * Colour is used the way a map uses it: each area owns a hue that appears on its icon and
 * nowhere louder. Selection is a tint and a weight, not a colour.
 */

function WorkingOn({ current, editions, badges }: { current: SidebarEdition | null; editions: SidebarEdition[]; badges: { inbox: number; flags: number } }) {
  const tr = useUi();
  const t = useTranslations();
  return (
    <div className="px-3 pb-1 pt-1">
      <div className="rounded-lg border border-sidebar-border bg-card shadow-xs">
        <div className="flex items-stretch">
          <Link href={current ? `/editions/${current.id}` : "/editions"} className="min-w-0 flex-1 rounded-l-lg px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-sidebar-accent/60">
            <span className="label-caps block">{t("nav.workingOn")}</span>
            {current ? (
              <>
                <span className="block truncate text-[13px] font-medium text-foreground">{current.label}</span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {current.issueLabel} · {tr(STATUS_LABELS[current.status])}
                </span>
              </>
            ) : (
              <span className="block truncate text-[13px] font-medium text-muted-foreground">{t("nav.noEdition")}</span>
            )}
          </Link>
          {editions.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={t("nav.switchEdition")} className="flex w-8 shrink-0 items-center justify-center rounded-r-lg border-l border-sidebar-border text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                <ChevronsUpDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[224px]">
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
          ) : null}
        </div>
        {current && (badges.inbox > 0 || badges.flags > 0) ? (
          <div className="flex gap-1 border-t border-sidebar-border px-1.5 py-1">
            {badges.inbox > 0 ? (
              <Link href={`/editions/${current.id}/inbox`} className="flex flex-1 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground">
                <Inbox className="size-3 shrink-0" />
                <span className="tabular font-semibold text-brand-foreground">{badges.inbox}</span>
                <span className="truncate">{t("nav.toReview")}</span>
              </Link>
            ) : null}
            {badges.flags > 0 ? (
              <Link href={`/editions/${current.id}/stories?flag=needs_attention`} className="flex flex-1 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground">
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

function NavLink({ item, role, pathname }: { item: NavItem; role: Role; pathname: string }) {
  const t = useTranslations();
  const resolved = resolveNavItem(role, item, pathname);
  if (!resolved) return null;
  return (
    <li>
      <Link
        href={resolved.href}
        style={{ "--area": `var(--${item.hue})`, "--area-soft": `var(--${item.hue}-soft)`, "--area-deep": `var(--${item.hue}-deep)` } as React.CSSProperties}
        className={cn(
          "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-150",
          resolved.active ? "bg-sidebar-accent font-medium text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
        aria-current={resolved.active ? "page" : undefined}
      >
        <item.icon className={cn("size-4 shrink-0 transition-colors duration-150", resolved.active ? "text-[var(--area-deep)]" : "text-muted-foreground group-hover:text-[var(--area-deep)]")} strokeWidth={1.75} />
        <span className="flex-1 truncate">{t(item.label)}</span>
      </Link>
    </li>
  );
}

function Notifications({ notifications, unread }: { notifications: SidebarNotification[]; unread: number }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`${tr("Notifications")}${unread ? ` (${unread})` : ""}`} className="relative text-muted-foreground hover:text-foreground">
              <Bell className="size-4" />
              {unread ? <span className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-brand text-[9px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{tr("Notifications")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" side="top" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[13px] font-semibold">{tr("Notifications")}</span>
          {unread ? (
            <Button variant="ghost" size="xs" disabled={pending} onClick={() => startTransition(async () => { await markAllNotificationsReadAction(); router.refresh(); })}>
              {tr("Mark all read")}
            </Button>
          ) : null}
        </div>
        <ul className="max-h-[380px] overflow-y-auto scrollbar-thin">
          {notifications.length === 0 ? <li className="px-3 py-8 text-center text-xs text-muted-foreground">{tr("You’re all caught up.")}</li> : null}
          {notifications.map((n) => (
            <li key={n.id} className={cn("border-b last:border-0", !n.readAt && "bg-brand-soft/30")}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-muted/60"
                onClick={() =>
                  startTransition(async () => {
                    if (!n.readAt) await markNotificationReadAction(n.id);
                    if (n.href) router.push(n.href);
                    else router.refresh();
                  })
                }
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{n.title}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground">{relativeTime(n.createdAt)}</span>
                </span>
                {n.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function AccountMenu({ user }: { user: SidebarUser }) {
  const tr = useUi();
  const t = useTranslations();
  const { theme, setTheme } = useTheme();
  const [, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={tr("Account menu")} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-150 hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <Avatar className="size-6">
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">{user.name}</span>
          <span className="block truncate text-2xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <div className="text-[13px] font-medium text-foreground">{user.name}</div>
          <div className="text-2xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-2xs text-muted-foreground">{tr("Language")}</span>
          <LanguagePicker />
        </div>
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setTheme(theme === "dark" ? "light" : "dark"); }}>
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" /> {tr("Toggle theme")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserRound /> {tr("Profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/help">
            <HelpCircle /> {tr("How the newsroom works")}
          </Link>
        </DropdownMenuItem>
        {user.role === "SUPER_ADMIN" ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield /> {t("nav.admin")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => startTransition(async () => { await signOutAction(); })}>
          <LogOut /> {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar({ user, role, workspace, workspaces, impersonated, currentEdition, editions, badges, notifications, unread, plan, onOpenSearch }: { user: SidebarUser; role: Role; workspace: { name: string; role: string } | null; workspaces: WorkspaceOption[]; impersonated: boolean; currentEdition: SidebarEdition | null; editions: SidebarEdition[]; badges: { inbox: number; flags: number }; notifications: SidebarNotification[]; unread: number; plan: SidebarPlan | null; onOpenSearch: () => void }) {
  const tr = useUi();
  const t = useTranslations();
  const pathname = usePathname();
  const nav = navItemsFor(useExperience());
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center px-4">
        <Link href={workspace ? "/overview" : "/admin"} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label="Briefly">
          <BrieflyLogo height={20} />
        </Link>
      </div>
      <WorkspaceSwitcher current={workspace} options={workspaces} impersonated={impersonated} />
      {workspace ? <WorkingOn current={currentEdition} editions={editions} badges={badges} /> : null}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 pt-1 scrollbar-thin" aria-label={tr("Main")}>
        {workspace ? (
          <>
            <ul className="space-y-px">
              {nav.primary.map((item) => (
                <NavLink key={item.href} item={item} role={role} pathname={pathname} />
              ))}
            </ul>
            <div className="mx-2 my-2 border-t border-sidebar-border" />
            <ul className="space-y-px">
              {nav.secondary.map((item) => (
                <NavLink key={item.href} item={item} role={role} pathname={pathname} />
              ))}
            </ul>
          </>
        ) : (
          <ul className="space-y-px">
            <li>
              <Link href="/admin" className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground">
                <Shield className="size-4 text-muted-foreground" strokeWidth={1.75} />
                {t("nav.admin")}
              </Link>
            </li>
          </ul>
        )}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        {plan ? (
          <Link href={plan.href} className="mb-1 block rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-sidebar-accent/60">
            <span className="flex items-center justify-between text-2xs">
              <span className="label-caps">{t("nav.planUsage")}</span>
              <span className="font-medium text-foreground">{plan.name}</span>
            </span>
            {plan.ratio !== null ? (
              <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-sidebar-accent">
                <span className={cn("block h-full rounded-full", plan.ratio >= 0.9 ? "bg-warning" : "bg-brand")} style={{ width: `${Math.round(plan.ratio * 100)}%` }} />
              </span>
            ) : null}
            <span className="mt-0.5 block truncate text-2xs text-muted-foreground">{plan.usedLabel}</span>
          </Link>
        ) : null}
        <div className="flex items-center gap-0.5">
          <AccountMenu user={user} />
          <Notifications notifications={notifications} unread={unread} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onOpenSearch} aria-label={tr("Search")} className="text-muted-foreground hover:text-foreground">
                <Search className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {tr("Search")} <Kbd>⌘K</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
