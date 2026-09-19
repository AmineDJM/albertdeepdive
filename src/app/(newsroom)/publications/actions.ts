"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { currentOrganizationId } from "@/server/tenancy/context";
import { createPublication, deletePublication, updatePublication, type PublicationInput } from "@/server/publications/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";
import { logger } from "@/server/logger";

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

/**
 * "+ New edition": the next edition of this title, from the last one, opened on its first step.
 *
 * The month, the issue number, the title, the sections, the page, the outputs and the campaign are
 * all decided from what this title already did. None of them is asked, because none of them is a
 * question a person can answer faster or better than Briefly can — and every one of them can be
 * changed from the edition itself.
 */
export async function startNextEditionAction(publicationId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("edition:create");
    const { nextEditionMonth, createEdition } = await import("@/server/editions/service");
    const when = await nextEditionMonth();
    const edition = await createEdition({ month: when.month, year: when.year, publicationId }, user.id);
    try {
      const { scheduleFromDefaults } = await import("@/server/campaigns/service");
      await scheduleFromDefaults(edition.id, { id: user.id });
    } catch (err) {
      // The edition stands without its campaign; its first step offers to open one.
      logger.warn("started an edition without a campaign", { editionId: edition.id, err });
    }
    revalidatePath(`/publications/${publicationId}`);
    revalidatePath("/editions");
    revalidatePath("/overview");
    return ok({ id: edition.id }, `${edition.label} created`);
  } catch (err) {
    return toActionFailure(err);
  }
}
