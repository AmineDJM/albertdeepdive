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
    revalidatePath("/admin/plans");
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
    revalidatePath("/admin/plans");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function assignPlanAction(organizationId: string, planId: string | null): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await assignPlan(organizationId, planId, {}, user.id);
    revalidatePath("/admin/plans");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * One switch on one plan.
 *
 * A feature flag is an entitlement the product already gates on, so flipping it here is a plan
 * edit that keeps everything else the plan says. The audit trail is the plan's.
 */
export async function setPlanFlagAction(planId: string, key: string, enabled: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    const { db } = await import("@/server/db/client");
    const { plans } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
    if (!plan) return { ok: false, error: "Plan not found" };
    await updatePlan(planId, { entitlements: { ...(plan.entitlements as Record<string, unknown>), [key]: enabled } }, user.id);
    revalidatePath("/admin/flags");
    revalidatePath("/admin/plans");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
