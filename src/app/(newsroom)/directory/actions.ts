"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { audienceInputSchema, createRecipient, deleteRecipient, setRecipientActive, updateRecipient } from "@/server/audience/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { z } from "zod";

export async function createRecipientAction(input: z.input<typeof audienceInputSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("contributor:manage");
    const row = await createRecipient(input, user.id);
    revalidatePath("/directory");
    return ok({ id: row.id }, `${row.firstName} ${row.lastName}`.trim() + " added");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateRecipientAction(id: string, patch: Partial<z.input<typeof audienceInputSchema>>): Promise<ActionResult> {
  try {
    const user = await requirePermission("contributor:manage");
    await updateRecipient(id, patch, user.id);
    revalidatePath("/directory");
    return ok(null, "Recipient updated");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setRecipientActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("contributor:manage");
    await setRecipientActive(id, isActive, user.id);
    revalidatePath("/directory");
    return ok(null, isActive ? "Recipient activated" : "Recipient deactivated");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function deleteRecipientAction(id: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("contributor:manage");
    await deleteRecipient(id, user.id);
    revalidatePath("/directory");
    return ok(null, "Recipient removed");
  } catch (err) {
    return toActionFailure(err);
  }
}
