"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { createEdition, deleteEditions, setEditionsHidden, transitionEdition, updateEdition, saveEditionSections, createEditionSchema, updateEditionSchema, sectionInputSchema } from "@/server/editions/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import type { z } from "zod";
import { getUi } from "@/server/i18n/locale";

export async function createEditionAction(input: z.input<typeof createEditionSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("edition:create");
    const edition = await createEdition(input, user.id);
    revalidatePath("/editions");
    return ok({ id: edition.id }, `${edition.label} created`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateEditionAction(editionId: string, patch: z.input<typeof updateEditionSchema>): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("edition:edit");
    await updateEdition(editionId, patch, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null, tr("Edition updated"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function transitionEditionAction(editionId: string, to: EditionStatus, reason?: string): Promise<ActionResult> {
  try {
    const needed = to === "PUBLISHED" ? "edition:publish" : to === "ARCHIVED" ? "edition:archive" : "edition:edit";
    const user = await requirePermission(needed);
    await transitionEdition(editionId, to, user.id, reason);
    revalidatePath(`/editions/${editionId}`);
    revalidatePath("/overview");
    return ok(null, `Edition moved to ${to.toLowerCase().replace(/_/g, " ")}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function saveSectionsAction(editionId: string, sections: z.input<typeof sectionInputSchema>[]): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("section:manage");
    await saveEditionSections(editionId, sections, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null, tr("Sections saved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export async function setEditionsHiddenAction(ids: string[], hidden: boolean): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requirePermission("edition:edit");
    const count = await setEditionsHidden(ids, hidden, user.id);
    revalidatePath("/editions");
    revalidatePath("/overview");
    return ok({ count }, hidden ? `${plural(count, "edition")} hidden` : `${plural(count, "edition")} shown again`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Deleting is at least as final as archiving, so it takes the same right. */
export async function deleteEditionsAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requirePermission("edition:archive");
    const count = await deleteEditions(ids, user.id);
    revalidatePath("/editions");
    revalidatePath("/overview");
    return ok({ count }, `${plural(count, "edition")} deleted`);
  } catch (err) {
    return toActionFailure(err);
  }
}
