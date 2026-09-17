"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, MoreHorizontal, Shield, UserMinus, UserPlus } from "lucide-react";
import { enterWorkspaceAction, setPlatformRoleAction, setUserActiveAction } from "../actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/permissions";

/**
 * What a platform admin can do to one account.
 *
 * "See what they see" is the one worth having: it opens their workspace with their role, so a
 * question about a screen is answered by looking at it rather than by reasoning about a permissions
 * table. It only ever narrows — a super admin already holds everything — and the audit entry keeps
 * the real name on it.
 *
 * Suspension is not deletion. It ends sessions and blocks sign-in; everything the person wrote stays
 * exactly where it is, with their byline on it.
 */
export function PersonControls({
  person,
  isSelf,
}: {
  person: { id: string; name: string; role: Role; isActive: boolean; workspaces: { organizationId: string; name: string; role: string }[] };
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "That did not work");
        return;
      }
      if (result.message) toast.success(result.message);
      router.refresh();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Manage ${person.name}`} disabled={pending}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {person.workspaces.length ? (
          <>
            <DropdownMenuLabel>See what they see</DropdownMenuLabel>
            {person.workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.organizationId}
                onSelect={() =>
                  startTransition(async () => {
                    await enterWorkspaceAction(workspace.organizationId, { role: person.role, userId: person.id, userName: person.name });
                  })
                }
              >
                <Eye /> {workspace.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Shield /> Platform role
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {ROLES.map((role) => (
              <DropdownMenuItem key={role} disabled={role === person.role} onSelect={() => run(() => setPlatformRoleAction(person.id, role))}>
                {ROLE_LABELS[role]}
                {role === person.role ? " ·" : ""}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        {person.isActive ? (
          <DropdownMenuItem variant="destructive" disabled={isSelf} onSelect={() => run(() => setUserActiveAction(person.id, false))}>
            <UserMinus /> Suspend account
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => run(() => setUserActiveAction(person.id, true))}>
            <UserPlus /> Restore account
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
