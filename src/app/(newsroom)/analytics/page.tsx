import { Suspense } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { editionAnalytics, editionComparison, listEditionOptions } from "@/server/analytics/service";
import { formatHours, percentLabel } from "@/server/analytics/compute";
import {
  readerDelivery,
  readerDeliveryByEdition,
  approvalLatency,
  contributionsByCampus,
  conversionFunnel,
  pipelineFunnel,
  mostActiveContributors,
  resolveWindow,
  responseRateByPool,
  rightsByEdition,
  sectionCoverage,
  submissionTrend,
} from "@/server/analytics/read-insights";
import { tenantScope } from "@/server/analytics/scope";
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
import { ChartTheme } from "@/components/analytics/chart-theme";
import { AreaChartCard, BarChartCard, GroupedBarCard } from "@/components/analytics/charts";
import { FormattedBarCard } from "@/components/charts/formatted-bar-card";
import { FunnelCard } from "@/components/charts/funnel-card";
import { HeatmapCard } from "@/components/charts/heatmap-card";
import { StatusStackCard } from "@/components/charts/status-stack-card";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { formatDate, formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";


export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "analytics:view")) return <NoAccess title={tr("Analytics")} permission="analytics:view" />;

  const activity = resolveWindow(sp);
  /*
   * The workspace comes from the session, the edition from the URL — and the edition is checked
   * against the workspace before it reaches a query, so a link carrying somebody else's edition id
   * is a 404 rather than a page of their figures. The list below is filtered the same way, which
   * is why it is read *after* the scope rather than used to validate it.
   */
  const scope = await tenantScope(activity, sp.editionId);
  const editions = await listEditionOptions(scope);
  const editionId = scope.editionId;

  const [analytics, comparison, trend, pools, funnel, pipeline, coverage, latency, delivery, deliveryByEdition, rights, campuses, top] = await Promise.all([
    editionAnalytics(scope),
    editionComparison(scope),
    submissionTrend(scope),
    responseRateByPool(scope),
    conversionFunnel(scope),
    pipelineFunnel(scope),
    sectionCoverage(scope),
    approvalLatency(scope),
    readerDelivery(scope),
    readerDeliveryByEdition(scope),
    rightsByEdition(scope),
    contributionsByCampus(scope),
    mostActiveContributors(scope),
  ]);

  const windowLabel = activity.from || activity.to ? `${activity.from ? formatDate(activity.from) : "the beginning"} → ${activity.to ? formatDate(activity.to) : "today"}` : "all time";
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

        {/*
          * The pipeline, from the invitation rather than from the send.
          *
          * The row below measures the newsroom's editing; this measures the whole thing, which is
          * where the decisions an editor can change actually live. If thirteen of eighteen people
          * answered, the question is what to do about the five — and no amount of open-rate tells
          * you that.
          */}
        <section className="rounded-lg border border-border bg-card px-4 py-3">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[13px]">
            {[
              { label: tr("invited"), value: pipeline.invited },
              { label: tr("answered"), value: pipeline.answered, hint: pipeline.invited ? percentLabel(pipeline.responseRate) : null },
              { label: tr("contributions"), value: pipeline.contributions },
              { label: tr("topics"), value: pipeline.topics },
              { label: tr("kept"), value: pipeline.kept, hint: pipeline.topics ? percentLabel(pipeline.keepRate) : null },
              { label: tr("written"), value: pipeline.written },
              { label: tr("published"), value: pipeline.published },
            ].map((step, index, all) => (
              <li key={step.label} className="flex items-center gap-1.5">
                <span className="tabular font-semibold">{formatNumber(step.value)}</span>
                <span className="text-muted-foreground">{step.label}</span>
                {step.hint ? <span className="tabular text-2xs text-muted-foreground">({step.hint})</span> : null}
                {index < all.length - 1 ? <span aria-hidden className="px-1 text-muted-foreground">→</span> : null}
              </li>
            ))}
          </ol>
        </section>

        <StatGrid columns={6}>
          <Stat label={tr("Submissions")} value={submissions} hint={`${funnel.steps[1]?.value ?? 0} accepted · ${percentLabel(funnel.acceptedRate)} of the intake`} />
          <Stat label={tr("Response rate")} value={percentLabel(analytics.contributors.responseRate)} hint={`${analytics.contributors.responded} of ${analytics.contributors.invited} invited${editionId ? "" : " (all editions)"}`} tone={analytics.contributors.responseRate >= 0.5 ? "success" : "warning"} />
          <Stat label={tr("Stories selected")} value={storiesSelected} hint={`${percentLabel(funnel.storyRate)} of accepted submissions`} />
          <Stat label={tr("Articles approved")} value={articlesApproved} hint={`${percentLabel(funnel.approvalRate)} of the articles written`} />
          <Stat label={tr("Opened")} value={percentLabel(delivery.openRate)} hint={delivery.delivered ? `${formatNumber(delivery.opened)} of ${formatNumber(delivery.delivered)} delivered` : tr("nothing sent in this window")} tone={delivery.openRate >= 0.3 ? "success" : delivery.delivered ? "default" : "muted"} />
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

        {/*
          * What happened to the issues that went out.
          *
          * This section used to be the AI bill — cost per service, tokens per model, cost per
          * edition. Those are the operator's numbers: a newsroom cannot act on them, they are not
          * theirs to act on, and showing somebody the cost of running their own subscription is a
          * strange thing to do. They live in the Platform console now. What a newsroom came here
          * for is whether anybody read the thing.
          *
          * Rates are against what was delivered rather than what was sent, because an address that
          * bounced never had the chance to open it.
          */}
        <section>
          <SectionTitle>{tr("Readers —")}{" "}{windowLabel}</SectionTitle>
          <StatGrid columns={4} className="mb-4">
            <Stat label={tr("Delivered")} value={formatNumber(delivery.delivered)} hint={delivery.sent ? `${percentLabel(delivery.deliveryRate)} of ${formatNumber(delivery.sent)} sent · ${formatNumber(delivery.bounced)} bounced` : tr("nothing sent in this window")} tone={delivery.bounced ? "warning" : "default"} />
            <Stat label={tr("Opened")} value={percentLabel(delivery.openRate)} hint={`${formatNumber(delivery.opened)} reader(s) · ${formatNumber(delivery.opens)} opens in total`} tone={delivery.openRate >= 0.3 ? "success" : "default"} />
            <Stat label={tr("Clicked")} value={percentLabel(delivery.clickRate)} hint={`${formatNumber(delivery.clicked)} reader(s) · ${formatNumber(delivery.clicks)} clicks in total`} tone={delivery.clickRate >= 0.05 ? "success" : "default"} />
            <Stat label={tr("Opened, then clicked")} value={percentLabel(delivery.clickThroughRate)} hint={tr("of the people who opened it")} />
          </StatGrid>
          <div className="grid gap-4 xl:grid-cols-2">
            <BarChartCard
              title={tr("Open rate per issue")}
              description={tr("Share of the readers it reached who opened it.")}
              data={[...deliveryByEdition].reverse().map((r) => ({ label: r.label, value: Math.round(r.openRate * 1000) / 10 }))}
              valueLabel="Open rate"
              emptyText="No issue has been emailed in this window."
            />
            <BarChartCard
              title={tr("Click rate per issue")}
              description={tr("Share of the readers it reached who followed a link.")}
              data={[...deliveryByEdition].reverse().map((r) => ({ label: r.label, value: Math.round(r.clickRate * 1000) / 10 }))}
              valueLabel="Click rate"
              emptyText="No issue has been emailed in this window."
            />
          </div>
          <div className="mt-4">
            <DataTable
              rows={deliveryByEdition}
              rowKey={(r) => r.editionId}
              dense
              empty={{ title: tr("Nothing has been emailed yet"), description: tr("Once an issue goes out, who received it, opened it and clicked is counted here.") }}
              columns={[
                { key: "edition", header: tr("Edition"), cell: (r) => <Link href={`/analytics?editionId=${r.editionId}`} className="font-medium hover:underline">{r.label}</Link> },
                { key: "sent", header: tr("Sent"), cell: (r) => <span className="tabular text-xs">{formatNumber(r.sent)}</span>, align: "right" },
                { key: "delivered", header: tr("Delivered"), cell: (r) => <span className="tabular text-xs">{formatNumber(r.delivered)}</span>, align: "right" },
                { key: "bounced", header: tr("Bounced"), cell: (r) => <span className={`tabular text-xs ${r.bounced ? "text-warning" : "text-muted-foreground"}`}>{formatNumber(r.bounced)}</span>, align: "right" },
                { key: "opened", header: tr("Opened"), cell: (r) => <span className="tabular text-xs">{percentLabel(r.openRate)}</span>, align: "right" },
                { key: "clicked", header: tr("Clicked"), cell: (r) => <span className="tabular text-xs">{percentLabel(r.clickRate)}</span>, align: "right" },
              ]}
            />
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
            <BarChartCard
              title={tr("Stories per edition")}
              description={tr("Chosen from what arrived, issue by issue.")}
              data={[...comparison].reverse().map((e) => ({ label: e.label, value: e.stories }))}
              valueLabel="Stories"
              emptyText="No edition has selected a story yet."
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
              ]}
            />
          </div>
        </section>
      </PageBody>
    </>
  );
}
