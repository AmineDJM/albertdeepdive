import { Building2 } from "lucide-react";
import { listCampusesWithStats } from "@/server/contributors/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { AUDIENCE_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { Badge } from "@/components/ui/badge";
import { CampusEditor } from "./campus-editor";

export const dynamic = "force-dynamic";

export default async function CampusesPage() {
  const [user, campuses] = await Promise.all([getCurrentUser(), listCampusesWithStats()]);
  const canManage = hasPermission(user, "campus:manage");
  return (
    <>
      <PageHeader title="Campuses" description="Campuses are configurable. Every submission can target one, several or the whole school." actions={canManage ? <CampusEditor /> : null}
      >
        <HubTabs tabs={AUDIENCE_TABS} />
      </PageHeader>
      <PageBody>
        <DataTable
          rows={campuses}
          rowKey={(c) => c.id}
          empty={{ title: "No campuses", description: "Add the first campus to start tracking coverage.", icon: Building2 }}
          columns={[
            { key: "name", header: "Campus", cell: (c) => (
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: c.colour ?? "#2BAFE0" }} />
                  {c.name}
                  {!c.isActive ? <Badge variant="muted">Inactive</Badge> : null}
                </span>
              ) },
            { key: "city", header: "City", cell: (c) => <span className="text-xs">{[c.city, c.country].filter(Boolean).join(", ") || "—"}</span> },
            { key: "tz", header: "Timezone", cell: (c) => <span className="font-mono text-2xs text-muted-foreground">{c.timezone}</span> },
            { key: "target", header: "Invited / campaign", cell: (c) => <span className="tabular">{c.defaultInviteTarget}</span>, align: "right" },
            { key: "contributors", header: "Active contributors", cell: (c) => <span className="tabular">{c.contributors}</span>, align: "right" },
            { key: "submissions", header: "Submissions (all time)", cell: (c) => <span className="tabular">{c.submissions}</span>, align: "right" },
            { key: "stories", header: "Stories (all time)", cell: (c) => <span className="tabular">{c.stories}</span>, align: "right" },
            ...(canManage ? [{ key: "actions", header: "", cell: (c: (typeof campuses)[number]) => <span data-no-row-link><CampusEditor campus={c} /></span>, align: "right" as const, width: "60px" }] : []),
          ]}
        />
      </PageBody>
    </>
  );
}
