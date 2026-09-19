import Link from "next/link";
import { AlertTriangle, Gauge, Ruler, ShieldCheck, Wrench } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { qualityByMetric, qualityByProfile, qualityByRelease, qualityByWorkspace, qualityTotals, recentQualityRuns, type MetricRow, type ProfileQualityRow, type RecentRun, type WorkspaceQualityRow } from "@/server/platform/quality";
import { QC_SPEC_VERSION } from "@/server/qc/spec";
import { percentLabel } from "@/server/analytics/compute";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90] as const;
const windowOf = (raw: string | string[] | undefined): number => {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (WINDOWS as readonly number[]).includes(value) ? value : 30;
};

const SEVERITY_TONE: Record<string, "success" | "warning" | "destructive" | "muted" | "info"> = {
  INFO: "muted",
  WARNING: "warning",
  FAIL: "destructive",
  HARD_FAIL: "destructive",
  CRITICAL_FAIL: "destructive",
};

const STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "muted" | "info"> = {
  PASSED: "success",
  REPAIRED: "info",
  FAILED: "destructive",
  ERRORED: "warning",
};

/** Written out rather than looked up in a map, so the French dictionary's scanner can see all three. */
const originLabel = (origin: string, tr: (text: string) => string) =>
  origin === "INDUSTRY_STANDARD" ? tr("Industry standard") : origin === "OUTPUT_PROVIDER_REQUIREMENT" ? tr("Provider requirement") : tr("Briefly house standard");

/**
 * What Briefly's output quality actually looks like, in measurements.
 *
 * There is no score on this page, and that is the point. A single number between nought and a
 * hundred cannot be acted on, cannot be argued with, and hides the one broken page behind the
 * ninety-nine good ones. So every figure here is a count of things that were measured against a
 * stated threshold — and every rule in the catalogue is listed whether or not it has ever fired,
 * because a check that found nothing and a check that never ran look identical on a page that only
 * shows failures.
 */
export default async function PlatformQualityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Quality")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Reading every customer's preflight is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const days = windowOf((await searchParams).days);
  const [totals, metrics, workspaces, profiles, releases, runs] = await Promise.all([
    qualityTotals(days),
    qualityByMetric(days),
    qualityByWorkspace(days),
    qualityByProfile(days),
    qualityByRelease(Math.max(days, 90)),
    recentQualityRuns(25),
  ]);
  const fired = metrics.filter((metric) => metric.findings > 0);
  const quiet = metrics.length - fired.length;

  return (
    <>
      <PageHeader
        title={tr("Quality")}
        description={tr("Every measurement Briefly took of its own output: what was checked, what failed its threshold, what was repaired, and what stopped an issue from going out.")}
      />
      <PageBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1" role="group" aria-label={tr("Window")}>
            {WINDOWS.map((window) => (
              <Link
                key={window}
                href={`/admin/quality?days=${window}`}
                className={cn("rounded-md px-2.5 py-1 text-xs transition-colors", window === days ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {window} {tr("days")}
              </Link>
            ))}
          </div>
          <span className="text-2xs text-muted-foreground">
            {tr("Rule catalogue")} <span className="tabular">{QC_SPEC_VERSION}</span>
            {totals.specVersions.length > 1 ? ` · ${tr("runs in this window used")} ${totals.specVersions.join(", ")}` : ""}
          </span>
        </div>

        {releases.regressions.length > 0 && (
          <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-destructive">
              <AlertTriangle className="size-4" /> {tr("These rules fail more often since the last release")}
            </h2>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {releases.regressions.slice(0, 6).map((regression) => (
                <li key={regression.metricId}>
                  <span className="font-medium text-foreground">{regression.title}</span> —{" "}
                  <span className="tabular">
                    {regression.before.toFixed(2)} → {regression.after.toFixed(2)}
                  </span>{" "}
                  {tr("findings per run")}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionTitle>{tr("The window")}</SectionTitle>
          <StatGrid columns={4}>
            <Stat label={tr("Preflight runs")} value={formatNumber(totals.runs)} hint={`${formatNumber(totals.failed)} ${tr("blocked")} · ${formatNumber(totals.errored)} ${tr("could not run")}`} tone={totals.failed ? "warning" : "default"} />
            <Stat label={tr("Reached a clean verdict")} value={totals.runs ? percentLabel(totals.cleanRate) : "—"} hint={`${formatNumber(totals.passed)} ${tr("passed outright")} · ${formatNumber(totals.repaired)} ${tr("after repair")}`} />
            <Stat label={tr("Findings")} value={formatNumber(totals.findings)} hint={`${formatNumber(totals.findingsRepaired)} ${tr("repaired automatically")} (${totals.findings ? percentLabel(totals.repairRate) : "—"})`} />
            <Stat label={tr("Median run")} value={`${(totals.medianDurationMs / 1000).toFixed(1)} s`} hint={`${formatNumber(fired.length)} ${tr("of")} ${formatNumber(metrics.length)} ${tr("rules fired")}`} />
          </StatGrid>
        </section>

        <section>
          <SectionTitle>{tr("Every rule, and what it caught")}</SectionTitle>
          <DataTable
            rows={metrics}
            rowKey={(row: MetricRow) => row.metricId}
            dense
            empty={{ title: tr("Nothing measured yet"), description: tr("Preflight runs when an export is rendered and when an issue is published.") }}
            columns={[
              {
                key: "metric",
                header: tr("Rule"),
                cell: (row) => (
                  <span className="block">
                    <span className="font-medium">{row.title}</span>
                    <span className="block text-2xs text-muted-foreground" title={row.method}>
                      {row.metricId}
                    </span>
                  </span>
                ),
              },
              { key: "severity", header: tr("Severity"), cell: (row) => <Badge variant={SEVERITY_TONE[row.severity] ?? "muted"}>{row.severity}</Badge> },
              {
                key: "threshold",
                header: tr("Threshold"),
                cell: (row) => (
                  <span className="tabular text-xs text-muted-foreground">
                    {row.threshold ?? "—"}
                    {row.unit && row.unit !== "boolean" && row.threshold && !row.threshold.includes(row.unit) ? ` ${row.unit}` : ""}
                  </span>
                ),
              },
              { key: "origin", header: tr("Where the number comes from"), cell: (row) => <span className="text-2xs text-muted-foreground">{originLabel(row.origin, tr)}</span> },
              { key: "findings", header: tr("Findings"), cell: (row) => <span className="tabular text-xs">{row.findings ? formatNumber(row.findings) : "—"}</span>, align: "right" },
              { key: "repaired", header: tr("Repaired"), cell: (row) => <span className="tabular text-xs text-muted-foreground">{row.repaired ? formatNumber(row.repaired) : "—"}</span>, align: "right" },
              {
                key: "blocking",
                header: tr("Still blocking"),
                cell: (row) => <span className={cn("tabular text-xs", row.blocking > 0 && "font-semibold text-destructive")}>{row.blocking ? formatNumber(row.blocking) : "—"}</span>,
                align: "right",
              },
              { key: "workspaces", header: tr("Workspaces"), cell: (row) => <span className="tabular text-xs text-muted-foreground">{row.workspaces ? formatNumber(row.workspaces) : "—"}</span>, align: "right" },
              {
                key: "example",
                header: tr("Last measurement"),
                cell: (row) =>
                  row.example ? (
                    <span className="block max-w-[26rem] truncate text-2xs text-muted-foreground" title={row.example.message}>
                      {tr("expected")} {row.example.expected}, {tr("measured")} {row.example.actual}
                    </span>
                  ) : (
                    <span className="text-2xs text-muted-foreground">—</span>
                  ),
              },
            ]}
          />
          <p className="mt-2 text-2xs text-muted-foreground">
            {quiet} {tr("rule(s) found nothing in this window. A rule that found nothing and a rule that never ran are different things, so both are listed.")}
          </p>
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <SectionTitle>{tr("By customer")}</SectionTitle>
            <DataTable
              rows={workspaces}
              rowKey={(row: WorkspaceQualityRow) => row.organizationId ?? "none"}
              dense
              empty={{ title: tr("No preflight yet") }}
              columns={[
                { key: "name", header: tr("Workspace"), cell: (row) => <span className="font-medium">{row.name}</span> },
                { key: "runs", header: tr("Runs"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.runs)}</span>, align: "right" },
                { key: "passRate", header: tr("Passed"), cell: (row) => <span className="tabular text-xs">{row.runs ? percentLabel(row.passRate) : "—"}</span>, align: "right" },
                {
                  key: "blocking",
                  header: tr("Blocking"),
                  cell: (row) => <span className={cn("tabular text-xs", row.blocking > 0 && "font-semibold text-destructive")}>{row.blocking ? formatNumber(row.blocking) : "—"}</span>,
                  align: "right",
                },
                { key: "worst", header: tr("Worst"), cell: (row) => (row.worstSeverity ? <Badge variant={SEVERITY_TONE[row.worstSeverity] ?? "muted"}>{row.worstSeverity}</Badge> : <span className="text-2xs text-muted-foreground">—</span>) },
              ]}
            />
          </section>

          <section>
            <SectionTitle>{tr("By output")}</SectionTitle>
            <DataTable
              rows={profiles}
              rowKey={(row: ProfileQualityRow) => row.profile}
              dense
              empty={{ title: tr("No preflight yet") }}
              columns={[
                { key: "profile", header: tr("Profile"), cell: (row) => <span className="font-medium">{row.profile}</span> },
                { key: "runs", header: tr("Runs"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.runs)}</span>, align: "right" },
                { key: "passRate", header: tr("Clean"), cell: (row) => <span className="tabular text-xs">{row.runs ? percentLabel(row.passRate) : "—"}</span>, align: "right" },
                { key: "blocking", header: tr("Blocking"), cell: (row) => <span className="tabular text-xs">{row.blocking ? formatNumber(row.blocking) : "—"}</span>, align: "right" },
                { key: "duration", header: tr("Median"), cell: (row) => <span className="tabular text-xs text-muted-foreground">{(row.medianDurationMs / 1000).toFixed(1)} s</span>, align: "right" },
              ]}
            />
            {releases.releases.length > 0 && (
              <div className="mt-4">
                <SectionTitle>{tr("By release")}</SectionTitle>
                <DataTable
                  rows={releases.releases}
                  rowKey={(row) => row.release}
                  dense
                  columns={[
                    { key: "release", header: tr("Release"), cell: (row) => <span className="font-medium">{row.release}</span> },
                    { key: "runs", header: tr("Runs"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.runs)}</span>, align: "right" },
                    { key: "passRate", header: tr("Clean"), cell: (row) => <span className="tabular text-xs">{percentLabel(row.passRate)}</span>, align: "right" },
                    { key: "perRun", header: tr("Findings per run"), cell: (row) => <span className="tabular text-xs">{row.findingsPerRun.toFixed(2)}</span>, align: "right" },
                  ]}
                />
              </div>
            )}
          </section>
        </div>

        <section>
          <SectionTitle>{tr("Recent runs")}</SectionTitle>
          <DataTable
            rows={runs}
            rowKey={(row: RecentRun) => row.id}
            dense
            empty={{ title: tr("No preflight yet"), description: tr("Preflight runs when an export is rendered and when an issue is published.") }}
            columns={[
              {
                key: "edition",
                header: tr("Issue"),
                cell: (row) => (
                  <Link href={`/admin/quality/${row.id}`} className="font-medium hover:underline">
                    {row.editionTitle ?? tr("Deleted issue")}
                  </Link>
                ),
              },
              { key: "organization", header: tr("Workspace"), cell: (row) => <span className="text-xs text-muted-foreground">{row.organizationName ?? "—"}</span> },
              { key: "profile", header: tr("Profile"), cell: (row) => <span className="text-xs text-muted-foreground">{row.profile}</span> },
              { key: "status", header: tr("Verdict"), cell: (row) => <Badge variant={STATUS_TONE[row.status] ?? "muted"}>{row.status}</Badge> },
              { key: "worst", header: tr("Worst"), cell: (row) => (row.worstSeverity ? <Badge variant={SEVERITY_TONE[row.worstSeverity] ?? "muted"}>{row.worstSeverity}</Badge> : <span className="text-2xs text-muted-foreground">—</span>) },
              { key: "findings", header: tr("Findings"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.findings)}</span>, align: "right" },
              { key: "repaired", header: tr("Repaired"), cell: (row) => <span className="tabular text-xs text-muted-foreground">{row.repaired ? formatNumber(row.repaired) : "—"}</span>, align: "right" },
              { key: "spec", header: tr("Catalogue"), cell: (row) => <span className="tabular text-2xs text-muted-foreground">{row.specVersion}</span> },
              { key: "startedAt", header: tr("When"), cell: (row) => <span className="text-2xs text-muted-foreground">{formatDateTime(row.startedAt)}</span>, align: "right" },
            ]}
          />
        </section>

        <section className="flex flex-wrap gap-3 text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Ruler className="size-3" /> {tr("Every finding carries a metric, an expected value, a measured value and a place. None of them is an opinion.")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Wrench className="size-3" /> {tr("A repair is proved by a second measurement taken with the same code, never by the repair claiming to have worked.")}
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3" /> {tr("An output with a blocking finding that survived the repair loop cannot become ready or published. Nobody can approve it.")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Gauge className="size-3" /> {tr("Thresholds live in the rule catalogue, versioned, so a verdict from three months ago can be read in its own terms.")}
          </span>
        </section>
      </PageBody>
    </>
  );
}
