"use client";

import { useState } from "react";
import { Sidebar, type SidebarNewsletter, type SidebarNotification, type SidebarPlan, type SidebarUser } from "./sidebar";
import type { WorkspaceOption } from "./workspace-switcher";
import { CommandMenu } from "./command-menu";
import { RowLinkBehaviour } from "./row-link";
import { ViewAsBanner } from "./view-as-banner";
import type { Role } from "@/lib/auth/permissions";
import type { ExperienceMode } from "@/lib/experience";
import { ExperienceProvider } from "@/components/experience/provider";

export function NewsroomShell({ user, workspace, workspaces, impersonated, currentEditionId, newsletters, notifications, unread, plan, experience, children }: { user: SidebarUser & { viewingAs?: { role: Role; userName?: string } | null }; workspace: { name: string; role: string } | null; workspaces: WorkspaceOption[]; impersonated: boolean; currentEditionId: string | null; newsletters: SidebarNewsletter[]; notifications: SidebarNotification[]; unread: number; plan: SidebarPlan | null; experience: ExperienceMode; children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <ExperienceProvider mode={experience}>
    <div className="flex h-screen flex-col overflow-hidden">
      {user.viewingAs ? <ViewAsBanner role={user.viewingAs.role} userName={user.viewingAs.userName} /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar user={user} role={user.role} workspace={workspace} workspaces={workspaces} impersonated={impersonated} newsletters={newsletters} notifications={notifications} unread={unread} plan={plan} onOpenSearch={() => setSearchOpen(true)} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scrollbar-thin">{children}</main>
        <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} currentEditionId={currentEditionId} role={user.role} />
        <RowLinkBehaviour />
      </div>
    </div>
    </ExperienceProvider>
  );
}
