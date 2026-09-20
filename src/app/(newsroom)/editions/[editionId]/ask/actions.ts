"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { setCampaignBrief } from "@/server/campaigns/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { EditionBrief } from "@/lib/campaigns/brief";
import { getUi } from "@/server/i18n/locale";

/**
 * Save what this edition is asking its contributors for.
 *
 * Its own action, because it is its own screen. The brief used to ride along with the campaign
 * form's save, which meant it could only be changed by somebody also willing to touch the dates —
 * and, worse, that the campaign form silently blanked it every time it was saved without one.
 */
export async function saveBriefAction(editionId: string, brief: EditionBrief): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    await setCampaignBrief(editionId, brief, user);
    revalidatePath(`/editions/${editionId}/ask`);
    revalidatePath(`/editions/${editionId}/campaign`);
    revalidatePath(`/editions/${editionId}`);
    return ok(null, tr("Saved"));
  } catch (err) {
    return toActionFailure(err);
  }
}
