"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { requireOrganizationRole } from "@/server/tenancy/context";
import { getOrganization } from "@/server/tenancy/service";
import { proposeFromEvidence, saveBrand } from "@/server/brand/service";
import { discoverOrganization } from "@/server/tenancy/discovery";
import type { BrandSystem } from "@/lib/brand/system";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

export async function saveBrandAction(system: BrandSystem): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const tenant = await requireOrganizationRole("ADMIN");
    // Validation lives in the service, not here: an action is an authentication boundary, not a
    // business-rule boundary, and the rule has to hold for the seeder and the API too.
    await saveBrand({ organizationId: tenant.organizationId, system, actorId: user.id });
    revalidatePath("/settings/brand");
    return ok(null, "Brand saved");
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Read the brand off the organisation's website again.
 *
 * Returns a proposal. Nothing is written — the customer sees what we found next to what they have
 * and decides, because silently replacing somebody's identity because their marketing site changed
 * a hero colour is the worst kind of surprise.
 */
export async function rediscoverBrandAction(): Promise<ActionResult<{ system: BrandSystem; notes: string[] }>> {
  try {
    await requireUser();
    const tenant = await requireOrganizationRole("ADMIN");
    const organization = await getOrganization(tenant.organizationId);
    if (!organization.website) return toActionFailure(new Error("Add your website in Workspace settings first."));

    const discovered = await discoverOrganization(organization.website);
    const proposal = proposeFromEvidence({
      colours: discovered.colours,
      fonts: discovered.fonts,
      logoUrl: discovered.logoUrl,
      type: discovered.type,
    });
    return ok({ system: proposal.system, notes: proposal.notes });
  } catch (error) {
    return toActionFailure(error);
  }
}
