"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus, ShieldAlert } from "lucide-react";
import { BrieflyMark } from "@/components/brand/briefly-mark";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { switchWorkspaceAction } from "@/app/(newsroom)/workspace-actions";
import { cn } from "@/lib/utils";

export type WorkspaceOption = { organizationId: string; name: string; slug: string; role: string };

/**
 * The workspace a person is working in, and the way out of it.
 *
 * The name shown here is the customer's, not Briefly's: someone opening the app should see their
 * own organisation first. The switcher only appears when there is somewhere to switch to, so the
 * single-workspace case — which is almost everyone — stays a plain, quiet header.
 */
export function WorkspaceSwitcher({ current, options, impersonated }: { current: { name: string; role: string } | null; options: WorkspaceOption[]; impersonated: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const canSwitch = options.length > 1;

  const header = (
    <span className="flex min-w-0 items-center gap-2">
      <BrieflyMark className="size-5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">{current?.name ?? "Briefly"}</span>
        {impersonated ? (
          <span className="flex items-center gap-1 text-2xs text-amber-600 dark:text-amber-500">
            <ShieldAlert className="size-3" /> Platform access
          </span>
        ) : null}
      </span>
    </span>
  );

  if (!canSwitch) return <div className="flex h-12 items-center px-4">{header}</div>;

  return (
    <div className="px-3 pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        >
          {header}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[216px]">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuItem
              key={o.organizationId}
              onSelect={() =>
                startTransition(async () => {
                  await switchWorkspaceAction(o.organizationId);
                  router.refresh();
                })
              }
              className="flex items-center justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px]">{o.name}</span>
                <span className="block text-2xs text-muted-foreground capitalize">{o.role.toLowerCase()}</span>
              </span>
              <Check className={cn("size-3.5 shrink-0", o.name === current?.name ? "opacity-100" : "opacity-0")} />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/onboarding" className="flex items-center gap-2">
              <Plus className="size-3.5" /> New workspace
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
