import { Suspense } from "react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { queueStats, jobTypeOptions } from "@/server/automations/read-queue";
import { adminJobs } from "@/server/platform/support";
import { listOrganizations } from "@/server/tenancy/service";
import { env } from "@/server/env";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { QueueControls } from "@/components/newsroom/automations-queue";
import { AdminJobsTable } from "./jobs-table";
import { relativeTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/** Every organisation's async work — renders, sends, narrations, pictures — on one list, with its errors. */
export default async function AdminJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <PageHeader title={tr("Jobs")} />;
  const [stats, rows, types, organizations] = await Promise.all([queueStats(), adminJobs({ status: sp.status, type: sp.type, organizationId: sp.organizationId }), jobTypeOptions(), listOrganizations()]);
  const retryable = rows.filter((row) => row.status === "FAILED" || row.status === "DEAD" || row.status === "CANCELLED").length;
  return (
    <>
      <PageHeader title={tr("Jobs")} description={`${tr("Runner")} “${env.JOBS_RUNNER}” · ${stats.lastFinishedAt ? `${tr("last finished")} ${relativeTime(stats.lastFinishedAt)}` : tr("nothing finished yet")}`} actions={<QueueControls canManage={hasPermission(user, "automation:manage")} retryable={retryable} />} />
      <PageBody className="space-y-4">
        <StatGrid columns={6}>
          <Stat label={tr("Running")} value={stats.running} hue="cobalt" href="/admin/jobs?status=RUNNING" />
          <Stat label={tr("Queued")} value={stats.queued} hint={`${stats.dueNow} ${tr("due now")}`} href="/admin/jobs?status=QUEUED" />
          <Stat label={tr("Failed")} value={stats.failed} tone={stats.failed ? "destructive" : "muted"} href="/admin/jobs?status=FAILED" />
          <Stat label={tr("Dead")} value={stats.dead} tone={stats.dead ? "destructive" : "muted"} href="/admin/jobs?status=DEAD" />
          <Stat label={tr("Cancelled")} value={stats.cancelled} tone="muted" href="/admin/jobs?status=CANCELLED" />
          <Stat label={tr("Succeeded")} value={stats.succeeded} hue="green" href="/admin/jobs?status=SUCCEEDED" />
        </StatGrid>
        <Suspense>
          <FilterBar
            searchKey={null}
            filters={[
              { key: "status", label: tr("Status"), options: [{ value: "active", label: tr("Active") }, { value: "problem", label: tr("Failed or dead") }, { value: "SUCCEEDED", label: tr("Succeeded") }, { value: "CANCELLED", label: tr("Cancelled") }] },
              { key: "type", label: tr("Type"), options: types.map((type) => ({ value: type, label: type })) },
              { key: "organizationId", label: tr("Organization"), options: organizations.map((o) => ({ value: o.id, label: o.name })) },
            ]}
          />
        </Suspense>
        <AdminJobsTable rows={rows} />
      </PageBody>
    </>
  );
}
