import { Suspense } from "react";
import Link from "next/link";
import { Bot, Settings2, Workflow } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { automationOverview, automationRunsTable, runFilterOptions, STEP_LABELS } from "@/server/automations/read";
import { aiJobLog, jobTypeOptions, listJobs, queueStats } from "@/server/automations/read-queue";
import { describeEnvironment } from "@/server/settings/environment";
import { centsToEur } from "@/server/analytics/compute";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { GenericStatusBadge } from "@/components/newsroom/status-badge";
import { AutomationGrid, RunSchedulerButton, type AutomationTileView } from "@/components/newsroom/automations-cards";
import { JobQueueTable, QueueControls, type JobRowView } from "@/components/newsroom/automations-queue";
import { NoAccess } from "@/components/settings/no-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { enumLabel, formatCurrency, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const latency = (value: number | null) => (value === null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `summary` jsonb of a run as one readable line: identifiers and float noise are no help here. */
function summaryLine(summary: Record<string, unknown>, max = 4) {
  return (
    Object.entries(summary)
      .filter(([k, v]) => {
        if (/id$|ids$/i.test(k)) return false;
        if (typeof v === "string") return !UUID.test(v);
        return typeof v === "number" || typeof v === "boolean";
      })
      .slice(0, max)
      .map(([k, v]) => {
        const value = typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v);
        return `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${value}`;
      })
      .join(" · ") || null
  );
}

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "edition:view")) return <NoAccess title="Automations" permission="edition:view" />;
  const canManage = hasPermission(user, "automation:manage");
  const environment = describeEnvironment();

  const [overview, stats, jobs, types, ai, runs, options] = await Promise.all([
    automationOverview(),
    queueStats(),
    listJobs({ status: sp.jobStatus, type: sp.jobType, editionId: sp.jobEdition }),
    jobTypeOptions(),
    aiJobLog({ service: sp.aiService, model: sp.aiModel, status: sp.aiStatus, editionId: sp.aiEdition }, 25),
    automationRunsTable({}, 30),
    runFilterOptions(),
  ]);

  // Formatting happens here, on the server: the client tiles and the queue table only render strings.
  const tiles: AutomationTileView[] = overview.cards.map((card) => ({
    key: card.key,
    label: card.label,
    description: card.description,
    enabled: card.enabled,
    when: card.when,
    nextLabel: card.nextLabel,
    nextExact: card.nextAt ? formatDateTime(card.nextAt) : null,
    editionId: card.editionId,
    editionLabel: card.editionLabel,
    lastRun: card.lastRun
      ? {
          status: card.lastRun.status,
          ago: relativeTime(card.lastRun.finishedAt ?? card.lastRun.startedAt),
          exact: formatDateTime(card.lastRun.finishedAt ?? card.lastRun.startedAt),
          // `error` doubles as the reason a run was released or skipped; only a FAILED run is an error.
          error: card.lastRun.status === "FAILED" ? card.lastRun.error : null,
          summary: card.lastRun.status === "FAILED" ? null : (summaryLine(card.lastRun.summary) ?? (card.lastRun.error ? enumLabel(card.lastRun.error) : null)),
          editionId: card.lastRun.editionId,
          editionLabel: card.lastRun.editionLabel,
        }
      : null,
  }));
  const jobRows: JobRowView[] = jobs.map((job) => ({
    ...job,
    display: { runAtAgo: relativeTime(job.runAt), runAt: formatDateTime(job.runAt), createdAt: formatDateTime(job.createdAt), finishedAt: job.finishedAt ? formatDateTime(job.finishedAt) : null },
  }));

  const enabled = overview.cards.filter((c) => c.enabled).length;
  const next = overview.cards.filter((c) => c.nextAt).sort((a, b) => (a.nextAt?.getTime() ?? 0) - (b.nextAt?.getTime() ?? 0))[0] ?? null;
  const retryable = stats.failed + stats.dead;

  return (
    <>
      <PageHeader
        title="Automations"
        description={`${enabled} of ${overview.cards.length} automations active · ${environment.jobs.runner === "inprocess" ? "in-process worker" : environment.jobs.runner === "cli" ? "dedicated worker process" : "no worker running"} · ${stats.total} jobs recorded`}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link href="/settings/system">
                <Settings2 /> Toggles &amp; schedule
              </Link>
            </Button>
            {canManage ? <RunSchedulerButton /> : null}
          </>
        }
      />
      <PageBody className="space-y-6">
        <StatGrid columns={5}>
          <Stat label="Active automations" value={`${enabled}/${overview.cards.length}`} hint={overview.cards.length - enabled ? `${overview.cards.length - enabled} paused in settings` : "all switched on"} tone={enabled === overview.cards.length ? "success" : "warning"} />
          <Stat label="Next run" value={next?.nextLabel ?? "—"} hint={next ? `${next.label}${next.editionLabel ? ` · ${next.editionLabel}` : ""}` : "Nothing scheduled"} />
          <Stat label="Queue" value={stats.running + stats.queued} hint={`${stats.running} running · ${stats.queued} queued · ${stats.dueNow} due now`} tone={stats.running ? "brand" : "default"} />
          <Stat label="Failed & dead-lettered" value={retryable} hint={retryable ? "retry them from the queue below" : "nothing to recover"} tone={retryable ? "destructive" : "success"} />
          <Stat label="AI calls" value={ai.totals.calls} hint={`${formatCurrency(centsToEur(ai.totals.costCents))} · ${formatNumber(ai.totals.tokens)} tokens`} icon={Bot} href="/analytics" />
        </StatGrid>

        <section>
          <SectionTitle action={<span className="text-2xs text-muted-foreground">Switches and the monthly rhythm live in <Link href="/settings/system" className="text-brand hover:underline">Settings → System</Link></span>}>Scheduled automations</SectionTitle>
          <AutomationGrid items={tiles} canManage={canManage} />
        </section>

        <section>
          <SectionTitle action={<QueueControls canManage={canManage} retryable={retryable} />}>Job queue</SectionTitle>
          <div className="space-y-3">
            <Suspense>
              <FilterBar
                searchKey={null}
                filters={[
                  { key: "jobStatus", label: "Status", options: [
                      { value: "active", label: `Running & queued (${stats.running + stats.queued})` },
                      { value: "problem", label: `Failed & dead (${retryable})` },
                      { value: "SUCCEEDED", label: `Succeeded (${stats.succeeded})` },
                      { value: "CANCELLED", label: `Cancelled (${stats.cancelled})` },
                    ], allLabel: `All statuses (${stats.total})` },
                  { key: "jobType", label: "Type", options: types.map((t) => ({ value: t, label: t })), allLabel: "All job types" },
                  { key: "jobEdition", label: "Edition", options: options.editions.map((e) => ({ value: e.id, label: e.label })), allLabel: "All editions" },
                ]}
              />
            </Suspense>
            <JobQueueTable rows={jobRows} canManage={canManage} />
            <p className="text-2xs text-muted-foreground">
              {stats.nextRunAt ? `Next queued job runs ${relativeTime(stats.nextRunAt)}. ` : ""}
              {stats.lastFinishedAt ? `Last job finished ${relativeTime(stats.lastFinishedAt)}. ` : ""}
              The table is server-rendered — use Refresh for the current state.
            </p>
          </div>
        </section>

        <section>
          <SectionTitle>AI job log</SectionTitle>
          <div className="space-y-3">
            <Suspense>
              <FilterBar
                searchKey={null}
                filters={[
                  { key: "aiService", label: "Service", options: ai.services.map((s) => ({ value: s, label: enumLabel(s) })), allLabel: "All services" },
                  { key: "aiModel", label: "Model", options: ai.models.map((m) => ({ value: m, label: m })), allLabel: "All models" },
                  { key: "aiStatus", label: "Status", options: [
                      { value: "SUCCEEDED", label: "Succeeded" },
                      { value: "FAILED", label: "Failed" },
                      { value: "SKIPPED", label: "Skipped" },
                      { value: "RUNNING", label: "Running" },
                      { value: "QUEUED", label: "Queued" },
                    ] },
                  { key: "aiEdition", label: "Edition", options: options.editions.map((e) => ({ value: e.id, label: e.label })), allLabel: "All editions" },
                ]}
              />
            </Suspense>
            <DataTable
              rows={ai.rows}
              rowKey={(r) => r.id}
              dense
              empty={{ title: "No AI call recorded", description: "Every call the pipeline makes is logged here with its model, tokens, cost and latency.", icon: Bot }}
              columns={[
                { key: "service", header: "Service", cell: (r) => (
                    <div className="min-w-0">
                      <span className="text-xs font-medium">{enumLabel(r.service)}</span>
                      <div className="truncate text-2xs text-muted-foreground">
                        {r.promptKey ? `${r.promptKey} v${r.promptVersion ?? 1}` : "no prompt template"}
                        {r.entityType ? ` · ${enumLabel(r.entityType)}` : ""}
                      </div>
                    </div>
                  ) },
                { key: "model", header: "Model", cell: (r) => (
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">{r.model}</span>
                      <Badge variant="outline">{r.provider}</Badge>
                      {r.cached ? <Badge variant="muted">cached</Badge> : null}
                    </span>
                  ) },
                { key: "status", header: "Status", cell: (r) => <GenericStatusBadge status={r.status} /> },
                { key: "tokens", header: "Tokens", cell: (r) => (
                    <span className="tabular text-xs">
                      {formatNumber((r.inputTokens ?? 0) + (r.outputTokens ?? 0))}
                      <span className="ml-1 text-2xs text-muted-foreground">{r.inputTokens ?? 0}↑ {r.outputTokens ?? 0}↓</span>
                    </span>
                  ), align: "right" },
                { key: "cost", header: "Cost", cell: (r) => <span className="tabular text-xs">{formatCurrency(centsToEur(r.costCents))}</span>, align: "right" },
                { key: "latency", header: "Latency", cell: (r) => <span className="tabular text-xs text-muted-foreground">{latency(r.latencyMs)}</span>, align: "right" },
                { key: "edition", header: "Edition", cell: (r) => (r.editionId ? <Link href={`/editions/${r.editionId}`} className="text-xs hover:underline">{r.editionLabel}</Link> : <span className="text-2xs text-muted-foreground">—</span>) },
                { key: "when", header: "When", cell: (r) => <span className="text-xs text-muted-foreground" title={formatDateTime(r.createdAt)}>{relativeTime(r.createdAt)}</span> },
                { key: "error", header: "Error", cell: (r) => (r.error ? <span className="line-clamp-1 max-w-[16rem] text-2xs text-destructive" title={r.error}>{r.error}</span> : <span className="text-2xs text-muted-foreground">—</span>) },
              ]}
            />
            <p className="text-2xs text-muted-foreground">
              Showing the {ai.rows.length} most recent calls of {ai.totals.calls} in scope · {ai.totals.cached} served from cache · {ai.totals.failed} failed · average latency {latency(ai.totals.avgLatencyMs)}.
            </p>
          </div>
        </section>

        <section>
          <SectionTitle>Automation run history</SectionTitle>
          {runs.length ? (
            <DataTable
              rows={runs}
              rowKey={(r) => r.id}
              dense
              columns={[
                { key: "step", header: "Step", cell: (r) => <span className="text-xs font-medium">{STEP_LABELS[r.step] ?? enumLabel(r.step)}</span> },
                { key: "status", header: "Status", cell: (r) => <GenericStatusBadge status={r.status} /> },
                { key: "edition", header: "Edition", cell: (r) => (r.editionId ? <Link href={`/editions/${r.editionId}`} className="text-xs hover:underline">{r.editionLabel}</Link> : <span className="text-2xs text-muted-foreground">—</span>) },
                { key: "trigger", header: "Triggered by", cell: (r) => <Badge variant={r.triggeredBy === "MANUAL" ? "brand" : "muted"}>{enumLabel(r.triggeredBy)}</Badge> },
                { key: "scheduled", header: "Scheduled for", cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.scheduledFor)}</span> },
                { key: "finished", header: "Finished", cell: (r) => <span className="text-xs text-muted-foreground" title={r.finishedAt ? formatDateTime(r.finishedAt) : undefined}>{r.finishedAt ? relativeTime(r.finishedAt) : "—"}</span> },
                { key: "outcome", header: "Outcome", cell: (r) =>
                    r.status === "FAILED" && r.error ? (
                      <span className="line-clamp-1 max-w-[20rem] text-2xs text-destructive" title={r.error}>{r.error}</span>
                    ) : (
                      <span className="line-clamp-1 max-w-[20rem] text-2xs text-muted-foreground">{summaryLine(r.summary) ?? (r.error ? enumLabel(r.error) : "—")}</span>
                    ) },
              ]}
            />
          ) : (
            <EmptyState icon={Workflow} title="No automation has run yet" description="Each scheduler step records an idempotent run here, so it is never executed twice for the same edition." compact />
          )}
        </section>
      </PageBody>
    </>
  );
}
