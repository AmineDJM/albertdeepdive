"use client";

import { useState } from "react";
import { Sidebar, type SidebarEdition, type SidebarNotification, type SidebarPlan, type SidebarUser } from "./sidebar";
import type { WorkspaceOption } from "./workspace-switcher";
import { CommandMenu } from "./command-menu";
import { RowLinkBehaviour } from "./row-link";
import { ViewAsBanner } from "./view-as-banner";
import type { Role } from "@/lib/auth/permissions";

export function NewsroomShell({ user, workspace, workspaces, impersonated, currentEdition, editions, badges, notifications, unread, plan, children }: { user: SidebarUser & { viewingAs?: { role: Role; userName?: string } | null }; workspace: { name: string; role: string } | null; workspaces: WorkspaceOption[]; impersonated: boolean; currentEdition: SidebarEdition | null; editions: SidebarEdition[]; badges: { inbox: number; flags: number }; notifications: SidebarNotification[]; unread: number; plan: SidebarPlan | null; children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {user.viewingAs ? <ViewAsBanner role={user.viewingAs.role} userName={user.viewingAs.userName} /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar user={user} role={user.role} workspace={workspace} workspaces={workspaces} impersonated={impersonated} currentEdition={currentEdition} editions={editions} badges={badges} notifications={notifications} unread={unread} plan={plan} onOpenSearch={() => setSearchOpen(true)} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scrollbar-thin">{children}</main>
        <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} currentEditionId={currentEdition?.id ?? null} role={user.role} />
        <RowLinkBehaviour />
      </div>
    </div>
  );
}
