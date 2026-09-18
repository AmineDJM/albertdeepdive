"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { saveSetting } from "@/server/settings/service";
import { exportContributorData } from "@/server/settings/privacy";
import type { PrivacySettings } from "@/server/settings/schemas";
import { CONSENT_TEXT_VERSION } from "@/lib/constants";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

export async function saveRetentionAction(retentionDays: number): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await saveSetting<PrivacySettings>("privacy", { retentionDays, consentTextVersion: CONSENT_TEXT_VERSION }, user.id);
    revalidatePath("/settings/privacy");
    return ok(null, `Retention set to ${retentionDays} days`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Returns the contributor's data as a JSON string (the browser turns it into a download). */
export async function exportContributorDataAction(email: string): Promise<ActionResult<{ fileName: string; json: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    const result = await exportContributorData(String(email ?? "").slice(0, 200), user.id);
    return ok({ fileName: result.fileName, json: result.json }, tr("Export ready"));
  } catch (err) {
    return toActionFailure(err);
  }
}
