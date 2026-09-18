"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { createUser, resetUserPassword, updateUser, userInputSchema, userPatchSchema } from "@/server/settings/users";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { z } from "zod";
import { getUi } from "@/server/i18n/locale";

export async function createUserAction(input: z.input<typeof userInputSchema>): Promise<ActionResult<{ id: string; temporaryPassword: string; email: string }>> {
  try {
    const actor = await requirePermission("user:manage");
    const { user, temporaryPassword } = await createUser(input, actor.id);
    revalidatePath("/settings/users");
    return ok({ id: user.id, temporaryPassword, email: user.email }, `${user.name} invited`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateUserAction(id: string, patch: z.input<typeof userPatchSchema>): Promise<ActionResult> {
  try {
    const actor = await requirePermission("user:manage");
    const row = await updateUser(id, patch, actor.id);
    revalidatePath("/settings/users");
    return ok(null, patch.isActive === false ? `${row.name} deactivated and signed out` : patch.isActive === true ? `${row.name} reactivated` : `${row.name} updated`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function resetPasswordAction(id: string): Promise<ActionResult<{ temporaryPassword: string }>> {
  const tr = await getUi();
  try {
    const actor = await requirePermission("user:manage");
    const result = await resetUserPassword(id, actor.id);
    revalidatePath("/settings/users");
    return ok(result, tr("Temporary password generated · all sessions signed out"));
  } catch (err) {
    return toActionFailure(err);
  }
}
