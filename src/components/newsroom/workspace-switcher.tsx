"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Check, ChevronsUpDown, LogOut, Plus, ShieldAlert, UserRound } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { leaveWorkspaceAction, switchWorkspaceAction } from "@/app/(newsroom)/workspace-actions";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type WorkspaceOption = { organizationId: string; name: string; slug: string; role: string };

/**
 * The organisation a person is working in, as the card at the top of the sidebar.
 *
 * It used to show the edition in hand, which is a question the newsletters answer better, while
 * switching organisation was a quiet line that only became a menu with two or more. It is always a
 * menu now, because it holds more than the switch: the person's own account, the list of their
 * organisations, and the way to start another — which goes straight to the page that creates it.
 *
 * Platform staff inside a customer's workspace see that they are, and the way back out.
 */
export function WorkspaceSwitcher({ current, options, impersonated }: { current: { name: string; role: string } | null; options: WorkspaceOption[]; impersonated: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const name = current?.name ?? "Briefly";
  const roleWord = (role: string) => ({ OWNER: tr("Owner"), ADMIN: tr("Admin"), EDITOR: tr("Editor"), CONTRIBUTOR: tr("Contributor"), VIEWER: tr("Viewer") })[role] ?? tr("Member");
  const leave = () =>
    startTransition(async () => {
      await leaveWorkspaceAction();
    });

  return (
    <div className="flex items-center gap-1 px-3 pb-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          data-testid="organization-switcher"
          className="group flex w-full items-center gap-2.5 min-w-0 flex-1 rounded-xl border border-sidebar-border bg-card px-2.5 py-2 text-left shadow-xs transition-all duration-200 hover:border-foreground/15 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        >
          <span aria-hidden className="org-mark flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white">
            {name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">{name}</span>
            {impersonated ? (
              <span className="flex items-center gap-1 text-2xs text-amber-600 dark:text-amber-500">
                <ShieldAlert className="size-3" />{" "}{tr("Platform access")}</span>
            ) : (
              <span className="block truncate text-2xs text-muted-foreground">{current ? roleWord(current.role) : tr("Organisation")}</span>
            )}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[232px]">
          <DropdownMenuLabel>{tr("Your organisations")}</DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuItem
              key={o.organizationId}
              onSelect={() =>
                startTransition(async () => {
                  await switchWorkspaceAction(o.organizationId);
                  router.push("/overview");
                  router.refresh();
                })
              }
              className="flex items-center justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px]">{o.name}</span>
                <span className="block text-2xs text-muted-foreground">{roleWord(o.role)}</span>
              </span>
              <Check className={cn("size-3.5 shrink-0", o.name === current?.name ? "opacity-100" : "opacity-0")} />
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem asChild>
            <Link href="/onboarding" className="flex items-center gap-2">
              <Plus className="size-3.5" />{" "}{tr("Create an organisation")}</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/profile" className="flex items-center gap-2">
              <UserRound className="size-3.5" />{" "}{tr("My account")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/organizations" className="flex items-center gap-2">
              <Building2 className="size-3.5" />{" "}{tr("Manage my organisations")}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {impersonated ? (
        <button type="button" onClick={leave} disabled={pending} aria-label={tr("Leave workspace")} title={tr("Leave workspace")} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-60">
          <LogOut className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
