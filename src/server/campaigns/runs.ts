/**
 * Idempotent automation steps.
 *
 * Every step is keyed by a unique `runKey` in `automation_runs`. Claiming a key inserts the
 * row (or takes over a FAILED / released one); a SUCCEEDED or in-flight key is skipped, so a
 * re-run never re-sends emails.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { automationRuns } from "@/server/db/schema";
import { createLogger } from "@/server/logger";

const log = createLogger("campaigns:runs");

export type AutomationStep = (typeof automationRuns.$inferInsert)["step"];
export type TriggeredBy = "SCHEDULER" | "MANUAL";
export type AutomationRun = typeof automationRuns.$inferSelect;

/** A RUNNING row older than this is considered abandoned (crashed worker) and can be re-claimed. */
const STALE_RUNNING_MS = 15 * 60_000;

export type ClaimInput = {
  editionId: string | null;
  step: AutomationStep;
  runKey: string;
  triggeredBy: TriggeredBy;
  scheduledFor?: Date | null;
  now?: Date;
};

export type ClaimResult = { claimed: true; run: AutomationRun } | { claimed: false; reason: "SUCCEEDED" | "RUNNING"; run: AutomationRun };

export async function claimRun(input: ClaimInput): Promise<ClaimResult> {
  const now = input.now ?? new Date();
  const inserted = await db
    .insert(automationRuns)
    .values({
      editionId: input.editionId,
      step: input.step,
      runKey: input.runKey,
      status: "RUNNING",
      triggeredBy: input.triggeredBy,
      scheduledFor: input.scheduledFor ?? null,
      startedAt: now,
    })
    .onConflictDoNothing({ target: automationRuns.runKey })
    .returning();
  if (inserted[0]) return { claimed: true, run: inserted[0] };

  const existing = await db.query.automationRuns.findFirst({ where: eq(automationRuns.runKey, input.runKey) });
  if (!existing) throw new Error(`Automation run ${input.runKey} vanished during claim`);
  if (existing.status === "SUCCEEDED") return { claimed: false, reason: "SUCCEEDED", run: existing };
  if (existing.status === "RUNNING" && existing.startedAt && now.getTime() - existing.startedAt.getTime() < STALE_RUNNING_MS) {
    return { claimed: false, reason: "RUNNING", run: existing };
  }
  const [taken] = await db
    .update(automationRuns)
    .set({ status: "RUNNING", triggeredBy: input.triggeredBy, startedAt: now, finishedAt: null, error: null, scheduledFor: input.scheduledFor ?? existing.scheduledFor })
    .where(eq(automationRuns.id, existing.id))
    .returning();
  return { claimed: true, run: taken };
}

export async function finishRun(runId: string, outcome: { status: "SUCCEEDED" | "FAILED" | "SKIPPED"; summary?: Record<string, unknown>; error?: string | null; jobId?: string | null }) {
  await db
    .update(automationRuns)
    .set({ status: outcome.status, finishedAt: new Date(), summary: outcome.summary ?? {}, error: outcome.error ?? null, jobId: outcome.jobId ?? undefined })
    .where(eq(automationRuns.id, runId));
}

/** Marks a SUCCEEDED step as released so it may run again (used when a campaign is reopened). */
export async function releaseRun(runKey: string, reason = "REOPENED") {
  const rows = await db.update(automationRuns).set({ status: "RELEASED", error: reason }).where(eq(automationRuns.runKey, runKey)).returning({ id: automationRuns.id });
  return rows.length;
}

export type StepOutcome<T> = { status: "ran"; result: T; run: AutomationRun } | { status: "skipped"; reason: "SUCCEEDED" | "RUNNING"; run: AutomationRun };

/**
 * Runs `fn` under the idempotency key. The row records the outcome: SUCCEEDED with the
 * returned summary, or FAILED with the error (which is re-thrown).
 */
export async function runStep<T extends Record<string, unknown>>(input: ClaimInput, fn: (run: AutomationRun) => Promise<T>): Promise<StepOutcome<T>> {
  const claim = await claimRun(input);
  if (!claim.claimed) {
    log.info("step skipped", { runKey: input.runKey, reason: claim.reason });
    return { status: "skipped", reason: claim.reason, run: claim.run };
  }
  try {
    const result = await fn(claim.run);
    await finishRun(claim.run.id, { status: "SUCCEEDED", summary: result });
    log.info("step succeeded", { runKey: input.runKey });
    return { status: "ran", result, run: claim.run };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await finishRun(claim.run.id, { status: "FAILED", error: message.slice(0, 4000) });
    log.error("step failed", { runKey: input.runKey, err });
    throw err;
  }
}

/** Records a step that was evaluated but intentionally not executed (e.g. toggle disabled). */
export async function recordSkippedRun(input: ClaimInput, reason: string) {
  const claim = await claimRun(input);
  if (!claim.claimed) return claim.run;
  await finishRun(claim.run.id, { status: "SKIPPED", summary: { reason } });
  return claim.run;
}
