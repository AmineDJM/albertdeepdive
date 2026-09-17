"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { simulateSubmissions } from "@/server/dev/simulate";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

function revalidateEdition(editionId: string) {
  revalidatePath(`/editions/${editionId}`);
  revalidatePath(`/editions/${editionId}/inbox`);
  revalidatePath(`/editions/${editionId}/stories`);
  revalidatePath(`/editions/${editionId}/campaign`);
}

/**
 * Super-admin only. Injects fake contribution-form submissions into the edition so the newsroom
 * can be demoed end to end. Gated on `settings:manage`, a permission only SUPER_ADMIN holds.
 */
export async function simulateReturnsAction(editionId: string, input: { count?: number; attachPhotos?: boolean } = {}): Promise<ActionResult<{ created: number; withPhotos: number }>> {
  try {
    const user = await requirePermission("settings:manage");
    const result = await simulateSubmissions(editionId, { count: input.count, attachPhotos: input.attachPhotos, userId: user.id });
    revalidateEdition(editionId);
    return ok(
      { created: result.created, withPhotos: result.withPhotos },
      `${result.created} fake submission${result.created === 1 ? "" : "s"} added${result.withPhotos ? ` · ${result.withPhotos} with a photo` : ""}. Run the pipeline to see the issue take shape.`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}
