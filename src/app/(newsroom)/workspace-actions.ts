"use server";

import { setActiveOrganization } from "@/server/tenancy/context";
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
