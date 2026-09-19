"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { currentOrganizationId } from "@/server/tenancy/context";
import { createPublication, deletePublication, updatePublication, type PublicationInput } from "@/server/publications/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";
import { logger } from "@/server/logger";

export type { PublicationInput };

/**
 * A new newsletter, and the first edition of it.
 *
 * A title with nothing in it is not a thing anybody wanted; it is a step on the way to the thing
 * they wanted. Naming a newsletter and then being shown an empty shelf, with a second button to
 * press before anything can happen, is a question Briefly can answer for itself — so it does, and
 * the person lands in Edition #1 with its campaign already scheduled.
 *
 * The edition comes back separately from the title, because the title is the thing that was
 * created and the edition is where to go next, and a caller that only wanted the first should not
 * have to know about the second.
 */
export async function createPublicationAction(raw: PublicationInput): Promise<ActionResult<{ id: string; editionId: string | null }>> {
  try {
    const user = await requirePermission("edition:create");
    const organizationId = await currentOrganizationId();
    const row = await createPublication(organizationId, raw, user.id);
    // A title without an edition is a shelf without a book on it.
    const first = await openNextEdition(row.id, user.id).catch((err) => {
      logger.warn("created a title without its first edition", { publicationId: row.id, err });
      return null;
    });
    revalidatePath("/publications");
    revalidatePath("/overview");
    return ok({ id: row.id, editionId: first?.id ?? null });
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
    const edition = await openNextEdition(publicationId, user.id);
    revalidatePath(`/publications/${publicationId}`);
    revalidatePath("/editions");
    revalidatePath("/overview");
    return ok({ id: edition.id }, `${edition.label} created`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * The next edition of a title, named and scheduled from what the title already did.
 *
 * Shared by "New edition" and by the birth of the title itself, so the first edition of a
 * newsletter is made exactly the way the sixth will be — same month arithmetic, same inherited
 * configuration, same campaign. A first edition that is special is a first edition nobody can
 * learn from.
 */
async function openNextEdition(publicationId: string, userId: string): Promise<{ id: string; label: string }> {
  const { nextEditionMonth, createEdition } = await import("@/server/editions/service");
  const when = await nextEditionMonth();
  const edition = await createEdition({ month: when.month, year: when.year, publicationId }, userId);
  try {
    const { scheduleFromDefaults } = await import("@/server/campaigns/service");
    await scheduleFromDefaults(edition.id, { id: userId });
  } catch (err) {
    // The edition stands without its campaign; its first step offers to open one.
    logger.warn("started an edition without a campaign", { editionId: edition.id, err });
  }
  return { id: edition.id, label: edition.label };
}
