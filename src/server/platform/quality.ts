import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ALL_METRICS, QC_SPEC_VERSION, metricById } from "@/server/qc/spec";
import { BLOCKING, SEVERITY_ORDER, type Severity } from "@/server/qc/types";

/**
 * What Briefly's own output quality looks like, across every workspace, for the people who run it.
 *
 * Deliberately here rather than in `server/analytics`: the tenant readers next door structurally
 * require a workspace, and the console does not get a cross-customer view by leaving an argument
 * out. It gets it from queries written to read across all of them and used nowhere else.
 *
 * Every figure on this page is a count of measurements, never a score. "Quality" as a single number
 * between 0 and 100 is the thing this whole engine exists to replace: it cannot be acted on, it
 * cannot be argued with, and it hides the one page that is broken behind the ninety-nine that are
 * not. So the page answers questions instead — how often does a PDF pass preflight, how many
 * pictures were refused and why, which workspace has the rights problem, and did the last release
 * make any of it worse.
 */

const DAY = 24 * 60 * 60 * 1000;
const since = (days: number) => new Date(Date.now() - days * DAY);
const n = (value: unknown): number => Number(value ?? 0);
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export type QualityTotals = {
  runs: number;
  passed: number;
  repaired: number;
  failed: number;
  errored: number;
  passRate: number;
  /** Runs that reached a verdict without anything blocking surviving the repair loop. */
  cleanRate: number;
  findings: number;
  findingsRepaired: number;
  repairRate: number;
  medianDurationMs: number;
  specVersions: string[];
};

export async function qualityTotals(days = 30): Promise<QualityTotals> {
  const from = since(days);
  const [row] = await db
    .select({
      runs: count(),
      passed: sql<number>`count(*) filter (where ${s.qcRuns.status} = 'PASSED')`,
      repaired: sql<number>`count(*) filter (where ${s.qcRuns.status} = 'REPAIRED')`,
      failed: sql<number>`count(*) filter (where ${s.qcRuns.status} = 'FAILED')`,
      errored: sql<number>`count(*) filter (where ${s.qcRuns.status} = 'ERRORED')`,
      findings: sql<number>`coalesce(sum(${s.qcRuns.findings}), 0)`,
      findingsRepaired: sql<number>`coalesce(sum(${s.qcRuns.repaired}), 0)`,
      medianDurationMs: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${s.qcRuns.durationMs}), 0)`,
      specVersions: sql<string[]>`coalesce(array_agg(distinct ${s.qcRuns.specVersion}), '{}')`,
    })
    .from(s.qcRuns)
    .where(gte(s.qcRuns.startedAt, from));

  const runs = n(row?.runs);
  const findings = n(row?.findings);
  return {
    runs,
    passed: n(row?.passed),
    repaired: n(row?.repaired),
    failed: n(row?.failed),
    errored: n(row?.errored),
    passRate: ratio(n(row?.passed), runs),
    cleanRate: ratio(n(row?.passed) + n(row?.repaired), runs),
    findings,
    findingsRepaired: n(row?.findingsRepaired),
    repairRate: ratio(n(row?.findingsRepaired), findings),
    medianDurationMs: Math.round(n(row?.medianDurationMs)),
    specVersions: (row?.specVersions ?? []).filter(Boolean),
  };
}

export type MetricRow = {
  metricId: string;
  title: string;
  method: string;
  origin: string;
  unit: string;
  severity: Severity;
  /** How the rule states its threshold, for the column that has to explain a number. */
  threshold: string | null;
  findings: number;
  repaired: number;
  outstanding: number;
  blocking: number;
  workspaces: number;
  worstSeverity: Severity | null;
  /** One measurement, so the row is not only a count. */
  example: { message: string; expected: string; actual: string; unit: string } | null;
};

/**
 * Every rule, with what it actually caught.
 *
 * Rules with no findings are kept rather than dropped. A catalogue that only lists what failed
 * cannot tell you the difference between a check that found nothing and a check that never ran,
 * and that difference is the entire value of the thing.
 */
export async function qualityByMetric(days = 30): Promise<MetricRow[]> {
  const from = since(days);
  const rows = await db
    .select({
      metricId: s.qcFindings.metricId,
      findings: count(),
      repaired: sql<number>`count(*) filter (where ${s.qcFindings.repaired} is not null)`,
      blocking: sql<number>`count(*) filter (where ${s.qcFindings.repaired} is null and ${s.qcFindings.severity} in ('FAIL','HARD_FAIL','CRITICAL_FAIL'))`,
      workspaces: sql<number>`count(distinct ${s.qcFindings.organizationId})`,
      severities: sql<string[]>`array_agg(distinct ${s.qcFindings.severity})`,
      message: sql<string>`(array_agg(${s.qcFindings.message} order by ${s.qcFindings.createdAt} desc))[1]`,
      expected: sql<string>`(array_agg(${s.qcFindings.expected} order by ${s.qcFindings.createdAt} desc))[1]`,
      actual: sql<string>`(array_agg(${s.qcFindings.actual} order by ${s.qcFindings.createdAt} desc))[1]`,
      unit: sql<string>`(array_agg(${s.qcFindings.unit} order by ${s.qcFindings.createdAt} desc))[1]`,
    })
    .from(s.qcFindings)
    .innerJoin(s.qcRuns, eq(s.qcRuns.id, s.qcFindings.runId))
    .where(gte(s.qcRuns.startedAt, from))
    .groupBy(s.qcFindings.metricId);

  const measured = new Map(rows.map((row) => [row.metricId, row]));
  return ALL_METRICS.map((metric) => {
    const row = measured.get(metric.id);
    const findings = n(row?.findings);
    const repaired = n(row?.repaired);
    const severities = (row?.severities ?? []).filter(Boolean) as Severity[];
    return {
      metricId: metric.id,
      title: metric.title,
      method: metric.method,
      origin: metric.origin,
      unit: metric.unit,
      severity: metric.severity,
      threshold: thresholdText(metric.id),
      findings,
      repaired,
      outstanding: findings - repaired,
      blocking: n(row?.blocking),
      workspaces: n(row?.workspaces),
      worstSeverity: severities.length ? severities.reduce((a, b) => (SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b)) : null,
      example: row?.message ? { message: row.message, expected: row.expected, actual: row.actual, unit: row.unit ?? "" } : null,
    };
  }).sort((a, b) => b.blocking - a.blocking || b.findings - a.findings || a.metricId.localeCompare(b.metricId));
}

/** How a rule states the number it compares against, so a row can explain itself. */
function thresholdText(metricId: string): string | null {
  const metric = metricById.get(metricId);
  if (!metric) return null;
  if (metric.failureThreshold !== undefined) return `${metric.failureThreshold}${metric.unit === "count" ? "" : ` ${metric.unit}`}`;
  return metric.target === undefined || metric.target === null ? null : String(metric.target);
}

export type WorkspaceQualityRow = {
  organizationId: string | null;
  name: string;
  runs: number;
  failed: number;
  passRate: number;
  outstanding: number;
  blocking: number;
  worstSeverity: Severity | null;
  lastRunAt: Date | null;
};

export async function qualityByWorkspace(days = 30): Promise<WorkspaceQualityRow[]> {
  const from = since(days);
  const rows = await db
    .select({
      organizationId: s.qcRuns.organizationId,
      name: s.organizations.name,
      runs: count(),
      failed: sql<number>`count(*) filter (where ${s.qcRuns.status} in ('FAILED','ERRORED'))`,
      passed: sql<number>`count(*) filter (where ${s.qcRuns.status} = 'PASSED')`,
      lastRunAt: sql<Date | null>`max(${s.qcRuns.startedAt})`,
      severities: sql<string[]>`array_agg(distinct ${s.qcRuns.worstSeverity})`,
    })
    .from(s.qcRuns)
    .leftJoin(s.organizations, eq(s.organizations.id, s.qcRuns.organizationId))
    .where(gte(s.qcRuns.startedAt, from))
    .groupBy(s.qcRuns.organizationId, s.organizations.name);

  const ids = rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id));
  const outstanding = ids.length
    ? await db
        .select({
          organizationId: s.qcFindings.organizationId,
          outstanding: sql<number>`count(*) filter (where ${s.qcFindings.repaired} is null)`,
          blocking: sql<number>`count(*) filter (where ${s.qcFindings.repaired} is null and ${s.qcFindings.severity} in ('FAIL','HARD_FAIL','CRITICAL_FAIL'))`,
        })
        .from(s.qcFindings)
        .innerJoin(s.qcRuns, eq(s.qcRuns.id, s.qcFindings.runId))
        .where(and(gte(s.qcRuns.startedAt, from), inArray(s.qcFindings.organizationId, ids)))
        .groupBy(s.qcFindings.organizationId)
    : [];
  const byOrg = new Map(outstanding.map((row) => [row.organizationId, row]));

  return rows
    .map((row) => {
      const severities = (row.severities ?? []).filter(Boolean) as Severity[];
      const extra = row.organizationId ? byOrg.get(row.organizationId) : undefined;
      return {
        organizationId: row.organizationId,
        name: row.name ?? "—",
        runs: n(row.runs),
        failed: n(row.failed),
        passRate: ratio(n(row.passed), n(row.runs)),
        outstanding: n(extra?.outstanding),
        blocking: n(extra?.blocking),
        worstSeverity: severities.length ? severities.reduce((a, b) => (SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b)) : null,
        lastRunAt: row.lastRunAt ? new Date(row.lastRunAt) : null,
      };
    })
    .sort((a, b) => b.blocking - a.blocking || b.failed - a.failed);
}

export type ProfileQualityRow = { profile: string; runs: number; passRate: number; blocking: number; medianDurationMs: number };

export async function qualityByProfile(days = 30): Promise<ProfileQualityRow[]> {
  const from = since(days);
  const rows = await db
    .select({
      profile: s.qcRuns.profile,
      runs: count(),
      passed: sql<number>`count(*) filter (where ${s.qcRuns.status} in ('PASSED','REPAIRED'))`,
      medianDurationMs: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${s.qcRuns.durationMs}), 0)`,
    })
    .from(s.qcRuns)
    .where(gte(s.qcRuns.startedAt, from))
    .groupBy(s.qcRuns.profile);

  const blocking = await db
    .select({ profile: s.qcRuns.profile, blocking: sql<number>`count(*) filter (where ${s.qcFindings.repaired} is null and ${s.qcFindings.severity} in ('FAIL','HARD_FAIL','CRITICAL_FAIL'))` })
    .from(s.qcFindings)
    .innerJoin(s.qcRuns, eq(s.qcRuns.id, s.qcFindings.runId))
    .where(gte(s.qcRuns.startedAt, from))
    .groupBy(s.qcRuns.profile);
  const byProfile = new Map(blocking.map((row) => [row.profile, n(row.blocking)]));

  return rows
    .map((row) => ({
      profile: row.profile,
      runs: n(row.runs),
      passRate: ratio(n(row.passed), n(row.runs)),
      blocking: byProfile.get(row.profile) ?? 0,
      medianDurationMs: Math.round(n(row.medianDurationMs)),
    }))
    .sort((a, b) => b.runs - a.runs);
}

export type ReleaseRow = { release: string; runs: number; passRate: number; findingsPerRun: number };
export type Regression = { metricId: string; title: string; before: number; after: number; delta: number };

/**
 * Quality per release, and the rules that got worse between the last two.
 *
 * The comparison is per run rather than in absolutes, because a release that shipped twice as many
 * issues would otherwise look twice as broken. A rule that fires more often per run after a
 * release is a regression that release caused; that is the alert worth waking somebody for, and
 * the only one this page raises.
 */
export async function qualityByRelease(days = 90): Promise<{ releases: ReleaseRow[]; regressions: Regression[] }> {
  const from = since(days);
  const rows = await db
    .select({
      release: s.qcRuns.release,
      runs: count(),
      passed: sql<number>`count(*) filter (where ${s.qcRuns.status} in ('PASSED','REPAIRED'))`,
      findings: sql<number>`coalesce(sum(${s.qcRuns.findings}), 0)`,
      last: sql<Date>`max(${s.qcRuns.startedAt})`,
    })
    .from(s.qcRuns)
    .where(and(gte(s.qcRuns.startedAt, from), sql`${s.qcRuns.release} is not null`))
    .groupBy(s.qcRuns.release)
    .orderBy(desc(sql`max(${s.qcRuns.startedAt})`));

  const releases = rows.map((row) => ({
    release: row.release ?? "—",
    runs: n(row.runs),
    passRate: ratio(n(row.passed), n(row.runs)),
    findingsPerRun: n(row.runs) ? n(row.findings) / n(row.runs) : 0,
  }));

  if (releases.length < 2) return { releases, regressions: [] };
  const [after, before] = [rows[0].release, rows[1].release];
  const rates = async (release: string | null) => {
    const perMetric = await db
      .select({ metricId: s.qcFindings.metricId, findings: count() })
      .from(s.qcFindings)
      .innerJoin(s.qcRuns, eq(s.qcRuns.id, s.qcFindings.runId))
      .where(and(gte(s.qcRuns.startedAt, from), eq(s.qcRuns.release, release ?? "")))
      .groupBy(s.qcFindings.metricId);
    const runs = release === rows[0].release ? n(rows[0].runs) : n(rows[1].runs);
    return new Map(perMetric.map((row) => [row.metricId, runs ? n(row.findings) / runs : 0]));
  };
  const [beforeRates, afterRates] = await Promise.all([rates(before), rates(after)]);

  const regressions: Regression[] = [];
  for (const [metricId, rate] of afterRates) {
    const previous = beforeRates.get(metricId) ?? 0;
    // A tenth of a finding per run is the noise floor: below it, one unlucky issue looks like a trend.
    if (rate - previous > 0.1) {
      regressions.push({ metricId, title: metricById.get(metricId)?.title ?? metricId, before: previous, after: rate, delta: rate - previous });
    }
  }
  return { releases, regressions: regressions.sort((a, b) => b.delta - a.delta) };
}

export type RecentRun = {
  id: string;
  editionId: string | null;
  editionTitle: string | null;
  organizationName: string | null;
  profile: string;
  specVersion: string;
  status: string;
  worstSeverity: Severity | null;
  findings: number;
  repaired: number;
  startedAt: Date;
  durationMs: number;
};

export async function recentQualityRuns(limit = 25): Promise<RecentRun[]> {
  const rows = await db
    .select({
      id: s.qcRuns.id,
      editionId: s.qcRuns.editionId,
      editionTitle: s.editions.title,
      organizationName: s.organizations.name,
      profile: s.qcRuns.profile,
      specVersion: s.qcRuns.specVersion,
      status: s.qcRuns.status,
      worstSeverity: s.qcRuns.worstSeverity,
      findings: s.qcRuns.findings,
      repaired: s.qcRuns.repaired,
      startedAt: s.qcRuns.startedAt,
      durationMs: s.qcRuns.durationMs,
    })
    .from(s.qcRuns)
    .leftJoin(s.editions, eq(s.editions.id, s.qcRuns.editionId))
    .leftJoin(s.organizations, eq(s.organizations.id, s.qcRuns.organizationId))
    .orderBy(desc(s.qcRuns.startedAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, worstSeverity: (row.worstSeverity as Severity | null) ?? null, findings: n(row.findings), repaired: n(row.repaired), durationMs: n(row.durationMs) }));
}

export type RunDetail = {
  run: RecentRun;
  findings: {
    metricId: string;
    severity: Severity;
    message: string;
    expected: string;
    actual: string;
    unit: string;
    threshold: string | null;
    location: Record<string, unknown>;
    repairStrategy: string | null;
    beforeValue: string | null;
    afterValue: string | null;
    repaired: boolean;
    evidence: Record<string, unknown> | null;
  }[];
  summary: Record<string, unknown>;
};

export async function qualityRun(runId: string): Promise<RunDetail | null> {
  const [run] = await db
    .select({
      id: s.qcRuns.id,
      editionId: s.qcRuns.editionId,
      editionTitle: s.editions.title,
      organizationName: s.organizations.name,
      profile: s.qcRuns.profile,
      specVersion: s.qcRuns.specVersion,
      status: s.qcRuns.status,
      worstSeverity: s.qcRuns.worstSeverity,
      findings: s.qcRuns.findings,
      repaired: s.qcRuns.repaired,
      startedAt: s.qcRuns.startedAt,
      durationMs: s.qcRuns.durationMs,
      summary: s.qcRuns.summary,
    })
    .from(s.qcRuns)
    .leftJoin(s.editions, eq(s.editions.id, s.qcRuns.editionId))
    .leftJoin(s.organizations, eq(s.organizations.id, s.qcRuns.organizationId))
    .where(eq(s.qcRuns.id, runId))
    .limit(1);
  if (!run) return null;

  const rows = await db.select().from(s.qcFindings).where(eq(s.qcFindings.runId, runId));
  const findings = rows
    .map((row) => ({
      metricId: row.metricId,
      severity: row.severity as Severity,
      message: row.message,
      expected: row.expected,
      actual: row.actual,
      unit: row.unit,
      threshold: row.threshold,
      location: row.location,
      repairStrategy: row.repairStrategy,
      beforeValue: row.beforeValue,
      afterValue: row.afterValue,
      repaired: Boolean(row.repaired),
      evidence: row.evidence ?? null,
    }))
    .sort((a, b) => Number(a.repaired) - Number(b.repaired) || SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  return {
    run: { ...run, worstSeverity: (run.worstSeverity as Severity | null) ?? null, findings: n(run.findings), repaired: n(run.repaired), durationMs: n(run.durationMs) },
    findings,
    summary: (run.summary ?? {}) as Record<string, unknown>,
  };
}

/** The catalogue as the console shows it: what Briefly measures, whether or not it has fired. */
export function qualityCatalogue() {
  return { specVersion: QC_SPEC_VERSION, metrics: ALL_METRICS, blocking: BLOCKING };
}
