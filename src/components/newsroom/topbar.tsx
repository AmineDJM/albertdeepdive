"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Bell, HelpCircle, LogOut, Moon, Search, Sun, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initials, relativeTime, cn } from "@/lib/utils";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { markAllNotificationsReadAction, markNotificationReadAction, signOutAction } from "@/app/(newsroom)/actions";

export type TopbarNotification = { id: string; title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date; type: string };

export function Topbar({ user, notifications, unread, onOpenSearch }: { user: { name: string; email: string; role: Role }; notifications: TopbarNotification[]; unread: number; onOpenSearch: () => void }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [pending, startTransition] = useTransition();
  return (
    <header className="flex h-12 shrink-0 items-center justify-end gap-1 border-b border-border bg-background px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={onOpenSearch} aria-label="Search">
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Search (⌘K)</TooltipContent>
      </Tooltip>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="relative">
            <Bell />
            {unread ? <span className="absolute top-1.5 right-1.5 flex size-3.5 items-center justify-center rounded-full bg-brand text-[9px] font-semibold text-brand-foreground">{unread > 9 ? "9+" : unread}</span> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] p-0">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-[13px] font-semibold">Notifications</span>
            {unread ? (
              <Button variant="ghost" size="xs" disabled={pending} onClick={() => startTransition(async () => { await markAllNotificationsReadAction(); router.refresh(); })}>
                Mark all read
              </Button>
            ) : null}
          </div>
          <ul className="max-h-[380px] overflow-y-auto scrollbar-thin">
            {notifications.length === 0 ? <li className="px-3 py-8 text-center text-xs text-muted-foreground">You're all caught up.</li> : null}
            {notifications.map((n) => (
              <li key={n.id} className={cn("border-b last:border-0", !n.readAt && "bg-brand-soft/30")}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/60"
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <Sun className="dark:hidden" />
            <Moon className="hidden dark:block" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle theme</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" asChild aria-label="Help">
            <Link href="/settings/help">
              <HelpCircle />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>How the newsroom works</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger className="ml-1 flex items-center gap-2 rounded-md py-1 pr-1 pl-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          <Avatar>
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="normal-case tracking-normal">
            <div className="text-[13px] font-medium text-foreground">{user.name}</div>
            <div className="text-2xs text-muted-foreground">{user.email}</div>
            <div className="mt-1 text-2xs text-brand">{ROLE_LABELS[user.role]}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/profile">
              <UserRound /> Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => startTransition(async () => { await signOutAction(); })}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
