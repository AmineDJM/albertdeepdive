"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, MoreHorizontal, Shield, UserMinus } from "lucide-react";
import { enterWorkspaceAction, removeMemberAction, setMemberRoleAction } from "../../actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Role } from "@/lib/auth/permissions";
import type { OrganizationRole } from "@/server/tenancy/context";
import { useUi } from "@/components/i18n/provider";

const WORKSPACE_ROLES: OrganizationRole[] = ["OWNER", "ADMIN", "EDITOR", "CONTRIBUTOR", "VIEWER"];

/**
 * One member of one customer, from the console: their role in that workspace, the door to see
 * what they see, and the way out. The last owner cannot be demoted or removed; the service says so.
 */
export function MemberControls({ organizationId, member, isSelf }: { organizationId: string; member: { userId: string; name: string; role: OrganizationRole; platformRole: Role }; isSelf: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? tr("That did not work"));
        return;
      }
      if (result.message) toast.success(result.message);
      router.refresh();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${tr("Manage")} ${member.name}`} disabled={pending}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => startTransition(async () => void (await enterWorkspaceAction(organizationId, { role: member.platformRole, userId: member.userId, userName: member.name })))}>
          <Eye />{" "}{tr("See what they see")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Shield />{" "}{tr("Workspace role")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuLabel>{tr("In this workspace")}</DropdownMenuLabel>
            {WORKSPACE_ROLES.map((role) => (
              <DropdownMenuItem key={role} disabled={role === member.role} onSelect={() => run(() => setMemberRoleAction(organizationId, member.userId, role))}>
                <span className="capitalize">{role.toLowerCase()}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={isSelf} onSelect={() => run(() => removeMemberAction(organizationId, member.userId))}>
          <UserMinus />{" "}{tr("Remove from workspace")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
