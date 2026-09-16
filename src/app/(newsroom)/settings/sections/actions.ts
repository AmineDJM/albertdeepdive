"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { resetDefaultSections, saveSetting } from "@/server/settings/service";
import type { DefaultSectionInput } from "@/server/settings/schemas";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

export async function saveDefaultSectionsAction(sections: DefaultSectionInput[]): Promise<ActionResult> {
  try {
    const user = await requirePermission("section:manage");
    const saved = await saveSetting<DefaultSectionInput[]>("default_sections", sections, user.id);
    revalidatePath("/settings/sections");
    return ok(null, `Section template saved · ${saved.length} sections`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function resetDefaultSectionsAction(): Promise<ActionResult> {
  try {
    const user = await requirePermission("section:manage");
    await resetDefaultSections(user.id);
    revalidatePath("/settings/sections");
    return ok(null, "Section template reset to the shipped defaults");
  } catch (err) {
    return toActionFailure(err);
  }
}
