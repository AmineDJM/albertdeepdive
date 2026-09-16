"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { overrideQualityGate, clearQualityGateOverride, publishEdition, archiveEdition } from "@/server/publication/versions";
import { transitionEdition } from "@/server/editions/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { EditionStatus } from "@/lib/editorial/edition-state";

function revalidateEdition(editionId: string) {
  revalidatePath(`/editions/${editionId}/qa`);
  revalidatePath(`/editions/${editionId}/exports`);
  revalidatePath(`/editions/${editionId}`);
}

/**
 * Overriding a gate is an editor-in-chief decision and always carries a written reason: the reason
 * is what appears on the gate afterwards, and in the audit trail.
 */
export async function overrideGateAction(editionId: string, gateKey: string, reason: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("qa:override");
    await overrideQualityGate(editionId, gateKey, reason, { id: user.id, role: user.role });
    revalidateEdition(editionId);
    return ok(null, "Gate overridden");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function clearOverrideAction(editionId: string, gateKey: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("qa:override");
    await clearQualityGateOverride(editionId, gateKey, { id: user.id, role: user.role });
    revalidateEdition(editionId);
    return ok(null, "Override removed");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function moveEditionStatusAction(editionId: string, status: EditionStatus, reason?: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:edit");
    await transitionEdition(editionId, status, user.id, reason);
    revalidateEdition(editionId);
    return ok(null, "Edition moved on");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function publishEditionAction(editionId: string, versionId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:publish");
    const result = await publishEdition(editionId, versionId, user.id);
    revalidateEdition(editionId);
    revalidatePath("/archive");
    return ok(null, `Published as ${result.version.label}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function archiveEditionAction(editionId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:publish");
    await archiveEdition(editionId, user.id);
    revalidateEdition(editionId);
    revalidatePath("/archive");
    return ok(null, "Edition archived");
  } catch (err) {
    return toActionFailure(err);
  }
}
