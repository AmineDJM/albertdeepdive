import Link from "next/link";
import { Suspense } from "react";
import { Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { contributorStats, listContributors, listGroups, listPrograms } from "@/server/contributors/service";
import { listCampusesWithStats } from "@/server/contributors/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { AUDIENCE_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { Badge } from "@/components/ui/badge";
import { ContributorEditor } from "./contributor-editor";
import { CONTRIBUTOR_TYPES } from "@/lib/constants";
import { GroupsPanel } from "./groups-panel";
import { enumLabel, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContributorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const canManage = hasPermission(user, "contributor:manage");
  const [rows, groups, campuses, programs, stats] = await Promise.all([listContributors({ q: sp.q, campusId: sp.campusId, type: sp.type, groupId: sp.groupId, active: sp.active as "true" | "false" | undefined }), listGroups(), listCampusesWithStats(), listPrograms(), contributorStats()]);
  return (
    <>
      <PageHeader title="Contributors" description="Who gets asked each month, and how they respond." actions={canManage ? <div className="flex items-center gap-2"><Button asChild variant="outline" size="sm"><Link href="/contributors/import"><Upload /> Import from a file</Link></Button><Suspense><ContributorEditor campuses={campuses} programs={programs} groups={groups} openOnParam /></Suspense></div> : null}
      >
        <HubTabs tabs={AUDIENCE_TABS} />
      </PageHeader>
      <PageBody className="space-y-4">
        <StatGrid columns={4}>
          <Stat label="Contributors" value={stats.total} hint={`${stats.active} active`} />
          <Stat label="Have contributed" value={stats.responders} hint="at least one submission" />
          <Stat label="Average response rate" value={`${Math.round(stats.avgResponse * 100)}%`} hint="across all campaigns" />
          <Stat label="Pools" value={groups.length} hint="contributor groups" />
        </StatGrid>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <Suspense>
              <FilterBar
                searchPlaceholder="Search name, email, organisation…"
                filters={[
                  { key: "campusId", label: "Campus", options: [...campuses.map((c) => ({ value: c.id, label: c.name })), { value: "school", label: "School-wide" }] },
                  { key: "type", label: "Type", options: CONTRIBUTOR_TYPES.map((t) => ({ value: t, label: enumLabel(t) })) },
                  { key: "active", label: "Status", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }], allLabel: "Active & inactive" },
                ]}
              />
            </Suspense>
            <DataTable
              rows={rows}
              rowKey={(c) => c.id}
              onRowHref={(c) => `/contributors/${c.id}`}
              dense
              empty={{ title: "No contributors match", description: "Adjust the filters or add a contributor.", icon: Users }}
              columns={[
                { key: "name", header: "Contributor", cell: (c) => (
                    <div className="min-w-0">
                      <Link href={`/contributors/${c.id}`} className="font-medium hover:underline">{c.firstName} {c.lastName}</Link>
                      <div className="truncate text-2xs text-muted-foreground">{c.email}</div>
                    </div>
                  ) },
                { key: "campus", header: "Campus", cell: (c) => (c.campus ? <CampusChip name={c.campus.name} colour={c.campus.colour} /> : <span className="text-2xs text-muted-foreground">School-wide</span>) },
                { key: "program", header: "Programme", cell: (c) => <span className="text-xs">{c.program?.code ?? "—"}</span> },
                { key: "type", header: "Type", cell: (c) => <Badge variant="outline">{enumLabel(c.type)}</Badge> },
                { key: "groups", header: "Pools", cell: (c) => <span className="line-clamp-1 text-2xs text-muted-foreground">{c.groupMemberships.map((m) => m.group.name).join(", ") || "—"}</span> },
                { key: "response", header: "Response", cell: (c) => <span className="tabular text-xs">{c.responseRate === null ? "—" : `${Math.round((c.responseRate ?? 0) * 100)}%`}</span>, align: "right" },
                { key: "subs", header: "Submissions", cell: (c) => <span className="tabular text-xs">{c.submissionsCount}</span>, align: "right" },
                { key: "last", header: "Last contribution", cell: (c) => <span className="text-xs text-muted-foreground">{formatDate(c.lastContributionAt)}</span> },
                { key: "status", header: "", cell: (c) => (c.isActive ? null : <Badge variant="muted">Inactive</Badge>) },
              ]}
            />
          </div>
          <GroupsPanel groups={groups} canManage={canManage} activeGroupId={sp.groupId} />
        </div>
      </PageBody>
    </>
  );
}
