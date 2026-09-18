"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { campusInputSchema, createCampus, updateCampus } from "@/server/contributors/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { z } from "zod";
import { getUi } from "@/server/i18n/locale";

export async function createCampusAction(input: z.input<typeof campusInputSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("campus:manage");
    const row = await createCampus(input, user.id);
    revalidatePath("/campuses");
    return ok({ id: row.id }, `${row.name} added`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateCampusAction(id: string, patch: Partial<z.input<typeof campusInputSchema>> & { sortOrder?: number }): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campus:manage");
    await updateCampus(id, patch, user.id);
    revalidatePath("/campuses");
    return ok(null, tr("Campus updated"));
  } catch (err) {
    return toActionFailure(err);
  }
}
