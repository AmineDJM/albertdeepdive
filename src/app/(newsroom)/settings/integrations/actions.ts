"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { clearIntegration, saveIntegration, testIntegration, type IntegrationTestResult } from "@/server/integrations/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

/**
 * Connecting a service is a platform act, not a workspace one: one Stripe account bills every
 * customer, one Brevo account sends for all of them. `settings:manage` is held only by a platform
 * super admin, which is exactly the right gate.
 */

export async function saveIntegrationAction(key: string, values: Record<string, string>): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await saveIntegration(key, values, user.id);
    revalidatePath("/settings/integrations");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function testIntegrationAction(key: string): Promise<ActionResult<IntegrationTestResult>> {
  try {
    await requirePermission("settings:manage");
    return ok(await testIntegration(key));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function clearIntegrationAction(key: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await clearIntegration(key, user.id);
    revalidatePath("/settings/integrations");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
