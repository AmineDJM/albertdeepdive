"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { currentOrganizationId } from "@/server/tenancy/context";
import { createPublication, deletePublication, updatePublication, type PublicationInput } from "@/server/publications/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

export type { PublicationInput };

export async function createPublicationAction(raw: PublicationInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("edition:create");
    const organizationId = await currentOrganizationId();
    const row = await createPublication(organizationId, raw, user.id);
    revalidatePath("/publications");
    return ok({ id: row.id });
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updatePublicationAction(id: string, raw: Partial<PublicationInput>): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:edit");
    const organizationId = await currentOrganizationId();
    await updatePublication(organizationId, id, raw, user.id);
    revalidatePath("/publications");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function deletePublicationAction(id: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:create");
    const organizationId = await currentOrganizationId();
    await deletePublication(organizationId, id, user.id);
    revalidatePath("/publications");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Show this title in Briefly's public gallery, or stop showing it.
 *
 * The customer's own decision about their own work, and reversible in one click: turning it off
 * empties the gallery of their editions immediately, because the gallery checks consent when it
 * reads rather than when a curator adds.
 */
export async function setShowcaseConsentAction(publicationId: string, on: boolean): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    const organizationId = await currentOrganizationId();
    const { setCustomerConsent } = await import("@/server/showcase/consent");
    await setCustomerConsent(organizationId, publicationId, on, user.id);
    revalidatePath("/publications");
    revalidatePath("/collections");
    return ok(null, on ? tr("Your published editions can now appear in Briefly's gallery.") : tr("Removed from Briefly's gallery."));
  } catch (err) {
    return toActionFailure(err);
  }
}
