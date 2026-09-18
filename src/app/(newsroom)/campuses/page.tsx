import { Building2 } from "lucide-react";
import { listCampusesWithStats } from "@/server/contributors/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { AUDIENCE_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { Badge } from "@/components/ui/badge";
import { CampusEditor } from "./campus-editor";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function CampusesPage() {
  const tr = await getUi();
  const [user, campuses] = await Promise.all([getCurrentUser(), listCampusesWithStats()]);
  const canManage = hasPermission(user, "campus:manage");
  return (
    <>
      <PageHeader title={tr("Campuses")} description={tr("Campuses are configurable. Every submission can target one, several or the whole school.")} actions={canManage ? <CampusEditor /> : null}
      >
        <HubTabs tabs={AUDIENCE_TABS} />
      </PageHeader>
      <PageBody>
        <DataTable
          rows={campuses}
          rowKey={(c) => c.id}
          empty={{ title: tr("No campuses"), description: tr("Add the first campus to start tracking coverage."), icon: Building2 }}
          columns={[
            { key: "name", header: tr("Campus"), cell: (c) => (
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: c.colour ?? "#2BAFE0" }} />
                  {c.name}
                  {!c.isActive ? <Badge variant="muted">{tr("Inactive")}</Badge> : null}
                </span>
              ) },
            { key: "city", header: tr("City"), cell: (c) => <span className="text-xs">{[c.city, c.country].filter(Boolean).join(", ") || "—"}</span> },
            { key: "tz", header: tr("Timezone"), cell: (c) => <span className="font-mono text-2xs text-muted-foreground">{c.timezone}</span> },
            { key: "target", header: tr("Invited / campaign"), cell: (c) => <span className="tabular">{c.defaultInviteTarget}</span>, align: "right" },
            { key: "contributors", header: tr("Active contributors"), cell: (c) => <span className="tabular">{c.contributors}</span>, align: "right" },
            { key: "submissions", header: tr("Submissions (all time)"), cell: (c) => <span className="tabular">{c.submissions}</span>, align: "right" },
            { key: "stories", header: tr("Stories (all time)"), cell: (c) => <span className="tabular">{c.stories}</span>, align: "right" },
            ...(canManage ? [{ key: "actions", header: "", cell: (c: (typeof campuses)[number]) => <span data-no-row-link><CampusEditor campus={c} /></span>, align: "right" as const, width: "60px" }] : []),
          ]}
        />
      </PageBody>
    </>
  );
}
