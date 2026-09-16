"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { saveSetting } from "@/server/settings/service";
import { SETTING_KEYS, type SettingKey } from "@/server/settings/schemas";
import { fail, ok, toActionFailure, type ActionResult } from "@/lib/action-result";

const LABELS: Record<SettingKey, string> = {
  masthead: "Masthead",
  contact: "Contact details",
  campaign_defaults: "Campaign schedule",
  default_sections: "Section template",
  print: "Print defaults",
  privacy: "Privacy settings",
  ai: "AI settings",
  automations: "Automation toggles",
};

export async function saveSettingAction(key: SettingKey, value: unknown): Promise<ActionResult> {
  try {
    if (!SETTING_KEYS.includes(key)) return fail("Unknown setting");
    const user = await requirePermission("settings:manage");
    await saveSetting(key, value, user.id);
    revalidatePath("/settings/system");
    revalidatePath("/automations");
    return ok(null, `${LABELS[key]} saved`);
  } catch (err) {
    return toActionFailure(err);
  }
}
