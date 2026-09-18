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
import { DataTable, type Column } from "@/components/newsroom/data-table";
import { SelectAll, SelectRow, SelectionProvider } from "@/components/newsroom/selection";
import { ContributorsBulkBar } from "./contributors-bulk-bar";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { Badge } from "@/components/ui/badge";
import { ContributorEditor } from "./contributor-editor";
import { CONTRIBUTOR_TYPES } from "@/lib/constants";
import { GroupsPanel } from "./groups-panel";
import { enumLabel, formatDate } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function ContributorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const user = await getCurrentUser();
  const canManage = hasPermission(user, "contributor:manage");
  // Hidden (inactive) contributors stay out of the list until asked for.
  const active = sp.active === "any" ? undefined : sp.active === "false" ? ("false" as const) : ("true" as const);
  const [rows, groups, campuses, programs, stats] = await Promise.all([listContributors({ q: sp.q, campusId: sp.campusId, type: sp.type, groupId: sp.groupId, active }), listGroups(), listCampusesWithStats(), listPrograms(), contributorStats()]);
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    ...(canManage ? [{ key: "select", header: <SelectAll ids={rows.map((c) => c.id)} />, cell: (c: Row) => <SelectRow id={c.id} label={`${c.firstName} ${c.lastName}`} />, width: "36px" }] : []),
    { key: "name", header: tr("Contributor"), cell: (c) => (
        <div className="min-w-0">
          <Link href={`/contributors/${c.id}`} className="font-medium hover:underline">{c.firstName} {c.lastName}</Link>
          <div className="truncate text-2xs text-muted-foreground">{c.email}</div>
        </div>
      ) },
    { key: "campus", header: tr("Campus"), cell: (c) => (c.campus ? <CampusChip name={c.campus.name} colour={c.campus.colour} /> : <span className="text-2xs text-muted-foreground">{tr("School-wide")}</span>) },
    { key: "program", header: tr("Programme"), cell: (c) => <span className="text-xs">{c.program?.code ?? "—"}</span> },
    { key: "type", header: tr("Type"), cell: (c) => <Badge variant="outline">{tr(enumLabel(c.type))}</Badge> },
    { key: "groups", header: tr("Pools"), cell: (c) => <span className="line-clamp-1 text-2xs text-muted-foreground">{c.groupMemberships.map((m) => m.group.name).join(", ") || "—"}</span> },
    { key: "response", header: tr("Response"), cell: (c) => <span className="tabular text-xs">{c.responseRate === null ? "—" : `${Math.round((c.responseRate ?? 0) * 100)}%`}</span>, align: "right" },
    { key: "subs", header: tr("Submissions"), cell: (c) => <span className="tabular text-xs">{c.submissionsCount}</span>, align: "right" },
    { key: "last", header: tr("Last contribution"), cell: (c) => <span className="text-xs text-muted-foreground">{formatDate(c.lastContributionAt)}</span> },
    { key: "status", header: "", cell: (c) => (c.isActive ? null : <Badge variant="muted">{tr("Hidden")}</Badge>) },
  ];
  return (
    <>
      <PageHeader title={tr("Contributors")} description={tr("Who gets asked each month, and how they respond.")} actions={canManage ? <div className="flex items-center gap-2"><Button asChild variant="outline" size="sm"><Link href="/contributors/import"><Upload />{" "}{tr("Import from a file")}</Link></Button><Suspense><ContributorEditor campuses={campuses} programs={programs} groups={groups} openOnParam /></Suspense></div> : null}
      >
        <HubTabs tabs={AUDIENCE_TABS} />
      </PageHeader>
      <PageBody className="space-y-4">
        <StatGrid columns={4}>
          <Stat label={tr("Contributors")} value={stats.total} hint={`${stats.active} active`} />
          <Stat label={tr("Have contributed")} value={stats.responders} hint={tr("at least one submission")} />
          <Stat label={tr("Average response rate")} value={`${Math.round(stats.avgResponse * 100)}%`} hint={tr("across all campaigns")} />
          <Stat label={tr("Pools")} value={groups.length} hint={tr("contributor groups")} />
        </StatGrid>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <Suspense>
              <FilterBar
                searchPlaceholder={tr("Search name, email, organisation…")}
                filters={[
                  { key: "campusId", label: tr("Campus"), options: [...campuses.map((c) => ({ value: c.id, label: c.name })), { value: "school", label: tr("School-wide") }] },
                  { key: "type", label: tr("Type"), options: CONTRIBUTOR_TYPES.map((t) => ({ value: t, label: enumLabel(t) })) },
                  { key: "active", label: tr("Shown"), options: [{ value: "false", label: tr("Hidden only") }, { value: "any", label: tr("Shown & hidden") }], allLabel: tr("Shown") },
                ]}
              />
            </Suspense>
            <SelectionProvider>
              {canManage ? <ContributorsBulkBar /> : null}
              <DataTable
                rows={rows}
                rowKey={(c) => c.id}
                onRowHref={(c) => `/contributors/${c.id}`}
                dense
                empty={{ title: tr("No contributors match"), description: tr("Adjust the filters or add a contributor."), icon: Users }}
                columns={columns}
              />
            </SelectionProvider>
          </div>
          <GroupsPanel groups={groups} canManage={canManage} activeGroupId={sp.groupId} />
        </div>
      </PageBody>
    </>
  );
}
