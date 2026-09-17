"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/auth/session";
import { assignPlan, planPatchSchema, setDefaultPlan, updatePlan } from "@/server/billing/plans";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

/**
 * Platform administration.
 *
 * Every action here crosses workspace boundaries, so every one of them is gated on `settings:manage`
 * — which only a platform super admin holds. Nothing in this file is reachable by a customer, however
 * senior they are inside their own workspace.
 */

export async function updatePlanAction(planId: string, patch: z.input<typeof planPatchSchema>): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await updatePlan(planId, patch, user.id);
    revalidatePath("/settings/platform");
    revalidatePath("/settings/billing");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setDefaultPlanAction(planId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await setDefaultPlan(planId, user.id);
    revalidatePath("/settings/platform");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function assignPlanAction(organizationId: string, planId: string | null): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await assignPlan(organizationId, planId, {}, user.id);
    revalidatePath("/settings/platform");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
