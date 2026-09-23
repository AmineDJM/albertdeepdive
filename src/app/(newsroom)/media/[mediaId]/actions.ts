"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import {
  archiveMedia,
  attachToStory,
  deleteMedia,
  clearCrop,
  clearDuplicate,
  detachFromStory,
  markDuplicate,
  recordImageConsent,
  restoreMedia,
  setCrop,
  setRightsStatus,
  setStoryMediaRole,
  updateMediaMetadata,
  type CropInput,
  type MediaMetadataPatch,
} from "@/server/media/rights";
import { describeMedia } from "@/server/media/describe";
import { recheckDuplicates } from "@/server/media/jobs";
import type { RightsStatus, StoryMediaRole } from "@/server/media/constants";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { CONSENT_TEXT_VERSION, RIGHTS_STATUS_LABELS } from "@/lib/constants";
import { getUi } from "@/server/i18n/locale";

function revalidate(assetId: string, editionId: string | null, extra: string[] = []) {
  revalidatePath(`/media/${assetId}`);
  if (editionId) revalidatePath(`/editions/${editionId}/media`);
  for (const p of extra) revalidatePath(p);
}

export async function updateMetadataAction(
  assetId: string,
  editionId: string | null,
  patch: MediaMetadataPatch,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await updateMediaMetadata(assetId, patch, user);
    revalidate(assetId, editionId);
    return ok(null, tr("Metadata saved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setRightsAction(
  assetId: string,
  editionId: string | null,
  status: RightsStatus,
  note: string | null | undefined,
): Promise<ActionResult> {
  try {
    const user = await requirePermission("media:rights");
    await setRightsStatus(assetId, status, note, user);
    revalidate(assetId, editionId);
    return ok(null, `Rights set to ${RIGHTS_STATUS_LABELS[status]}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function recordConsentAction(
  assetId: string,
  editionId: string | null,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:rights");
    await recordImageConsent(
      assetId,
      { accepted: true, textVersion: CONSENT_TEXT_VERSION, userAgent: "newsroom" },
      user.id,
    );
    revalidate(assetId, editionId);
    return ok(null, tr("Image-rights consent recorded"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function archiveAction(
  assetId: string,
  editionId: string | null,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await archiveMedia(assetId, user);
    revalidate(assetId, editionId);
    return ok(null, tr("Asset archived"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Deletes the picture for good; the caller leaves the page, which no longer exists. */
export async function deleteAction(assetId: string, editionId: string | null): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await deleteMedia(assetId, user);
    revalidate(assetId, editionId, ["/library"]);
    return ok(null, tr("Picture deleted"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function restoreAction(
  assetId: string,
  editionId: string | null,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await restoreMedia(assetId, user);
    revalidate(assetId, editionId);
    return ok(null, tr("Asset restored"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function markDuplicateAction(
  assetId: string,
  editionId: string | null,
  duplicateOfId: string,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await markDuplicate(assetId, duplicateOfId, user);
    revalidate(assetId, editionId, [`/media/${duplicateOfId}`]);
    return ok(null, tr("Marked as duplicate"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function clearDuplicateAction(
  assetId: string,
  editionId: string | null,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await clearDuplicate(assetId, user);
    revalidate(assetId, editionId);
    return ok(null, tr("Duplicate flag cleared"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function recheckDuplicatesAction(
  assetId: string,
  editionId: string | null,
): Promise<ActionResult<{ duplicateOfId: string | null }>> {
  try {
    await requirePermission("media:manage");
    const result = await recheckDuplicates(assetId);
    revalidate(assetId, editionId);
    return ok(
      { duplicateOfId: result.duplicateOfId },
      result.respectedManualDecision
        ? "Kept your manual decision"
        : result.duplicateOfId
          ? "Duplicate found"
          : "No duplicate found",
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function attachToStoryAction(
  assetId: string,
  editionId: string | null,
  storyId: string,
  role: StoryMediaRole,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await attachToStory(assetId, storyId, role, user);
    revalidate(assetId, editionId, [`/stories/${storyId}`]);
    return ok(null, tr("Attached to the story"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function detachFromStoryAction(
  assetId: string,
  editionId: string | null,
  storyId: string,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await detachFromStory(assetId, storyId, user);
    revalidate(assetId, editionId, [`/stories/${storyId}`]);
    return ok(null, tr("Detached from the story"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setStoryRoleAction(
  assetId: string,
  editionId: string | null,
  storyId: string,
  role: StoryMediaRole,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await setStoryMediaRole(assetId, storyId, role, user);
    revalidate(assetId, editionId, [`/stories/${storyId}`]);
    return ok(null, tr("Role updated"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setCropAction(
  assetId: string,
  editionId: string | null,
  crop: CropInput,
): Promise<ActionResult<{ url: string }>> {
  try {
    const user = await requirePermission("media:manage");
    const result = await setCrop(assetId, crop, user);
    revalidate(assetId, editionId);
    return ok(
      { url: result.url },
      `${crop.name} crop generated (${result.variant.width}×${result.variant.height})`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function clearCropAction(
  assetId: string,
  editionId: string | null,
): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("media:manage");
    await clearCrop(assetId, user);
    revalidate(assetId, editionId);
    return ok(null, tr("Crop removed"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function describeAction(
  assetId: string,
  editionId: string | null,
): Promise<ActionResult<{ description: string; tags: string[] }>> {
  try {
    await requirePermission("media:manage");
    const result = await describeMedia(assetId, { force: true });
    revalidate(assetId, editionId);
    return ok(
      { description: result.description, tags: result.tags },
      result.cached ? "Description restored from cache" : `Described with ${result.model}`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}
