"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { clearIntegration, saveIntegration, testIntegration, type IntegrationTestResult } from "@/server/integrations/service";
import { runSetup, type SetupResult } from "@/server/integrations/setup";
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
    revalidatePath("/admin/providers");
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

/**
 * Finish the job, rather than leaving a half-connected service.
 *
 * Revalidates because setup writes back into the integration's own fields — Stripe's webhook secret,
 * Brevo's from address, OpenAI's chosen models — and the card must show what it now holds.
 */
export async function setUpIntegrationAction(key: string): Promise<ActionResult<SetupResult>> {
  try {
    const user = await requirePermission("settings:manage");
    const result = await runSetup(key, user.id);
    revalidatePath("/admin/providers");
    revalidatePath("/admin");
    return ok(result);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function clearIntegrationAction(key: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await clearIntegration(key, user.id);
    revalidatePath("/admin/providers");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
