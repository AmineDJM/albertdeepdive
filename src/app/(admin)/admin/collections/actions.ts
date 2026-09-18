"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requirePermission } from "@/server/auth/session";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { addToCollection, collectionSchema, createCollection, deleteCollection, removeFromCollection, reorderCollection, setItem, updateCollection } from "@/server/showcase/curation";
import { setPlatformConsent } from "@/server/showcase/consent";

/**
 * Curating the public gallery is platform work, so every action here asks for the platform
 * permission rather than a workspace role. None of them can make a customer's work public: that is
 * decided by consent, checked when the gallery reads.
 */
async function curator() {
  return requirePermission("settings:manage");
}

function refresh(id?: string) {
  revalidatePath("/admin/collections");
  if (id) revalidatePath(`/admin/collections/${id}`);
  revalidatePath("/collections");
}

export async function createCollectionAction(input: z.input<typeof collectionSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await curator();
    const row = await createCollection(input, user.id);
    refresh(row.id);
    return ok({ id: row.id }, `${row.title} created`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateCollectionAction(id: string, patch: Partial<z.input<typeof collectionSchema>>): Promise<ActionResult> {
  try {
    const user = await curator();
    await updateCollection(id, patch, user.id);
    refresh(id);
    return ok(null, "Saved");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function deleteCollectionAction(id: string): Promise<void> {
  const user = await curator();
  await deleteCollection(id, user.id);
  refresh();
  redirect("/admin/collections");
}

export async function addToCollectionAction(collectionId: string, editionIds: string[]): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await curator();
    const count = await addToCollection(collectionId, editionIds, user.id);
    refresh(collectionId);
    return ok({ count }, count === 1 ? "1 publication added" : `${count} publications added`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function removeFromCollectionAction(collectionId: string, editionIds: string[]): Promise<ActionResult> {
  try {
    const user = await curator();
    await removeFromCollection(collectionId, editionIds, user.id);
    refresh(collectionId);
    return ok(null, "Removed");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function reorderCollectionAction(collectionId: string, editionIds: string[]): Promise<ActionResult> {
  try {
    const user = await curator();
    await reorderCollection(collectionId, editionIds, user.id);
    refresh(collectionId);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setItemAction(collectionId: string, editionId: string, patch: { isFeatured?: boolean; blurb?: string | null }): Promise<ActionResult> {
  try {
    const user = await curator();
    await setItem(collectionId, editionId, patch, user.id);
    refresh(collectionId);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Record a demo workspace's consent, or a permission a customer gave elsewhere. */
export async function setPlatformConsentAction(publicationId: string, consent: "NONE" | "PLATFORM_DEMO" | "PERMISSION", note: string | null): Promise<ActionResult> {
  try {
    const user = await curator();
    await setPlatformConsent(publicationId, consent, note, user.id);
    refresh();
    return ok(null, consent === "NONE" ? "Consent withdrawn" : "Consent recorded");
  } catch (err) {
    return toActionFailure(err);
  }
}
