"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { requireOrganizationRole } from "@/server/tenancy/context";
import { openBillingPortal, setCancelAtPeriodEnd, startCheckout } from "@/server/billing/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

/** Only an owner or admin may spend the workspace's money. */
export async function startCheckoutAction(planKey: string, interval: "month" | "year"): Promise<ActionResult<{ url: string }>> {
  try {
    const user = await requireUser();
    const tenant = await requireOrganizationRole("ADMIN");
    const url = await startCheckout({ organizationId: tenant.organizationId, planKey, interval, userEmail: user.email });
    return ok({ url });
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function openPortalAction(): Promise<ActionResult<{ url: string }>> {
  try {
    const tenant = await requireOrganizationRole("ADMIN");
    return ok({ url: await openBillingPortal(tenant.organizationId) });
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setCancelAction(cancel: boolean): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const tenant = await requireOrganizationRole("OWNER");
    await setCancelAtPeriodEnd(tenant.organizationId, cancel, user.id);
    revalidatePath("/settings/billing");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
