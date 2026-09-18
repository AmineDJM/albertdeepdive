import { Suspense } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { editionAnalytics, editionComparison, listEditionOptions } from "@/server/analytics/service";
import { centsToEur, formatHours, percentLabel } from "@/server/analytics/compute";
import {
  aiSpendByEdition,
  aiSpendByModel,
  aiSpendByService,
  approvalLatency,
  contributionsByCampus,
  conversionFunnel,
  mostActiveContributors,
  resolveWindow,
  responseRateByPool,
  rightsByEdition,
  sectionCoverage,
  submissionTrend,
  type AnalyticsScope,
} from "@/server/analytics/read-insights";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { INSIGHTS_TABS } from "@/components/newsroom/nav";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { DateRangeFilter } from "@/components/newsroom/analytics-date-range";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { NoAccess } from "@/components/settings/no-access";
import { Badge } from "@/components/ui/badge";
import { ChartTheme } from "@/components/analytics/chart-theme";
import { AreaChartCard, BarChartCard, GroupedBarCard } from "@/components/analytics/charts";
import { FormattedBarCard } from "@/components/charts/formatted-bar-card";
import { FunnelCard } from "@/components/charts/funnel-card";
import { HeatmapCard } from "@/components/charts/heatmap-card";
import { StatusStackCard } from "@/components/charts/status-stack-card";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { enumLabel, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const euros = (cents: number) => formatCurrency(centsToEur(cents));
const ms = (value: number | null) => (value === null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "analytics:view")) return <NoAccess title={tr("Analytics")} permission="analytics:view" />;

  const editions = await listEditionOptions();
  const editionId = sp.editionId && editions.some((e) => e.id === sp.editionId) ? sp.editionId : null;
  const activity = resolveWindow(sp);
  const scope: AnalyticsScope = { editionId, from: activity.from, to: activity.to };

  const [analytics, comparison, trend, pools, funnel, coverage, latency, aiEditions, aiServices, aiModels, rights, campuses, top] = await Promise.all([
    editionAnalytics(editionId),
    editionComparison(),
    submissionTrend(scope),
    responseRateByPool(scope),
    conversionFunnel(scope),
    sectionCoverage(scope),
    approvalLatency(scope),
    aiSpendByEdition(scope),
    aiSpendByService(scope),
    aiSpendByModel(scope),
    rightsByEdition(scope),
    contributionsByCampus(scope),
    mostActiveContributors(scope),
  ]);

  const windowLabel = activity.from || activity.to ? `${activity.from ? formatDate(activity.from) : "the beginning"} → ${activity.to ? formatDate(activity.to) : "today"}` : "all time";
  const aiTotals = aiEditions.reduce((acc, r) => ({ calls: acc.calls + r.calls, tokens: acc.tokens + r.tokens, costCents: acc.costCents + r.costCents, cached: acc.cached + r.cached, failed: acc.failed + r.failed }), { calls: 0, tokens: 0, costCents: 0, cached: 0, failed: 0 });
  const avgAiLatency = aiEditions.length ? Math.round(aiEditions.reduce((a, r) => a + (r.avgLatencyMs ?? 0) * r.calls, 0) / Math.max(1, aiEditions.reduce((a, r) => a + (r.avgLatencyMs === null ? 0 : r.calls), 0))) : null;
  const submissions = funnel.steps[0]?.value ?? 0;
  const storiesSelected = funnel.steps[3]?.value ?? 0;
  const articlesApproved = funnel.steps[5]?.value ?? 0;

  return (
    <>
      <ChartTheme />
      <PageHeader title={tr("Analytics")} description={`${analytics.scope.label} · activity window: ${windowLabel} · every figure is read straight from the database`}
      >
        <HubTabs tabs={INSIGHTS_TABS} />
      </PageHeader>
      <PageBody className="space-y-6">
        <Suspense>
          <FilterBar
            searchKey={null}
            filters={[{ key: "editionId", label: tr("Edition"), options: editions.map((e) => ({ value: e.id, label: `${e.label} — ${e.isSpecialIssue ? "special" : "issue"} N°${e.issueNumber}` })), allLabel: tr("All editions") }]}
          >
            <DateRangeFilter preset={activity.preset} />
          </FilterBar>
        </Suspense>

        <StatGrid columns={6}>
          <Stat label={tr("Submissions")} value={submissions} hint={`${funnel.steps[1]?.value ?? 0} accepted · ${percentLabel(funnel.acceptedRate)} of the intake`} />
          <Stat label={tr("Response rate")} value={percentLabel(analytics.contributors.responseRate)} hint={`${analytics.contributors.responded} of ${analytics.contributors.invited} invited${editionId ? "" : " (all editions)"}`} tone={analytics.contributors.responseRate >= 0.5 ? "success" : "warning"} />
          <Stat label={tr("Stories selected")} value={storiesSelected} hint={`${percentLabel(funnel.storyRate)} of accepted submissions`} />
          <Stat label={tr("Articles approved")} value={articlesApproved} hint={`${percentLabel(funnel.approvalRate)} of the articles written`} />
          <Stat label={tr("AI cost")} value={euros(aiTotals.costCents)} hint={`${formatNumber(aiTotals.tokens)} tokens · ${aiTotals.calls} calls`} />
          <Stat label={tr("Submission → decision")} value={formatHours(latency.avgSubmissionToDecisionHours)} hint={latency.reviewed ? `median ${formatHours(latency.medianSubmissionToDecisionHours)} over ${latency.reviewed} decisions` : "no decision recorded yet"} tone={latency.avgSubmissionToDecisionHours !== null && latency.avgSubmissionToDecisionHours > 168 ? "warning" : "default"} />
        </StatGrid>

        <section>
          <SectionTitle>{tr("Newsroom activity —")}{" "}{windowLabel}</SectionTitle>
          <div className="grid gap-4 xl:grid-cols-2">
            <GroupedBarCard
              title={tr("Contributions per campus")}
              description={tr("Submissions mentioning each campus, and the stories that made the plan.")}
              data={campuses.map((c) => ({ label: c.name, value: c.submissions, submissions: c.submissions, stories: c.stories }))}
              series={[{ key: "submissions", label: tr("Submissions"), role: 1 }, { key: "stories", label: tr("Stories"), role: 2 }]}
              emptyText="No campus received a contribution in this window."
            />
            <FormattedBarCard
              title={tr("Response rate by contributor pool")}
              description={tr("Share of the invitations sent to each pool that came back as a submission.")}
              data={pools.map((p) => ({ label: p.campusName ? `${p.name}` : p.name, value: Math.round(p.responseRate * 100), invited: p.invited, responded: p.responded }))}
              valueLabel="Response rate"
              horizontal
              height={Math.max(180, 34 * pools.length + 46)}
              format="percent"
              emptyText="No invitation was sent in this window."
            />
            {trend.points.length >= 2 ? (
              <AreaChartCard
                title={`Contributions per ${trend.granularity}`}
                description={tr("When contributions actually arrive, and the running total.")}
                data={trend.points.map((p) => ({ label: p.label, value: p.value, cumulative: p.cumulative }))}
                valueLabel="Submissions"
              />
            ) : null}
            <FunnelCard
              title={tr("Submission → article conversion")}
              description={tr("What happens to raw contributions on the way to a printed page.")}
              rows={funnel.steps.map((s) => ({ key: s.key, label: s.label, value: s.value, hint: s.hint }))}
            />
            <BarChartCard
              title={tr("Time from submission to editorial decision")}
              description={latency.reviewed ? `${latency.reviewed} decisions · fastest ${formatHours(latency.fastestHours)}, slowest ${formatHours(latency.slowestHours)}` : "Measured from the moment a contributor sends to the moment an editor decides."}
              data={latency.buckets.map((b) => ({ label: b.label, value: b.value }))}
              valueLabel="Submissions"
              emptyText="No submission has been reviewed in this window."
            />
            <StatusStackCard
              className={trend.points.length >= 2 ? undefined : "xl:col-span-2"}
              title={tr("Media rights")}
              description={tr("What can go to print, what still needs clearing, what is blocked.")}
              rows={rights.map((r) => ({ key: r.editionId ?? "none", label: r.label, values: { green: r.green, yellow: r.yellow, red: r.red }, total: r.total }))}
              series={[
                { key: "green", label: tr("Cleared"), tone: "success" },
                { key: "yellow", label: tr("Unclear"), tone: "warning" },
                { key: "red", label: tr("Blocked"), tone: "destructive" },
              ]}
              emptyText="No media uploaded in this window."
            />
          </div>
          <div className="mt-4">
            <HeatmapCard
              title={tr("Section coverage over time")}
              description={tr("Selected stories per section and per edition — the sections that keep coming up short are the ones to commission for.")}
              columns={coverage.editions.map((e) => ({ key: e.id, label: e.label }))}
              rows={coverage.sections.map((s) => ({ key: s.slug, label: s.name, values: s.counts, total: s.total }))}
              max={coverage.max}
              emptyText="No story has been assigned to a section yet."
            />
          </div>
        </section>

        <section>
          <SectionTitle>{tr("AI usage —")}{" "}{windowLabel}</SectionTitle>
          <StatGrid columns={4} className="mb-4">
            <Stat label={tr("Estimated cost")} value={euros(aiTotals.costCents)} hint={`${aiEditions.length} edition${aiEditions.length === 1 ? "" : "s"} with AI activity`} />
            <Stat label={tr("Tokens")} value={formatNumber(aiTotals.tokens)} hint={tr("input + output")} />
            <Stat label={tr("Calls")} value={aiTotals.calls} hint={`${aiTotals.cached} served from cache · ${aiTotals.failed} failed`} tone={aiTotals.failed ? "warning" : "default"} />
            <Stat label={tr("Average latency")} value={ms(avgAiLatency)} hint={tr("uncached calls only")} />
          </StatGrid>
          <div className="grid gap-4 xl:grid-cols-2">
            <FormattedBarCard
              title={tr("Cost per pipeline service")}
              description={tr("Which step of the pipeline spends the budget.")}
              data={aiServices.map((r) => ({ label: enumLabel(r.service), value: Math.round(r.costCents * 100) / 100, calls: r.calls }))}
              valueLabel="Cost"
              horizontal
              format="currencyFromCents"
              emptyText="No AI call in this window."
            />
            <BarChartCard
              title={tr("Tokens per pipeline service")}
              description={tr("Input and output tokens combined.")}
              data={aiServices.map((r) => ({ label: enumLabel(r.service), value: r.tokens }))}
              valueLabel="Tokens"
              horizontal
              emptyText="No AI call in this window."
            />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <SectionTitle>{tr("Per edition")}</SectionTitle>
              <DataTable
                rows={aiEditions}
                rowKey={(r) => r.editionId ?? "unassigned"}
                dense
                empty={{ title: tr("No AI activity"), description: tr("No AI call was recorded in this window.") }}
                columns={[
                  { key: "edition", header: tr("Edition"), cell: (r) => (r.editionId ? <Link href={`/analytics?editionId=${r.editionId}`} className="font-medium hover:underline">{r.label}</Link> : <span className="text-muted-foreground">{r.label}</span>) },
                  { key: "calls", header: tr("Calls"), cell: (r) => <span className="tabular text-xs">{r.calls}</span>, align: "right" },
                  { key: "tokens", header: tr("Tokens"), cell: (r) => <span className="tabular text-xs">{formatNumber(r.tokens)}</span>, align: "right" },
                  { key: "cost", header: tr("Cost"), cell: (r) => <span className="tabular text-xs">{euros(r.costCents)}</span>, align: "right" },
                  { key: "cached", header: tr("Cached"), cell: (r) => <span className="tabular text-xs text-muted-foreground">{r.cached}</span>, align: "right" },
                  { key: "latency", header: tr("Latency"), cell: (r) => <span className="tabular text-xs text-muted-foreground">{ms(r.avgLatencyMs)}</span>, align: "right" },
                ]}
              />
            </div>
            <div>
              <SectionTitle>{tr("Per model")}</SectionTitle>
              <DataTable
                rows={aiModels}
                rowKey={(r) => `${r.provider}:${r.model}`}
                dense
                empty={{ title: tr("No model used"), description: tr("No AI call was recorded in this window.") }}
                columns={[
                  { key: "model", header: tr("Model"), cell: (r) => <span className="font-mono text-xs">{r.model}</span> },
                  { key: "provider", header: tr("Provider"), cell: (r) => <Badge variant="outline">{r.provider}</Badge> },
                  { key: "calls", header: tr("Calls"), cell: (r) => <span className="tabular text-xs">{r.calls}</span>, align: "right" },
                  { key: "tokens", header: tr("Tokens"), cell: (r) => <span className="tabular text-xs">{formatNumber(r.tokens)}</span>, align: "right" },
                  { key: "cost", header: tr("Cost"), cell: (r) => <span className="tabular text-xs">{euros(r.costCents)}</span>, align: "right" },
                  { key: "latency", header: tr("Latency"), cell: (r) => <span className="tabular text-xs text-muted-foreground">{ms(r.avgLatencyMs)}</span>, align: "right" },
                ]}
              />
            </div>
          </div>
        </section>

        <section>
          <SectionTitle>{tr("Most active contributors —")}{" "}{windowLabel}</SectionTitle>
          <DataTable
            rows={top}
            rowKey={(r) => r.contributorId}
            onRowHref={(r) => `/contributors/${r.contributorId}`}
            dense
            empty={{ title: tr("Nobody contributed in this window"), description: tr("Widen the activity window or pick another edition."), icon: Users }}
            columns={[
              { key: "name", header: tr("Contributor"), cell: (r) => (
                  <div className="min-w-0">
                    <Link href={`/contributors/${r.contributorId}`} className="font-medium hover:underline">{r.name}</Link>
                    <div className="truncate text-2xs text-muted-foreground">{r.email}</div>
                  </div>
                ) },
              { key: "campus", header: tr("Campus"), cell: (r) => (r.campusName ? <CampusChip name={r.campusName} colour={r.campusColour} /> : <span className="text-2xs text-muted-foreground">{tr("School-wide")}</span>) },
              { key: "subs", header: tr("Submissions"), cell: (r) => <span className="tabular text-xs">{r.submissions}</span>, align: "right" },
              { key: "accepted", header: tr("Accepted"), cell: (r) => <span className="tabular text-xs">{r.accepted}</span>, align: "right" },
              { key: "clusters", header: tr("In clusters"), cell: (r) => <span className="tabular text-xs text-muted-foreground">{r.stories}</span>, align: "right" },
              { key: "last", header: tr("Last contribution"), cell: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.lastAt)}</span> },
            ]}
          />
        </section>

        <section>
          <SectionTitle>{tr("Editions side by side — all time")}</SectionTitle>
          <div className="grid gap-4 xl:grid-cols-2">
            <BarChartCard
              title={tr("Contributions per edition")}
              description={tr("Submissions received, drafts excluded.")}
              data={[...comparison].reverse().map((e) => ({ label: e.label, value: e.submissions }))}
              valueLabel="Submissions"
              emptyText="No edition has received a contribution yet."
            />
            <FormattedBarCard
              title={tr("AI cost per edition")}
              description={tr("Estimated from the tokens each call actually used.")}
              data={[...comparison].reverse().map((e) => ({ label: e.label, value: Math.round(e.aiCostCents * 100) / 100 }))}
              valueLabel="Cost"
              format="currencyFromCents"
              emptyText="No AI call has been recorded yet."
            />
          </div>
          <div className="mt-4">
            <DataTable
              rows={comparison}
              rowKey={(r) => r.id}
              onRowHref={(r) => `/editions/${r.id}`}
              dense
              empty={{ title: tr("No edition yet"), description: tr("Editions appear here as soon as the automation creates them.") }}
              columns={[
                { key: "edition", header: tr("Edition"), cell: (r) => (
                    <div className="min-w-0">
                      <Link href={`/editions/${r.id}`} className="font-medium hover:underline">{r.label}</Link>
                      <div className="text-2xs text-muted-foreground">{tr("Issue N°")}{r.issueNumber}</div>
                    </div>
                  ) },
                { key: "status", header: tr("Status"), cell: (r) => <EditionStatusBadge status={r.status as EditionStatus} /> },
                { key: "subs", header: tr("Submissions"), cell: (r) => <span className="tabular text-xs">{r.submissions}</span>, align: "right" },
                { key: "response", header: tr("Response"), cell: (r) => <span className="tabular text-xs">{r.invited ? `${percentLabel(r.responseRate)} (${r.responded}/${r.invited})` : "—"}</span>, align: "right" },
                { key: "stories", header: tr("Stories"), cell: (r) => <span className="tabular text-xs">{r.stories}</span>, align: "right" },
                { key: "articles", header: tr("Approved"), cell: (r) => <span className="tabular text-xs">{r.articlesApproved}</span>, align: "right" },
                { key: "pages", header: tr("Pages"), cell: (r) => <span className="tabular text-xs text-muted-foreground">{r.pages ?? "—"} / {r.targetPageCount}</span>, align: "right" },
                { key: "ai", header: tr("AI cost"), cell: (r) => <span className="tabular text-xs">{euros(r.aiCostCents)}</span>, align: "right" },
              ]}
            />
          </div>
        </section>
      </PageBody>
    </>
  );
}
