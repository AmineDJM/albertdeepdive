"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { currentOrganizationId } from "@/server/tenancy/context";
import { createPublication, deletePublication, updatePublication, type PublicationInput } from "@/server/publications/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

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
