"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { disableOutput, enableOutput, updateOutputConfig, type OutputFormat } from "@/server/outputs/service";
import type { OutputConfig } from "@/server/db/schema/outputs";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

export async function toggleOutputAction(editionId: string, format: OutputFormat, enabled: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:edit");
    if (enabled) await enableOutput(editionId, format, user.id);
    else await disableOutput(editionId, format, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateOutputConfigAction(editionId: string, format: OutputFormat, patch: OutputConfig): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:edit");
    await updateOutputConfig(editionId, format, patch, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
