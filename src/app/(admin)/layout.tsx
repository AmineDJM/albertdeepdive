import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { listMyOrganizations } from "@/server/tenancy/context";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTheme } from "@/components/admin/admin-theme";
import { RowLinkBehaviour } from "@/components/newsroom/row-link";

/**
 * The Super Admin console: a separate product surface for running Briefly.
 *
 * Only a platform super admin reaches it, and the check is the person's real role — a super admin
 * looking at a customer's workspace through another role is still staff, and a customer's owner,
 * however senior in their own workspace, is not. Anyone else is told nothing exists here.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fadmin");
  if ((user.viewingAs?.realRole ?? user.role) !== "SUPER_ADMIN") notFound();
  const memberships = await listMyOrganizations();
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground" data-surface="admin">
      <AdminTheme />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AdminSidebar user={{ name: user.name, email: user.email }} workspaceHref={memberships.length ? "/overview" : null} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scrollbar-thin">{children}</main>
        <RowLinkBehaviour />
      </div>
    </div>
  );
}
