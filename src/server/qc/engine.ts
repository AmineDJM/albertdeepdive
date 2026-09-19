import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { buildEditionDocument } from "@/server/publication/document-builder";
import type { EditionDocument } from "@/lib/publication/document";
import type { LayoutReport } from "@/server/publication/paginate";
import { getStorage, type StorageAdapter } from "@/server/storage";
import { QC_SPEC_VERSION } from "./spec";
import { DEFAULT_PROFILE, profile, type OutputProfile } from "./profiles";
import { BLOCKING, HARD_BLOCKING, SEVERITY_ORDER, worst, type CheckResult, type Finding, type QcReport, type QcStatus, type RepairOutcome, type Severity } from "./types";

const log = createLogger("qc");

/**
 * Measure → compare → fail → repair → remeasure.
 *
 * The loop is the product, not the checks. Any one check could be written as a lint rule; what
 * makes this a quality system is that a defect is measured, given a threshold and a location,
 * repaired by a named strategy where one exists, and then **measured again by the same code** — so
 * the claim "fixed" is a second measurement rather than an assertion.
 *
 * Two rules the loop enforces that nothing else in the product can:
 *
 *   - A repair never regenerates the whole issue to fix one page. Regenerating changes a hundred
 *     things to fix one and makes the remeasure meaningless: you no longer know whether the defect
 *     went away or moved.
 *   - A blocking finding that survives the loop blocks. There is no reviewer, human or otherwise,
 *     who can approve a clipped word, a refused photograph or a PDF page that will not render.
 */

export type CheckId =
  | "storage"
  | "imagery"
  | "rights"
  | "geometry"
  | "typography"
  | "pdf"
  | "print"
  | "email"
  | "web"
  | "facts"
  | "revision"
  | "staleness"
  | "analytics"
  | "providers"
  | "brand"
  | "creative"
  | "reconciliation";

export type RenderedArtefact = {
  buffer: Buffer;
  pageCount: number;
  layoutReport: LayoutReport;
  finalDocument: EditionDocument;
  html: string;
};

export type QcContext = {
  editionId: string;
  organizationId: string | null;
  document: EditionDocument;
  profile: OutputProfile;
  storage: StorageAdapter;
  /** Set on a rerun so a check can compare against what it measured the first time. */
  pass: number;
  /**
   * Render the artefact, once per pass.
   *
   * Geometry cannot be checked without one. A layout that is "probably fine" is a layout nobody
   * measured, so a paged profile pays for a render and the checks that need it share the result —
   * rather than each opening its own browser, or worse, guessing from the document model.
   */
  render: () => Promise<RenderedArtefact>;
};

export type Check = {
  id: CheckId;
  title: string;
  /** Profiles this check applies to; empty means all of them. */
  kinds?: OutputProfile["kind"][];
  run: (ctx: QcContext) => Promise<CheckResult>;
};

export type RepairFn = (finding: Finding, ctx: QcContext) => Promise<RepairOutcome>;

/** Where the loop is, so a caller can show it rather than a spinner that means four different things. */
export type QcPhase = "MEASURING" | "REPAIRING" | "REMEASURING";

export type RunOptions = {
  profile?: string;
  /** Attempt deterministic repairs and measure again. On by default: measuring without fixing is a report, not a pipeline. */
  repair?: boolean;
  /** Only these checks. For tests and for the console's per-area reruns. */
  only?: CheckId[];
  persist?: boolean;
  triggeredById?: string | null;
  release?: string | null;
  /** The artefact this run is judging, when it is judging one. */
  versionId?: string | null;
  /**
   * An artefact that has just been rendered, measured instead of rendering a second one.
   *
   * Not an optimisation. Preflight must measure the file that will actually ship; rendering again
   * would measure a different file that happens to have been made the same way, and on the day
   * those two differ this is precisely the check that should notice.
   */
  rendered?: RenderedArtefact;
  onPhase?: (phase: QcPhase) => void | Promise<void>;
};

/** The registry is filled by `registerChecks` so the engine has no import cycle with its checks. */
const checks: Check[] = [];
const repairs = new Map<string, RepairFn>();

export function registerCheck(check: Check) {
  const existing = checks.findIndex((each) => each.id === check.id);
  if (existing >= 0) checks[existing] = check;
  else checks.push(check);
}

export function registerRepair(strategy: string, fn: RepairFn) {
  repairs.set(strategy, fn);
}

export function registeredChecks(): readonly Check[] {
  return checks;
}

const emptyCounts = (): Record<Severity, number> => ({ INFO: 0, WARNING: 0, FAIL: 0, HARD_FAIL: 0, CRITICAL_FAIL: 0 });

function count(findings: Finding[]): Record<Severity, number> {
  const counts = emptyCounts();
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** Whether anything here may never reach READY. */
export function blocks(findings: Finding[]): boolean {
  return findings.some((finding) => !finding.repaired && BLOCKING.includes(finding.severity));
}

/** Whether anything here means the artefact itself is unusable, draft or not. */
export function blocksHard(findings: Finding[]): boolean {
  return findings.some((finding) => !finding.repaired && HARD_BLOCKING.includes(finding.severity));
}

/**
 * Run every applicable check, repair what can be repaired, and measure again.
 *
 * The second pass is a full rerun of the checks whose findings were repaired, not a re-evaluation
 * of a cached number. That is slower and it is the point: a repair that fixes the measurement but
 * breaks a neighbour has to be visible, and only a real remeasure shows it.
 */
export async function runQc(editionId: string, options: RunOptions = {}): Promise<QcReport> {
  const startedAt = new Date();
  const profileId = options.profile ?? DEFAULT_PROFILE;
  const resolved = profile(profileId);
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), columns: { id: true, organizationId: true } });
  if (!edition) throw new Error(`Edition ${editionId} not found`);

  const skipped: { check: string; reason: string }[] = [];
  let findings: Finding[] = [];
  let passed: QcReport["passed"] = [];
  const repairLog: RepairOutcome[] = [];
  let status = "PASSED" as QcStatus;

  let ctx: QcContext;
  try {
    const document = options.rendered?.finalDocument ?? (await buildEditionDocument(editionId, { versionLabel: `qc-${QC_SPEC_VERSION}`, includeUnapproved: true }));
    ctx = {
      editionId,
      organizationId: edition.organizationId,
      document,
      profile: resolved,
      storage: await getStorage(),
      pass: 1,
      render: options.rendered ? async () => options.rendered! : renderer(document),
    };
  } catch (err) {
    // The document could not even be assembled. That is a critical failure of the issue, reported
    // as one rather than as a crash, so the pipeline records why nothing could be measured.
    const finishedAt = new Date();
    return {
      runId: null,
      editionId,
      organizationId: edition.organizationId,
      profile: profileId,
      specVersion: QC_SPEC_VERSION,
      status: "ERRORED",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      findings: [
        {
          metricId: "edition.assembles",
          severity: "CRITICAL_FAIL",
          message: `The issue could not be assembled: ${err instanceof Error ? err.message : String(err)}`,
          expected: "an assembled document",
          actual: "an error",
          unit: "boolean",
          threshold: null,
          location: { entityType: "edition", entityId: editionId },
          repairStrategy: null,
          beforeValue: null,
          afterValue: null,
          repaired: false,
        },
      ],
      passed: [],
      repairs: [],
      counts: { ...emptyCounts(), CRITICAL_FAIL: 1 },
      ok: false,
      skipped: [],
    };
  }

  const applicable = checks.filter((check) => {
    if (options.only && !options.only.includes(check.id)) return false;
    return !check.kinds || check.kinds.includes(resolved.kind);
  });

  const runOne = async (check: Check, context: QcContext): Promise<CheckResult> => {
    try {
      return await check.run(context);
    } catch (err) {
      // A check that throws is a check that did not run. Recording it as "skipped" rather than
      // letting it read as "passed" is the difference between a quality system and a green light.
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ check: check.id, reason });
      log.warn("qc check failed to run", { check: check.id, editionId, reason });
      status = "ERRORED";
      return { findings: [], passed: [] };
    }
  };

  await options.onPhase?.("MEASURING");
  for (const check of applicable) {
    const result = await runOne(check, ctx);
    findings = findings.concat(result.findings);
    passed = passed.concat(result.passed);
  }

  // ── repair, then measure again ───────────────────────────────────────────────────────────
  if (options.repair !== false) {
    const repairable = findings.filter((finding) => finding.repairStrategy && repairs.has(finding.repairStrategy));
    const touched = new Set<CheckId>();
    if (repairable.length) await options.onPhase?.("REPAIRING");
    for (const finding of repairable) {
      const fn = repairs.get(finding.repairStrategy!)!;
      try {
        const outcome = await fn(finding, ctx);
        repairLog.push(outcome);
        if (outcome.succeeded) {
          const owner = applicable.find((check) => finding.metricId.startsWith(checkPrefix(check.id)));
          if (owner) touched.add(owner.id);
        }
      } catch (err) {
        repairLog.push({
          strategy: finding.repairStrategy!,
          metricId: finding.metricId,
          location: finding.location,
          attempted: true,
          succeeded: false,
          before: finding.beforeValue,
          after: null,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (repairLog.some((outcome) => outcome.succeeded)) {
      // Rebuild the document: a repair that changed an article or an asset changed the thing every
      // other measurement was taken against.
      await options.onPhase?.("REMEASURING");
      const fresh = await buildEditionDocument(editionId, { versionLabel: `qc-${QC_SPEC_VERSION}`, includeUnapproved: true });
      const second: QcContext = { ...ctx, pass: 2, document: fresh, render: renderer(fresh) };
      const rerun = applicable.filter((check) => touched.size === 0 || touched.has(check.id));
      const before = findings;
      let after: Finding[] = findings.filter((finding) => !rerun.some((check) => finding.metricId.startsWith(checkPrefix(check.id))));
      let afterPassed = passed.filter((p) => !rerun.some((check) => p.metricId.startsWith(checkPrefix(check.id))));
      for (const check of rerun) {
        const result = await runOne(check, second);
        after = after.concat(result.findings);
        afterPassed = afterPassed.concat(result.passed);
      }
      // A finding that was measured before and is gone now was repaired; one that is still here
      // carries its before value so the report shows the attempt and its failure.
      const stillThere = new Set(after.map(key));
      for (const finding of before) {
        if (!stillThere.has(key(finding))) {
          const outcome = repairLog.find((each) => each.metricId === finding.metricId && sameLocation(each.location, finding.location));
          after.push({ ...finding, repaired: true, afterValue: outcome?.after ?? "within threshold" });
        }
      }
      findings = after;
      passed = afterPassed;
      if (repairLog.some((outcome) => outcome.succeeded) && status !== "ERRORED") status = "REPAIRED";
    }
  }

  const unresolved = findings.filter((finding) => !finding.repaired);
  if (status !== "ERRORED") status = blocks(unresolved) ? "FAILED" : status === "REPAIRED" ? "REPAIRED" : "PASSED";

  const finishedAt = new Date();
  const report: QcReport = {
    runId: null,
    editionId,
    organizationId: edition.organizationId,
    profile: profileId,
    specVersion: QC_SPEC_VERSION,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    findings: [...findings].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]),
    passed,
    repairs: repairLog,
    counts: count(unresolved),
    ok: !blocks(unresolved) && status !== "ERRORED",
    skipped,
  };

  if (options.persist !== false) report.runId = await persist(report, options);
  log.info("qc run", { editionId, profile: profileId, status, findings: findings.length, repaired: repairLog.filter((r) => r.succeeded).length, ms: report.durationMs });
  return report;
}

/**
 * One render per pass, shared by every check that needs geometry.
 *
 * Memoised rather than eager: an email or web profile never renders a PDF at all, and a run that
 * only re-checks rights should not open a browser to do it.
 */
function renderer(document: EditionDocument): () => Promise<RenderedArtefact> {
  let pending: Promise<RenderedArtefact> | null = null;
  return () => {
    pending ??= (async () => {
      const { launchBrowser, renderPdf } = await import("@/server/publication/pdf");
      const browser = await launchBrowser();
      try {
        const result = await renderPdf(document, { browser, log: () => {} });
        return { buffer: result.buffer, pageCount: result.pageCount, layoutReport: result.layoutReport, finalDocument: result.finalDocument, html: result.html };
      } finally {
        await browser.close();
      }
    })();
    return pending;
  };
}

/** Metric ids are namespaced by area so a rerun knows which check owns which finding. */
function checkPrefix(id: CheckId): string {
  const map: Record<CheckId, string> = {
    storage: "storage.",
    imagery: "image.",
    rights: "rights.",
    geometry: "layout.",
    typography: "layout.text",
    pdf: "pdf.",
    print: "print.",
    email: "email.",
    web: "web.",
    facts: "facts.",
    revision: "revision.",
    staleness: "output.",
    analytics: "analytics.",
    providers: "provider.",
    brand: "brand.",
    creative: "creative.",
    reconciliation: "delivery.",
  };
  return map[id];
}

const key = (finding: Finding): string => `${finding.metricId}|${finding.location.entityId ?? ""}|${finding.location.page ?? ""}|${finding.location.field ?? ""}`;

function sameLocation(a: Finding["location"], b: Finding["location"]): boolean {
  return a.entityId === b.entityId && a.page === b.page && a.field === b.field;
}

async function persist(report: QcReport, options: RunOptions): Promise<string | null> {
  try {
    const [run] = await db
      .insert(s.qcRuns)
      .values({
        organizationId: report.organizationId,
        editionId: report.editionId,
        versionId: options.versionId ?? null,
        profile: report.profile,
        specVersion: report.specVersion,
        status: report.status,
        worstSeverity: worst(report.findings.filter((f) => !f.repaired).map((f) => f.severity)),
        findings: report.findings.length,
        repaired: report.findings.filter((f) => f.repaired).length,
        passed: report.passed.length,
        durationMs: report.durationMs,
        release: options.release ?? null,
        summary: { counts: report.counts, repairs: report.repairs, skipped: report.skipped, ok: report.ok },
        triggeredById: options.triggeredById ?? null,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
      })
      .returning();
    if (report.findings.length) {
      await db.insert(s.qcFindings).values(
        report.findings.map((finding) => ({
          runId: run.id,
          organizationId: report.organizationId,
          metricId: finding.metricId,
          severity: finding.severity,
          message: finding.message,
          expected: finding.expected,
          actual: finding.actual,
          unit: finding.unit,
          threshold: finding.threshold,
          location: finding.location as Record<string, unknown>,
          repairStrategy: finding.repairStrategy,
          beforeValue: finding.beforeValue === null ? null : String(finding.beforeValue),
          afterValue: finding.afterValue === null ? null : String(finding.afterValue),
          repaired: finding.repaired ? new Date() : null,
          evidence: finding.evidence ?? null,
        })),
      );
    }
    return run.id;
  } catch (err) {
    // A quality run that cannot be filed is still a quality run: the verdict is returned either way.
    log.warn("could not record a qc run", { editionId: report.editionId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
