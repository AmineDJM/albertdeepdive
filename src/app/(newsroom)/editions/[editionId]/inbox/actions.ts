"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { bulkReviewSubmissions, processSubmission, reviewSubmission, type ReviewStatus } from "@/server/editorial/submissions";
import { clusterEdition, moveSubmission } from "@/server/editorial/clustering";
import { createInformationRequest } from "@/server/editorial/information-requests";
import { addComment } from "@/server/editorial/comments";
import { processEdition } from "@/server/ai/pipeline";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobRunner } from "@/server/jobs/runner";
import { JOB_TYPES } from "@/server/jobs/registry";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

function revalidateEdition(editionId: string) {
  revalidatePath(`/editions/${editionId}/inbox`);
  revalidatePath(`/editions/${editionId}/stories`);
  revalidatePath(`/editions/${editionId}`);
}

export async function reviewSubmissionAction(editionId: string, submissionId: string, status: ReviewStatus, note?: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("submission:review");
    await reviewSubmission(submissionId, { status, note: note ?? null, userId: user.id });
    revalidateEdition(editionId);
    return ok(null, `Marked as ${status.toLowerCase().replace(/_/g, " ")}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function bulkReviewAction(editionId: string, submissionIds: string[], status: ReviewStatus, note?: string): Promise<ActionResult<{ updated: number }>> {
  try {
    const user = await requirePermission("submission:review");
    const result = await bulkReviewSubmissions(submissionIds, { status, note: note ?? null, userId: user.id });
    revalidateEdition(editionId);
    return ok({ updated: result.updated }, `${result.updated} submission${result.updated === 1 ? "" : "s"} updated`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function reprocessSubmissionAction(editionId: string, submissionId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    await requirePermission("ai:run");
    await processSubmission(submissionId, { force: true });
    revalidateEdition(editionId);
    return ok(null, tr("Submission reprocessed"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Runs the whole AI pipeline for the edition in the background and returns immediately. */
export async function runProcessingAction(editionId: string): Promise<ActionResult<{ jobId: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("ai:run");
    const job = await enqueueJob({ type: JOB_TYPES.EDITION_PROCESS, payload: { editionId }, editionId, createdById: user.id, idempotencyKey: `edition-process:${editionId}:${Date.now()}` });
    kickJobRunner();
    revalidateEdition(editionId);
    return ok({ jobId: job.id }, tr("AI processing started"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Synchronous variant used when the editor wants to wait for the result (small editions, tests). */
export async function runProcessingNowAction(editionId: string): Promise<ActionResult<{ clusters: number; stories: number }>> {
  try {
    const user = await requirePermission("ai:run");
    const summary = await processEdition(editionId, { triggeredBy: "MANUAL", userId: user.id });
    const clusters = summary.clustering?.groups ?? 0;
    revalidateEdition(editionId);
    return ok({ clusters, stories: summary.storiesCreated }, `${summary.submissionsProcessed} processed · ${clusters} clusters · ${summary.storiesCreated} stories`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function reclusterAction(editionId: string): Promise<ActionResult<{ created: number; groups: number }>> {
  try {
    await requirePermission("ai:run");
    const result = await clusterEdition(editionId);
    revalidateEdition(editionId);
    return ok({ created: result.created.length, groups: result.groups }, `${result.created.length} new clusters`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function moveSubmissionAction(editionId: string, submissionId: string, clusterId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await moveSubmission(submissionId, clusterId, user.id);
    revalidateEdition(editionId);
    return ok(null, tr("Submission moved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function requestInformationAction(
  editionId: string,
  input: { submissionId?: string | null; storyId: string; contributorId: string; message: string; items: { key: string; label: string }[] },
): Promise<ActionResult<{ url: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("submission:review");
    const result = await createInformationRequest({ submissionId: input.submissionId ?? null, storyId: input.storyId, contributorId: input.contributorId, message: input.message, items: input.items, userId: user.id });
    revalidateEdition(editionId);
    return ok({ url: result.url }, tr("Information request sent"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function commentOnSubmissionAction(editionId: string, submissionId: string, body: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("submission:review");
    await addComment("SUBMISSION", submissionId, body, user.id, editionId);
    revalidateEdition(editionId);
    return ok(null, tr("Comment added"));
  } catch (err) {
    return toActionFailure(err);
  }
}
