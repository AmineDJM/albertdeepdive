"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { disableOutput, enableOutput, updateOutputConfig, type OutputFormat } from "@/server/outputs/service";
import { publishWebEdition, republishEdition, sendEditionEmail, unpublishWebEdition, type RepublishLine } from "@/server/outputs/publish";
import type { OutputConfig } from "@/server/db/schema/outputs";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

export async function toggleOutputAction(editionId: string, format: OutputFormat, enabled: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:edit");
    if (enabled) await enableOutput(editionId, format, user.id);
    else await disableOutput(editionId, format, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateOutputConfigAction(editionId: string, format: OutputFormat, patch: OutputConfig): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:edit");
    await updateOutputConfig(editionId, format, patch, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Send the edition to the people subscribed to its title. There is no undo, so it needs the publish right. */
export async function sendEditionEmailAction(editionId: string): Promise<ActionResult<{ sent: number; failed: number }>> {
  try {
    const user = await requirePermission("edition:publish");
    const result = await sendEditionEmail(editionId, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok({ sent: result.sent, failed: result.failed });
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Send it again, to everybody who received it the first time.
 *
 * Separate from `sendEditionEmailAction` so that nothing can resend by falling through a branch:
 * this one exists only because somebody pressed a control that told them how many inboxes it would
 * reach a second time.
 */
export async function resendEditionEmailAction(editionId: string): Promise<ActionResult<{ sent: number; failed: number }>> {
  try {
    const user = await requirePermission("edition:publish");
    const result = await sendEditionEmail(editionId, user.id, { resend: true });
    revalidatePath(`/editions/${editionId}`);
    return ok({ sent: result.sent, failed: result.failed });
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Make the frozen formats again from the issue as it stands. Emails nobody. */
export async function republishEditionAction(editionId: string): Promise<ActionResult<RepublishLine[]>> {
  try {
    const user = await requirePermission("edition:publish");
    const lines = await republishEdition(editionId, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(lines);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function publishWebEditionAction(editionId: string, publish: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:publish");
    if (publish) await publishWebEdition(editionId, user.id);
    else await unpublishWebEdition(editionId, user.id);
    revalidatePath(`/editions/${editionId}`);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
