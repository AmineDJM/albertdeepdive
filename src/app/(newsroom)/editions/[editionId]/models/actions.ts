"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { adoptModel } from "@/server/design/models/service";
import { getUi } from "@/server/i18n/locale";

/**
 * Make a title on one of the models.
 *
 * `layout:edit` rather than `settings:manage`: choosing what the newsletter looks like is the
 * editor in chief's job, and gating it behind workspace administration put it out of reach of the
 * one person who is actually paid to have an opinion about it.
 */
export async function adoptModelAction(publicationId: string, modelId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("layout:edit");
    await adoptModel(publicationId, modelId, user.id);
    revalidatePath("/publications");
    revalidatePath("/overview");
    return ok(null, tr("Your newsletter will be made on this from now on"));
  } catch (err) {
    return toActionFailure(err);
  }
}
