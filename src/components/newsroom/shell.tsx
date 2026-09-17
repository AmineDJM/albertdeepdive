"use client";

import { useState } from "react";
import { Sidebar, type SidebarEdition } from "./sidebar";
import type { WorkspaceOption } from "./workspace-switcher";
import { Topbar, type TopbarNotification } from "./topbar";
import { CommandMenu } from "./command-menu";
import { RowLinkBehaviour } from "./row-link";
import type { Role } from "@/lib/auth/permissions";

export function NewsroomShell({ user, workspace, workspaces, impersonated, currentEdition, editions, badges, notifications, unread, children }: { user: { name: string; email: string; role: Role }; workspace: { name: string; role: string } | null; workspaces: WorkspaceOption[]; impersonated: boolean; currentEdition: SidebarEdition | null; editions: SidebarEdition[]; badges: { inbox: number; flags: number }; notifications: TopbarNotification[]; unread: number; children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={user.role} workspace={workspace} workspaces={workspaces} impersonated={impersonated} currentEdition={currentEdition} editions={editions} badges={badges} onOpenSearch={() => setSearchOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} notifications={notifications} unread={unread} onOpenSearch={() => setSearchOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">{children}</main>
      </div>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} currentEditionId={currentEdition?.id ?? null} />
      <RowLinkBehaviour />
    </div>
  );
}
