"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { askForMore, buildDraft, mergeTopics } from "@/server/editorial/topics";
import { assignSection, rejectStory, selectStory, undecideStory, updateStory } from "@/server/editorial/stories";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { importDocumentAsTopics } from "@/server/editorial/document-import";
import { getUi } from "@/server/i18n/locale";

const refresh = (editionId: string) => {
  revalidatePath(`/editions/${editionId}/topics`);
  revalidatePath(`/editions/${editionId}/stories`);
  revalidatePath(`/editions/${editionId}`);
};

/** Keep it: this topic is going in the issue. */
export async function keepTopicAction(editionId: string, storyId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("story:edit");
    await selectStory(storyId, user.id);
    refresh(editionId);
    return ok(null, "Kept");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Leave it: not this month. The contribution is kept and the contributor is not told off. */
export async function leaveTopicAction(editionId: string, storyId: string, reason?: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("story:edit");
    await rejectStory(storyId, user.id, reason ?? null);
    refresh(editionId);
    return ok(null, "Left out");
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Ask the contributor behind a topic for a little more.
 *
 * Needs `campaign:manage` rather than `story:edit`: deciding about a topic is an editor's job,
 * writing to the person who sent it in is the campaign's.
 */
export async function askForMoreAction(editionId: string, storyId: string, message: string): Promise<ActionResult<{ asked: boolean }>> {
  try {
    const user = await requirePermission("campaign:manage");
    const result = await askForMore(editionId, storyId, message, user.id);
    refresh(editionId);
    if (result.alreadyWaiting) return ok({ asked: false }, "Already waiting on an answer for this one");
    if (!result.contributor) return ok({ asked: false }, "This topic did not come from anybody there is a way to write to");
    return ok({ asked: true }, `Asked ${result.contributor.name}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Put it back on the undecided pile. */
export async function undecideTopicAction(editionId: string, storyId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("story:edit");
    await undecideStory(storyId, user.id);
    refresh(editionId);
    return ok(null, "Back on the list");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function renameTopicAction(editionId: string, storyId: string, title: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("story:edit");
    await updateStory(storyId, { title }, user.id);
    refresh(editionId);
    return ok(null, "Renamed");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function moveTopicAction(editionId: string, storyId: string, sectionId: string | null): Promise<ActionResult> {
  try {
    const user = await requirePermission("story:edit");
    await assignSection(storyId, sectionId, user.id);
    refresh(editionId);
    return ok(null, "Moved");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Two topics that turn out to be the same story. */
export async function mergeTopicsAction(editionId: string, keepId: string, mergeIds: string[]): Promise<ActionResult<{ merged: number }>> {
  try {
    const user = await requirePermission("story:edit");
    const result = await mergeTopics(editionId, keepId, mergeIds, user.id);
    refresh(editionId);
    return ok(result, result.merged ? `${result.merged} merged in` : "Nothing to merge");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** The button at the end of the step: write the issue from the topics that were kept. */
export async function buildDraftAction(editionId: string): Promise<ActionResult<{ queued: number; alreadyWritten: number }>> {
  try {
    const user = await requirePermission("ai:run");
    const result = await buildDraft(editionId, user.id);
    refresh(editionId);
    return ok(
      result,
      result.queued ? `Writing ${result.queued} article(s)` : result.alreadyWritten ? "Everything kept is already written" : "Nothing kept yet",
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

/** A document of content, read and turned into topics in the background. */
export async function importTopicsDocumentAction(editionId: string, form: FormData): Promise<ActionResult<{ sections: number }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, error: tr("Choose a file first") };
    if (file.size > 20 * 1024 * 1024) return { ok: false, error: tr("That file is over 20 MB") };
    const result = await importDocumentAsTopics({ editionId, bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type || null, user: { id: user.id, name: user.name, email: user.email } });
    refresh(editionId);
    return ok({ sections: result.sections }, result.sections === 1 ? tr("Briefly is reading 1 part of your document") : tr("Briefly is reading {count} parts of your document", { count: result.sections }));
  } catch (err) {
    return toActionFailure(err);
  }
}
