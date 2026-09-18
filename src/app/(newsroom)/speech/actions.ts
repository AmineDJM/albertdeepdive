"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireUser } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { createNarration, deleteNarration, getNarration, narrationUrl, regeneratePassages, setNarrationPublished, type CreateNarrationInput } from "@/server/speech/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi, currentLocale } from "@/server/i18n/locale";

/**
 * Narration, from the interface.
 *
 * Making one is an editorial act — it spends the workspace's minutes and speaks in its name — so it
 * sits behind the same permission as exporting an edition. Everything the service refuses comes
 * back as a sentence for the toast, never as a stack trace.
 */

function revalidate(narration: { editionId: string | null; packId: string | null }) {
  if (narration.editionId) {
    revalidatePath(`/editions/${narration.editionId}/audio`);
    revalidatePath(`/editions/${narration.editionId}`);
  }
  if (narration.packId) revalidatePath(`/studio/${narration.packId}`);
}

export async function createNarrationAction(input: Omit<CreateNarrationInput, "organizationId" | "actorId" | "locale">): Promise<ActionResult<{ id: string; title: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("export:run");
    const tenant = await requireTenant();
    const locale = await currentLocale();
    const row = await createNarration({ ...input, organizationId: tenant.organizationId, actorId: user.id, locale });
    revalidate(row);
    return ok({ id: row.id, title: row.title }, tr("Narration queued. This page updates as it is made."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function regeneratePassageAction(narrationId: string, index: number): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("export:run");
    const row = await regeneratePassages(narrationId, [index], user.id);
    revalidate(row);
    return ok(null, tr("Passage queued. The narration is stitched again once it is done."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function publishNarrationAction(narrationId: string, published: boolean): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("edition:publish");
    const row = await setNarrationPublished(narrationId, published, user.id);
    revalidate(row);
    return ok(null, published ? tr("Readers can listen to it now.") : tr("Taken off the reader page."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function deleteNarrationAction(narrationId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("export:run");
    const row = await getNarration(narrationId);
    await deleteNarration(narrationId, user.id);
    revalidate(row);
    return ok(null, tr("Narration deleted"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function narrationDownloadAction(narrationId: string, take?: number): Promise<ActionResult<{ url: string; fileName: string }>> {
  try {
    await requireUser();
    const link = await narrationUrl(narrationId, { download: true, take });
    if (!link) return { ok: false, error: "This narration has no file yet." };
    return ok(link);
  } catch (err) {
    return toActionFailure(err);
  }
}
