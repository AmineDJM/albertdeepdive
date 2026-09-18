import { Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listPlatformUsers } from "@/server/platform/overrides";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { relativeTime } from "@/lib/utils";
import { PersonControls } from "./person-controls";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Everybody with an account on this Briefly.
 *
 * Two different roles live on one row and it matters which is which: the platform role decides
 * whether somebody is Briefly staff, the workspace role decides what they may do inside a particular
 * customer's newsroom. A person can be a VIEWER on the platform and an OWNER of their own workspace,
 * and confusing the two is how you accidentally give a customer the keys to every other customer.
 */
export default async function PlatformPeoplePage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("People")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Managing accounts across every workspace is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const people = await listPlatformUsers();
  const staff = people.filter((person) => person.role === "SUPER_ADMIN");
  const suspended = people.filter((person) => !person.isActive);

  return (
    <>
      <PageHeader title={tr("People")} description={tr("Every account, what it may do, and which workspaces it belongs to.")}>
        <HubTabs tabs={PLATFORM_TABS} />
      </PageHeader>
      <PageBody className="space-y-5">
        <StatGrid columns={3}>
          <Stat label={tr("Accounts")} value={people.length} hint={`${people.filter((p) => p.isActive).length} active`} icon={Users} hue="teal" />
          <Stat label={tr("Platform staff")} value={staff.length} hint={tr("can see every customer")} hue="coral" />
          <Stat label={tr("Suspended")} value={suspended.length} hint={tr("cannot sign in")} hue={suspended.length ? "amber" : "green"} />
        </StatGrid>

        <DataTable
          rows={people}
          rowKey={(person) => person.id}
          empty={{ title: tr("No accounts"), description: tr("Nobody has signed up yet."), icon: Users }}
          columns={[
            {
              key: "person",
              header: tr("Person"),
              cell: (person) => (
                <span className="block min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{person.name}</span>
                    {!person.isActive ? <Badge variant="muted">{tr("suspended")}</Badge> : null}
                  </span>
                  <span className="block truncate text-2xs text-muted-foreground">{person.email}</span>
                </span>
              ),
            },
            {
              key: "platformRole",
              header: tr("Platform role"),
              cell: (person) => (
                <span className="flex items-center gap-1.5">
                  {person.role === "SUPER_ADMIN" ? <Badge>{ROLE_LABELS[person.role]}</Badge> : <span className="text-xs text-muted-foreground">{ROLE_LABELS[person.role]}</span>}
                </span>
              ),
            },
            {
              key: "workspaces",
              header: tr("Workspaces"),
              cell: (person) =>
                person.workspaces.length ? (
                  <span className="flex flex-wrap gap-1">
                    {person.workspaces.slice(0, 3).map((workspace) => (
                      <span key={workspace.organizationId} className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs">
                        {workspace.name} · {workspace.role.toLowerCase()}
                      </span>
                    ))}
                    {person.workspaces.length > 3 ? <span className="text-2xs text-muted-foreground">+{person.workspaces.length - 3}</span> : null}
                  </span>
                ) : (
                  <span className="text-2xs text-muted-foreground">{tr("none")}</span>
                ),
            },
            {
              key: "lastLogin",
              header: tr("Last seen"),
              cell: (person) => <span className="text-2xs text-muted-foreground">{person.lastLoginAt ? relativeTime(person.lastLoginAt) : "never"}</span>,
              align: "right",
            },
            {
              key: "actions",
              header: "",
              cell: (person) => (
                <span data-no-row-link>
                  <PersonControls person={{ id: person.id, name: person.name, role: person.role, isActive: person.isActive, workspaces: person.workspaces }} isSelf={person.id === user?.id} />
                </span>
              ),
              align: "right",
            },
          ]}
        />

        <p className="max-w-prose text-xs leading-5 text-muted-foreground">
          {tr("A platform role of")}{" "}<span className="font-medium text-foreground">{tr("Super admin")}</span> {" "}{tr("means Briefly staff: it can read and change every customer’s data. Everything else is scoped to the workspaces that person belongs to. Suspending an account ends its sessions immediately and leaves everything it wrote in place.")}</p>
      </PageBody>
    </>
  );
}
