"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { stopViewAs } from "@/server/auth/view-as";
import { audit } from "@/server/audit";
import { clearActiveOrganization, getTenant, homeFor, setActiveOrganization } from "@/server/tenancy/context";
import { toActionFailure, ok, type ActionResult } from "@/lib/action-result";

/** Switch the workspace in scope. Membership is re-checked server-side before the cookie is set. */
export async function switchWorkspaceAction(organizationId: string): Promise<ActionResult> {
  try {
    await setActiveOrganization(organizationId);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Step out of the workspace in scope.
 *
 * The way platform staff leave a customer's newsroom: the workspace cookie and any "view as" go, the
 * visit is closed in the audit trail, and they are back on the console. A member who calls it simply
 * lands in their default workspace, so there is nothing here to guard.
 */
export async function leaveWorkspaceAction(): Promise<ActionResult> {
  let home = "/login";
  try {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    const tenant = await getTenant();
    await clearActiveOrganization();
    await stopViewAs();
    if (tenant?.impersonated) {
      await audit({ action: "platform.leave", entityType: "SETTING", entityId: tenant.organizationId, organizationId: tenant.organizationId, userId: user.id });
    }
    home = await homeFor(user);
  } catch (err) {
    return toActionFailure(err);
  }
  redirect(home);
}
