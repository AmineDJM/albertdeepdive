"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { addFact, rejectFact, resolveConflict, settleFact, verifyFact } from "@/server/editorial/facts";
import { addComment } from "@/server/editorial/comments";
import { createInformationRequest } from "@/server/editorial/information-requests";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

function revalidateStory(storyId: string) {
  revalidatePath(`/stories/${storyId}`);
}

export async function verifyFactAction(storyId: string, factId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await verifyFact(factId, user.id);
    revalidateStory(storyId);
    return ok(null, tr("Fact verified"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function rejectFactAction(storyId: string, factId: string, reason?: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await rejectFact(factId, user.id, reason ?? null);
    revalidateStory(storyId);
    return ok(null, tr("Fact rejected"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function resolveConflictAction(storyId: string, factId: string, keepFactId: string, reason: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await resolveConflict(factId, keepFactId, reason, user.id);
    revalidateStory(storyId);
    return ok(null, tr("Conflict resolved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function addFactAction(storyId: string, statement: string, sourceSubmissionId?: string | null): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await addFact(storyId, { statement, sourceSubmissionId: sourceSubmissionId ?? null }, user.id);
    revalidateStory(storyId);
    return ok(null, tr("Fact added"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function commentOnStoryAction(storyId: string, editionId: string, body: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await addComment("STORY", storyId, body, user.id, editionId);
    revalidateStory(storyId);
    return ok(null, tr("Note added"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function requestStoryInformationAction(input: { storyId: string; contributorId: string; message: string; items: { key: string; label: string }[]; submissionId?: string | null }): Promise<ActionResult<{ url: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("submission:review");
    const result = await createInformationRequest({ storyId: input.storyId, contributorId: input.contributorId, message: input.message, items: input.items, submissionId: input.submissionId ?? null, userId: user.id });
    revalidateStory(input.storyId);
    return ok({ url: result.url }, tr("Information request sent"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function settleFactAction(storyId: string, factId: string, statement: string, reason: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await settleFact(factId, statement, reason, user.id);
    revalidateStory(storyId);
    return ok(null, tr("Conflict resolved"));
  } catch (err) {
    return toActionFailure(err);
  }
}
