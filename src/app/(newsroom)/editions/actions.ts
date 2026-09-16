"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { createEdition, transitionEdition, updateEdition, saveEditionSections, createEditionSchema, updateEditionSchema, sectionInputSchema } from "@/server/editions/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import type { z } from "zod";

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
  try {
    const user = await requirePermission("edition:edit");
    await updateEdition(editionId, patch, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null, "Edition updated");
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
  try {
    const user = await requirePermission("section:manage");
    await saveEditionSections(editionId, sections, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null, "Sections saved");
  } catch (err) {
    return toActionFailure(err);
  }
}
