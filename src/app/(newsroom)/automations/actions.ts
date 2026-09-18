"use server";

import { revalidatePath } from "next/cache";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { requirePermission } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { cancelJob, retryJob } from "@/server/jobs/queue";
import { drainJobs, kickJobRunner } from "@/server/jobs/runner";
import { ensureNextEdition, runAutomationTick } from "@/server/campaigns/scheduler";
import { closeCampaign, openCampaign, sendReminders, type Campaign } from "@/server/campaigns/service";
import { AUTOMATION_KEYS, getCampaignDefaults, type AutomationKey } from "@/server/campaigns/settings";
import { fail, ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

function revalidate() {
  revalidatePath("/automations");
}

const ACTIVE_CAMPAIGNS = ["SCHEDULED", "OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD"] as const;

/** The campaign an automation would act on: the one of the named edition, else the next active one. */
async function targetCampaign(editionId: string | null): Promise<Campaign | null> {
  if (editionId) {
    const row = await db.query.submissionCampaigns.findFirst({ where: eq(s.submissionCampaigns.editionId, editionId), orderBy: [desc(s.submissionCampaigns.createdAt)] });
    if (row) return row;
  }
  const next = await db.query.submissionCampaigns.findFirst({ where: inArray(s.submissionCampaigns.status, [...ACTIVE_CAMPAIGNS]), orderBy: [asc(s.submissionCampaigns.opensAt)] });
  return next ?? null;
}

export type RunOutcome = { ran: boolean; detail: string };

/**
 * Runs one automation immediately. Each step keeps its own idempotency key in `automation_runs`,
 * so a step that has already succeeded reports that instead of sending its emails twice. The three
 * automations the scheduler evaluates as a batch (editorial alert, coverage check, deadline alert)
 * run through one scheduler pass.
 */
export async function runAutomationAction(key: AutomationKey, editionId: string | null): Promise<ActionResult<RunOutcome>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("automation:manage");
    if (!AUTOMATION_KEYS.includes(key)) return fail(tr("Unknown automation"));
    const opts = { triggeredBy: "MANUAL" as const, userId: user.id };
    let outcome: RunOutcome;

    if (key === "editionCreation") {
      const defaults = await getCampaignDefaults();
      const result = await ensureNextEdition({ now: new Date(), defaults, triggeredBy: "MANUAL" });
      outcome = { ran: result.created, detail: result.created ? `${result.label} created with its sections and a scheduled campaign` : `Nothing to create — ${result.reason}` };
    } else if (key === "contributionRequest" || key === "reminder1" || key === "reminder2" || key === "gracePeriod" || key === "aiProcessing") {
      const campaign = await targetCampaign(editionId);
      if (!campaign) return fail(tr("No campaign is scheduled or open, so this automation has nothing to run on"));
      if (key === "contributionRequest") {
        const result = await openCampaign(campaign.id, opts);
        outcome = { ran: !result.skipped, detail: result.skipped ? (result.reason ?? "Already done") : `${result.invited} contributors invited · ${result.emailsSent} emails sent${result.emailsFailed ? ` · ${result.emailsFailed} failed` : ""}` };
      } else if (key === "aiProcessing") {
        const result = await closeCampaign(campaign.id, opts);
        outcome = { ran: !result.skipped, detail: result.skipped ? (result.reason ?? "Already done") : `Campaign closed with ${result.submissions} submissions${result.processingQueued ? " · AI processing queued" : ""}` };
      } else {
        const kind = key === "reminder1" ? "REMINDER_1" : key === "reminder2" ? "REMINDER_2" : "GRACE_PERIOD";
        const result = await sendReminders(campaign.id, kind, opts);
        outcome = { ran: !result.skipped, detail: result.skipped ? (result.reason ?? "Already done") : `${result.emailsSent} of ${result.targeted} reminders sent${result.emailsFailed ? ` · ${result.emailsFailed} failed` : ""}` };
      }
    } else {
      const step = key === "editorialAlert" ? "EDITORIAL_ALERT" : key === "coverageCheck" ? "COVERAGE_CHECK" : "DEADLINE_ALERT";
      const tick = await runAutomationTick({ triggeredBy: "MANUAL" });
      const mine = tick.ran.filter((line) => line.startsWith(step));
      const skipped = tick.skipped.filter((line) => line.startsWith(step));
      const errors = tick.errors.filter((line) => line.startsWith(step));
      if (errors.length) return fail(errors[0]);
      outcome = { ran: mine.length > 0, detail: mine.length ? `${mine.length} run${mine.length === 1 ? "" : "s"} executed` : skipped.length ? "Nothing was due — already done or not applicable" : "Nothing was due" };
    }

    kickJobRunner();
    await audit({ action: "automation.run_now", userId: user.id, entityType: "EDITION", entityId: editionId, editionId, metadata: { automation: key, ran: outcome.ran, detail: outcome.detail } });
    revalidate();
    return ok(outcome, outcome.ran ? outcome.detail : `Skipped — ${outcome.detail}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** One full scheduler pass: exactly what the cron endpoint does, on demand. */
export async function runSchedulerTickAction(): Promise<ActionResult<{ ran: number; skipped: number; errors: string[] }>> {
  try {
    const user = await requirePermission("automation:manage");
    const result = await runAutomationTick({ triggeredBy: "MANUAL" });
    kickJobRunner();
    await audit({ action: "automation.tick", userId: user.id, metadata: { ran: result.ran.length, skipped: result.skipped.length, errors: result.errors.length } });
    revalidate();
    if (result.errors.length) return fail(`${result.errors.length} automation${result.errors.length === 1 ? "" : "s"} failed: ${result.errors[0]}`);
    return ok(
      { ran: result.ran.length, skipped: result.skipped.length, errors: result.errors },
      result.ran.length ? `${result.ran.length} automation${result.ran.length === 1 ? "" : "s"} ran · ${result.skipped.length} skipped` : `Nothing was due · ${result.skipped.length} automation${result.skipped.length === 1 ? "" : "s"} skipped`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Puts a failed or dead-lettered job back in the queue with a clean attempt counter. */
export async function retryJobAction(jobId: string): Promise<ActionResult<{ id: string; type: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("automation:manage");
    const row = await retryJob(jobId);
    if (!row) return fail(tr("Only a failed, dead-lettered or cancelled job can be retried"));
    kickJobRunner();
    await audit({ action: "job.retry", userId: user.id, editionId: row.editionId, metadata: { jobId: row.id, type: row.type } });
    revalidate();
    return ok({ id: row.id, type: row.type }, `${row.type} queued for another attempt`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Cancels a job that has not started yet. */
export async function cancelJobAction(jobId: string): Promise<ActionResult<{ id: string; type: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("automation:manage");
    const row = await cancelJob(jobId);
    if (!row) return fail(tr("Only a queued job can be cancelled"));
    await audit({ action: "job.cancel", userId: user.id, editionId: row.editionId, metadata: { jobId: row.id, type: row.type } });
    revalidate();
    return ok({ id: row.id, type: row.type }, `${row.type} cancelled`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Drains the queue in this process and reports how many jobs actually ran. */
export async function processQueueAction(): Promise<ActionResult<{ processed: number }>> {
  try {
    const user = await requirePermission("automation:manage");
    const processed = await drainJobs(50);
    await audit({ action: "job.drain", userId: user.id, metadata: { processed } });
    revalidate();
    return ok({ processed }, processed ? `${processed} job${processed === 1 ? "" : "s"} processed` : "The queue is empty — nothing to process");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Retries every dead-lettered job at once. */
export async function retryAllDeadAction(): Promise<ActionResult<{ retried: number }>> {
  try {
    const user = await requirePermission("automation:manage");
    const dead = await db.select({ id: s.jobs.id }).from(s.jobs).where(inArray(s.jobs.status, ["DEAD", "FAILED"]));
    let retried = 0;
    for (const job of dead) if (await retryJob(job.id)) retried += 1;
    if (retried) kickJobRunner();
    await audit({ action: "job.retry_all", userId: user.id, metadata: { retried } });
    revalidate();
    return ok({ retried }, retried ? `${retried} job${retried === 1 ? "" : "s"} queued for another attempt` : "No failed or dead-lettered job to retry");
  } catch (err) {
    return toActionFailure(err);
  }
}
