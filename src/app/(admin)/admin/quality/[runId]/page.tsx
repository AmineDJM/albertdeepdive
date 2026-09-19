import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { qualityRun } from "@/server/platform/quality";
import { metricById } from "@/server/qc/spec";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, "success" | "warning" | "destructive" | "muted" | "info"> = {
  INFO: "muted",
  WARNING: "warning",
  FAIL: "destructive",
  HARD_FAIL: "destructive",
  CRITICAL_FAIL: "destructive",
};

/**
 * One run, finding by finding, with the evidence behind each number.
 *
 * The screen exists so that an argument about a blocked issue is short. Not "the export failed"
 * but: this rule, this threshold, this page, this measurement, this repair, this second
 * measurement. Somebody who disagrees with the verdict can see exactly which number to dispute.
 */
export default async function QualityRunPage({ params }: { params: Promise<{ runId: string }> }) {
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

  const detail = await qualityRun((await params).runId);
  if (!detail) notFound();
  const { run, findings } = detail;
  const outstanding = findings.filter((finding) => !finding.repaired);
  const repaired = findings.filter((finding) => finding.repaired);
  const skipped = (detail.summary.skipped ?? []) as { check: string; reason: string }[];

  return (
    <>
      <PageHeader
        title={run.editionTitle ?? tr("Deleted issue")}
        description={`${run.organizationName ?? "—"} · ${run.profile} · ${tr("catalogue")} ${run.specVersion} · ${formatDateTime(run.startedAt)}`}
      />
      <PageBody className="space-y-6">
        <Link href="/admin/quality" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> {tr("All runs")}
        </Link>

        <StatGrid columns={4}>
          <Stat label={tr("Verdict")} value={run.status} tone={run.status === "FAILED" || run.status === "ERRORED" ? "destructive" : "default"} />
          <Stat label={tr("Still failing")} value={String(outstanding.length)} hint={run.worstSeverity ? `${tr("worst")}: ${run.worstSeverity}` : tr("nothing outstanding")} tone={outstanding.length ? "warning" : "default"} />
          <Stat label={tr("Repaired")} value={String(repaired.length)} hint={tr("each proved by a second measurement")} />
          <Stat label={tr("Took")} value={`${(run.durationMs / 1000).toFixed(1)} s`} />
        </StatGrid>

        {skipped.length > 0 && (
          <section className="rounded-lg border border-warning/40 bg-warning-soft/40 p-4">
            <h2 className="text-[13px] font-semibold text-warning">{tr("These checks could not run, so they found nothing — which is not the same as passing")}</h2>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {skipped.map((entry) => (
                <li key={entry.check}>
                  <span className="font-medium text-foreground">{entry.check}</span>: {entry.reason}
                </li>
              ))}
            </ul>
          </section>
        )}

        {[
          { title: tr("Outstanding"), rows: outstanding },
          { title: tr("Repaired, and measured again"), rows: repaired },
        ]
          .filter((group) => group.rows.length > 0)
          .map((group) => (
            <section key={group.title}>
              <SectionTitle>{group.title}</SectionTitle>
              <ul className="space-y-2">
                {group.rows.map((finding, index) => {
                  const metric = metricById.get(finding.metricId);
                  const location = finding.location as { page?: number; entityLabel?: string; entityType?: string; output?: string; field?: string };
                  return (
                    <li key={`${finding.metricId}-${index}`} className={cn("rounded-lg border border-border bg-card p-3", finding.repaired && "opacity-80")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={finding.repaired ? "success" : (SEVERITY_TONE[finding.severity] ?? "muted")}>{finding.repaired ? tr("repaired") : finding.severity}</Badge>
                        <span className="text-[13px] font-medium">{metric?.title ?? finding.metricId}</span>
                        <span className="tabular text-2xs text-muted-foreground">{finding.metricId}</span>
                      </div>
                      <p className="mt-1 text-[13px]">{finding.message}</p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs text-muted-foreground sm:grid-cols-4">
                        <div>
                          <dt className="uppercase tracking-[0.06em]">{tr("Expected")}</dt>
                          <dd className="tabular text-foreground">{finding.expected}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-[0.06em]">{tr("Measured")}</dt>
                          <dd className="tabular text-foreground">{finding.actual}</dd>
                        </div>
                        {finding.threshold && (
                          <div>
                            <dt className="uppercase tracking-[0.06em]">{tr("Threshold")}</dt>
                            <dd className="tabular text-foreground">
                              {finding.threshold} {finding.unit !== "boolean" ? finding.unit : ""}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt className="uppercase tracking-[0.06em]">{tr("Where")}</dt>
                          <dd className="text-foreground">
                            {[location.output, location.entityType, location.entityLabel, location.page ? `${tr("page")} ${location.page}` : null, location.field].filter(Boolean).join(" · ") || "—"}
                          </dd>
                        </div>
                        {finding.repairStrategy && (
                          <div>
                            <dt className="uppercase tracking-[0.06em]">{tr("Repair")}</dt>
                            <dd className="text-foreground">{finding.repairStrategy}</dd>
                          </div>
                        )}
                        {(finding.beforeValue !== null || finding.afterValue !== null) && (
                          <div>
                            <dt className="uppercase tracking-[0.06em]">{tr("Before → after")}</dt>
                            <dd className="tabular text-foreground">
                              {finding.beforeValue ?? "—"} → {finding.afterValue ?? "—"}
                            </dd>
                          </div>
                        )}
                        {metric && (
                          <div className="col-span-2 sm:col-span-4">
                            <dt className="uppercase tracking-[0.06em]">{tr("How it is measured")}</dt>
                            <dd className="text-foreground">{metric.method}</dd>
                          </div>
                        )}
                        {finding.evidence && Object.keys(finding.evidence).length > 0 && (
                          <div className="col-span-2 sm:col-span-4">
                            <dt className="uppercase tracking-[0.06em]">{tr("Evidence")}</dt>
                            <dd className="tabular break-all text-foreground">{JSON.stringify(finding.evidence)}</dd>
                          </div>
                        )}
                      </dl>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

        {findings.length === 0 && <p className="text-[14px] text-muted-foreground">{tr("Nothing failed its threshold in this run.")}</p>}
      </PageBody>
    </>
  );
}
