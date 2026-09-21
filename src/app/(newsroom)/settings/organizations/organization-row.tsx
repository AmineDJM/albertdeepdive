"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, User } from "lucide-react";
import { switchWorkspaceAction } from "@/app/(newsroom)/workspace-actions";
import type { MyOrganization } from "@/server/tenancy/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/i18n/provider";

/** One workspace in the list, and the one control it needs: go there. */
export function OrganizationRow({ organization, current }: { organization: MyOrganization; current: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();

  const open = () =>
    start(async () => {
      const result = await switchWorkspaceAction(organization.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push("/overview");
      router.refresh();
    });

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-foreground text-[12px] font-semibold text-background">
        {organization.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={organization.logoUrl} alt="" className="size-full object-contain" />
        ) : (
          organization.name.trim().charAt(0).toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{organization.name}</span>
          {organization.isPersonal ? (
            <Badge variant="muted" className="gap-1">
              <User className="size-2.5" /> {tr("Just you")}
            </Badge>
          ) : null}
          {current ? (
            <Badge variant="outline" className="gap-1">
              <Check className="size-2.5" /> {tr("You are here")}
            </Badge>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {tr("Your role: {role}", { role: organization.role.toLowerCase() })} ·{" "}
          {organization.members === 1 ? tr("1 member") : tr("{count} members", { count: organization.members })} ·{" "}
          {organization.publications === 1 ? tr("1 newsletter") : tr("{count} newsletters", { count: organization.publications })}
        </span>
      </span>
      {current ? null : (
        <Button size="sm" variant="ghost" loading={pending} onClick={open} data-testid={`open-workspace-${organization.slug}`}>
          {tr("Open")} <ArrowRight className="size-3.5" />
        </Button>
      )}
    </li>
  );
}
