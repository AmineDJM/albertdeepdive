"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { converse, studioState, type StudioReply } from "@/server/editorial/edition-studio/converse";
import {
  applyRevision,
  discardDraft,
  removeChange,
  revisionState,
  undoRevision,
  type RevisionState,
  type RevisionView,
} from "@/server/editorial/edition-studio/revisions";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

function revalidateEdition(editionId: string) {
  revalidatePath(`/editions/${editionId}/revise`);
  revalidatePath(`/editions/${editionId}/layout`);
  revalidatePath(`/editions/${editionId}`);
}

/** Says something to the issue. Fills the list; changes nothing on the paper. */
export async function studioSayAction(editionId: string, message: string, mediaAssetIds: string[] = []): Promise<ActionResult<StudioReply>> {
  try {
    const user = await requirePermission("layout:edit");
    const reply = await converse(editionId, { message, mediaAssetIds }, user.id);
    return ok(reply);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function studioStateAction(editionId: string): Promise<ActionResult<StudioReply>> {
  try {
    await requirePermission("layout:edit");
    return ok(await studioState(editionId));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Takes one line out of the list, before it has cost anything. */
export async function removeChangeAction(editionId: string, changeId: string): Promise<ActionResult<RevisionView>> {
  try {
    const user = await requirePermission("layout:edit");
    const tr = await getUi();
    return ok(await removeChange(editionId, changeId, user.id), tr("Taken off the list"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function discardDraftAction(editionId: string): Promise<ActionResult<RevisionView>> {
  try {
    const user = await requirePermission("layout:edit");
    const tr = await getUi();
    return ok(await discardDraft(editionId, user.id), tr("The list is empty again"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Spends one revision.
 *
 * The allowance is enforced in the service, not here: hiding the button is a courtesy, and a
 * request that arrives without one is refused on the server whatever the interface showed.
 */
export async function applyRevisionAction(editionId: string): Promise<ActionResult<{ revision: RevisionView; revisions: RevisionState }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await applyRevision(editionId, user.id);
    revalidateEdition(editionId);
    const tr = await getUi();
    const done = result.revision.outcomes.filter((o) => o.ok).length;
    const failed = result.revision.outcomes.length - done;
    return ok(
      { revision: result.revision, revisions: await revisionState(editionId) },
      failed
        ? tr("Revision {n}: {done} change(s) made, {failed} could not be", { n: result.revision.number ?? 1, done, failed })
        : tr("Revision {n}: {done} change(s) made", { n: result.revision.number ?? 1, done }),
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Puts the issue back to before a revision ran. The revision stays spent — the work was done. */
export async function undoRevisionAction(editionId: string, revisionId: string): Promise<ActionResult<RevisionState>> {
  try {
    const user = await requirePermission("layout:edit");
    await undoRevision(editionId, revisionId, user.id);
    revalidateEdition(editionId);
    const tr = await getUi();
    return ok(await revisionState(editionId), tr("Put back the way it was"));
  } catch (err) {
    return toActionFailure(err);
  }
}
