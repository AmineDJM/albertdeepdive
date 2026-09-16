import { Suspense } from "react";
import Link from "next/link";
import { ArrowUpRight, Workflow } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { jobTypeOptions, listJobs, queueStats, type JobRow } from "@/server/automations/read-queue";
import { listEditions } from "@/server/editions/service";
import { env } from "@/server/env";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { JobQueueTable, QueueControls, type JobRowView } from "@/components/newsroom/automations-queue";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { enumLabel, formatDateTime, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RUNNER_NOTE: Record<string, string> = {
  inprocess: "Jobs run inside the web server as soon as they are queued.",
  cli: "Jobs are picked up by a separate worker process (pnpm worker).",
  none: "No runner is attached: jobs stay queued until one processes them.",
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "automation:manage")) return <NoAccess title="Background jobs" permission="automation:manage" />;

  const [stats, jobs, types, editions] = await Promise.all([
    queueStats(),
    listJobs({ status: sp.status, type: sp.type, editionId: sp.editionId }),
    jobTypeOptions(),
    listEditions(),
  ]);

  const rows: JobRowView[] = jobs.map((job: JobRow) => ({
    ...job,
    display: {
      runAtAgo: relativeTime(job.runAt),
      runAt: formatDateTime(job.runAt),
      createdAt: formatDateTime(job.createdAt),
      finishedAt: job.finishedAt ? formatDateTime(job.finishedAt) : null,
    },
  }));
  const retryable = jobs.filter((j) => j.status === "FAILED" || j.status === "DEAD" || j.status === "CANCELLED").length;

  return (
    <>
      <PageHeader
        title="Background jobs"
        description={`Runner “${env.JOBS_RUNNER}” — ${RUNNER_NOTE[env.JOBS_RUNNER] ?? "custom runner"}`}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/automations">
              Automations <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <PageBody className="space-y-5">
        <StatGrid columns={5}>
          <Stat label="Running" value={stats.running} tone={stats.running ? "brand" : "muted"} hint="Being processed now" />
          <Stat label="Queued" value={stats.queued} hint={stats.dueNow ? `${stats.dueNow} due now` : "Nothing due"} />
          <Stat label="Succeeded" value={stats.succeeded} tone="success" hint={stats.lastFinishedAt ? `Last ${relativeTime(stats.lastFinishedAt)}` : "None yet"} />
          <Stat label="Failed" value={stats.failed} tone={stats.failed ? "warning" : "muted"} hint="Will be retried" />
          <Stat label="Dead-lettered" value={stats.dead} tone={stats.dead ? "destructive" : "success"} hint={stats.dead ? "Needs a person" : "Nothing to recover"} />
        </StatGrid>

        <Suspense>
          <FilterBar
            filters={[
              { key: "status", label: "Status", options: ["RUNNING", "QUEUED", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"].map((s) => ({ value: s, label: enumLabel(s) })) },
              { key: "type", label: "Type", options: types.map((t) => ({ value: t, label: t })) },
              { key: "editionId", label: "Edition", options: editions.map((e) => ({ value: e.id, label: e.label })) },
            ]}
          />
        </Suspense>

        <section>
          <SectionTitle action={<QueueControls canManage retryable={retryable} />}>
            Queue
            <span className="tabular ml-1.5 font-normal text-muted-foreground">{rows.length} shown</span>
          </SectionTitle>
          {rows.length ? (
            <JobQueueTable rows={rows} canManage />
          ) : (
            <EmptyState icon={Workflow} title="The queue is empty" description="Jobs appear here when a campaign step, an AI run or an export is queued." />
          )}
          <p className="mt-2 text-2xs text-muted-foreground">
            Every job carries an idempotency key, so a step that has already succeeded is skipped rather than run twice. Failures are retried with a growing delay and dead-lettered when they run out of attempts.
          </p>
        </section>
      </PageBody>
    </>
  );
}
