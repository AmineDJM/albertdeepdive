import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listUsers } from "@/server/settings/users";
import { listCampusesWithStats } from "@/server/contributors/service";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { PermissionsMatrix } from "@/components/settings/permissions-matrix";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/auth/permissions";
import { UsersTable } from "./users-table";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "user:manage")) return <NoAccess title="Users & roles" permission="user:manage" />;
  const [users, campuses] = await Promise.all([listUsers(), listCampusesWithStats()]);
  return (
    <>
      <PageHeader title="Users & roles" description="Newsroom accounts. Contributors never need an account — they get personal links." />
      <PageBody className="space-y-6">
        <section className="space-y-3">
          <UsersTable users={users} campuses={campuses.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))} currentUserId={user!.id} />
        </section>
        <section>
          <SectionTitle>Roles</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ROLES.map((r) => (
              <div key={r} className="rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">{ROLE_LABELS[r]}</span>
                  <span className="tabular text-2xs text-muted-foreground">{users.filter((u) => u.role === r && u.isActive).length} active</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle>Permissions matrix</SectionTitle>
          <PermissionsMatrix />
          <p className="mt-2 text-2xs text-muted-foreground">Permissions are defined in code (src/lib/auth/permissions.ts) and enforced server-side on every action.</p>
        </section>
      </PageBody>
    </>
  );
}
