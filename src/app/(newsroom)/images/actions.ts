"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { getVersion, rejectVersion, requestEdit, requestImage, setCurrentVersion, type AdvancedInput } from "@/server/images/service";
import type { ReferenceRole } from "@/lib/images/types";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

/**
 * Pictures, from the interface.
 *
 * Asking for one or changing one sits behind the media permission, spends the workspace's credits
 * and is always a new version — the file a person started from is never touched. What the engine
 * refuses comes back as a sentence, never as a provider's error.
 */

type Reference = { role: ReferenceRole; mediaId: string };

function revalidate(input: { editionId?: string | null; mediaIds?: (string | null | undefined)[] }) {
  if (input.editionId) revalidatePath(`/editions/${input.editionId}/media`);
  revalidatePath("/media");
  for (const id of input.mediaIds ?? []) if (id) revalidatePath(`/media/${id}`);
}

export async function generateImageAction(input: { editionId: string | null; instruction: string; references?: Reference[]; advanced?: AdvancedInput; size?: "square" | "landscape" | "portrait" | "story" }): Promise<ActionResult<{ id: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    const tenant = await requireTenant();
    const row = await requestImage({ organizationId: tenant.organizationId, editionId: input.editionId, instruction: input.instruction, references: input.references ?? [], advanced: input.advanced, size: input.size, actorId: user.id });
    revalidate({ editionId: input.editionId });
    return ok({ id: row.id }, tr("Picture queued. This page updates as it is made."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function editImageAction(input: { mediaId?: string | null; versionId?: string | null; instruction: string; references?: Reference[]; advanced?: AdvancedInput }): Promise<ActionResult<{ id: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    const tenant = await requireTenant();
    const row = await requestEdit({ organizationId: tenant.organizationId, mediaId: input.mediaId ?? null, versionId: input.versionId ?? null, instruction: input.instruction, references: input.references ?? [], advanced: input.advanced, actorId: user.id });
    revalidate({ editionId: row.editionId, mediaIds: [input.mediaId] });
    return ok({ id: row.id }, tr("Edit queued. The new version appears here when it is ready."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function restoreVersionAction(versionId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await requireTenant();
    const row = await setCurrentVersion(versionId, user.id);
    revalidate({ editionId: row.editionId, mediaIds: [row.mediaId] });
    return ok(null, tr("This version is now the current one."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function rejectVersionAction(versionId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await requireTenant();
    const before = await getVersion(versionId);
    const row = await rejectVersion(versionId, user.id);
    revalidate({ editionId: row.editionId, mediaIds: [before.mediaId, before.parentId ? (await getVersion(before.parentId)).mediaId : null] });
    return ok(null, tr("Version thrown out. It stays in the history, greyed."));
  } catch (err) {
    return toActionFailure(err);
  }
}
