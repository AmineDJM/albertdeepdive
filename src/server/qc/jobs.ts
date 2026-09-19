import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES, registerJobHandler } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { runQc, type CheckId, type RunOptions } from "./engine";

/**
 * Preflight off the request path, and a sweep that looks at what has already gone out.
 *
 * Two jobs, for two different questions. The first is the same measurement the export path runs,
 * queued rather than awaited: the console's "measure this again" and anything that wants a verdict
 * without holding a page open for forty seconds.
 *
 * The second is the one that only a scheduled job can ask. A published issue is not a finished
 * thing — its pictures live in a bucket somebody can empty, its rights can be withdrawn, and the
 * document it was made from goes on changing after the file was frozen. An artefact that was
 * correct in March can be wrong in September without anybody touching it, and the only way to know
 * is to measure it again in September.
 */

export type PreflightJobPayload = {
  editionId: string;
  profile?: string;
  only?: CheckId[];
  repair?: boolean;
  release?: string | null;
  userId?: string | null;
};

registerJobHandler<PreflightJobPayload, Record<string, unknown>>(JOB_TYPES.QC_PREFLIGHT, async (payload, ctx) => {
  if (!payload.editionId) throw new Error("QC_PREFLIGHT payload requires editionId");
  ctx.log("preflight", { editionId: payload.editionId, profile: payload.profile });
  const options: RunOptions = {
    profile: payload.profile,
    only: payload.only,
    repair: payload.repair ?? true,
    release: payload.release ?? null,
    triggeredById: payload.userId ?? null,
    onPhase: (phase) => ctx.log(`preflight ${phase.toLowerCase()}`),
  };
  const report = await runQc(payload.editionId, options);
  return {
    runId: report.runId,
    status: report.status,
    ok: report.ok,
    findings: report.findings.length,
    repaired: report.findings.filter((finding) => finding.repaired).length,
    blocking: report.findings.filter((finding) => !finding.repaired && ["FAIL", "HARD_FAIL", "CRITICAL_FAIL"].includes(finding.severity)).length,
  };
});

/** How many published issues one sweep re-measures. Bounded so a nightly tick cannot become a render farm. */
const SWEEP_LIMIT = 10;

registerJobHandler<{ limit?: number; profile?: string }, Record<string, unknown>>(JOB_TYPES.QC_SWEEP, async (payload, ctx) => {
  const limit = Math.min(payload.limit ?? SWEEP_LIMIT, 50);
  // The least recently measured published issues first, so a sweep that only gets through half the
  // library still works its way round rather than re-measuring the same ten every night.
  const published = await db
    .select({ id: s.editions.id, publishedAt: s.editions.publishedAt })
    .from(s.editions)
    .where(and(eq(s.editions.status, "PUBLISHED"), isNotNull(s.editions.publishedVersionId)))
    .orderBy(desc(s.editions.publishedAt))
    .limit(200);
  if (!published.length) return { swept: 0 };

  const ids = published.map((edition) => edition.id);
  const lastRuns = await db
    .select({ editionId: s.qcRuns.editionId, last: s.qcRuns.startedAt })
    .from(s.qcRuns)
    .where(inArray(s.qcRuns.editionId, ids))
    .orderBy(desc(s.qcRuns.startedAt));
  const seen = new Map<string, Date>();
  for (const run of lastRuns) if (run.editionId && !seen.has(run.editionId)) seen.set(run.editionId, run.last);

  const queue = published
    .sort((a, b) => (seen.get(a.id)?.getTime() ?? 0) - (seen.get(b.id)?.getTime() ?? 0))
    .slice(0, limit);

  for (const edition of queue) {
    await enqueueJob({
      type: JOB_TYPES.QC_PREFLIGHT,
      // A sweep never repairs. Changing a published issue because a nightly job thought it should
      // is exactly the surprise nobody wants to find in the morning; it measures and reports.
      payload: { editionId: edition.id, profile: payload.profile, repair: false },
      idempotencyKey: `qc.sweep:${edition.id}:${new Date().toISOString().slice(0, 10)}`,
      editionId: edition.id,
      maxAttempts: 1,
    });
  }
  ctx.log("queued a preflight sweep", { editions: queue.length });
  return { swept: queue.length };
});

/** Queue a preflight for an issue and nudge the runner. Used by the console and by the sweep. */
export async function enqueuePreflight(editionId: string, options: Omit<PreflightJobPayload, "editionId"> = {}) {
  const job = await enqueueJob({
    type: JOB_TYPES.QC_PREFLIGHT,
    payload: { editionId, ...options },
    idempotencyKey: `qc.preflight:${editionId}:${Date.now()}`,
    editionId,
    createdById: options.userId ?? null,
    maxAttempts: 1,
  });
  kickJobRunner();
  return job;
}
