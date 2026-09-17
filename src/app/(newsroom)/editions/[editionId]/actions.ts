"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { simulateSubmissions } from "@/server/dev/simulate";
import { runAutopilot, type AutopilotResult } from "@/server/editorial/autopilot";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

function revalidateEdition(editionId: string) {
  revalidatePath(`/editions/${editionId}`);
  revalidatePath(`/editions/${editionId}/inbox`);
  revalidatePath(`/editions/${editionId}/stories`);
  revalidatePath(`/editions/${editionId}/articles`);
  revalidatePath(`/editions/${editionId}/layout`);
  revalidatePath(`/editions/${editionId}/qa`);
  revalidatePath(`/editions/${editionId}/exports`);
  revalidatePath(`/editions/${editionId}/campaign`);
}

/** A short human summary of what the pilot achieved, for the toast. */
function autopilotMessage(result: AutopilotResult): string {
  if (result.published) return "Done — the issue was built and published (no email sent to anyone).";
  const failed = result.steps.find((s) => s.status === "failed" || s.status === "blocked");
  if (failed) return `Stopped at “${failed.label}”${failed.detail ? `: ${failed.detail}` : ""}`;
  const last = result.steps[result.steps.length - 1];
  return last ? `Done — ${last.label.toLowerCase()}.` : "Nothing to do.";
}

/**
 * Super-admin only. Injects fake contribution-form submissions into the edition so the newsroom
 * can be demoed end to end. Gated on `settings:manage`, a permission only SUPER_ADMIN holds.
 */
export async function simulateReturnsAction(editionId: string, input: { count?: number; attachPhotos?: boolean } = {}): Promise<ActionResult<{ created: number; withPhotos: number }>> {
  try {
    const user = await requirePermission("settings:manage");
    const result = await simulateSubmissions(editionId, { count: input.count, attachPhotos: input.attachPhotos, userId: user.id });
    revalidateEdition(editionId);
    return ok(
      { created: result.created, withPhotos: result.withPhotos },
      `${result.created} fake submission${result.created === 1 ? "" : "s"} added${result.withPhotos ? ` · ${result.withPhotos} with a photo` : ""}. Run the pipeline to see the issue take shape.`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * One click, whole issue. Runs the pilot to a finished, published edition: close collection →
 * AI processing → write & approve articles → flat-plan → validate → PDF/DOCX → publish, auto-clearing
 * the quality gates it is allowed to. Nothing is emailed to any reader. Gated on `edition:publish`
 * (editor-in-chief / super-admin), which the gate overrides inside also require.
 */
export async function runToPublishedAction(editionId: string): Promise<ActionResult<AutopilotResult>> {
  try {
    const user = await requirePermission("edition:publish");
    const result = await runAutopilot(editionId, { id: user.id, role: user.role }, { target: "publish" });
    // Deliberately no revalidatePath here: publishing flips the edition to PUBLISHED, which would
    // unmount the pilot button (it is hidden once published) and destroy the step log the operator
    // is reading. The client refreshes the page when it closes the dialog instead.
    return ok(result, autopilotMessage(result));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Closes the collection and runs the AI processing, stopping at editorial review for a human to take over. */
export async function closeAndProcessAction(editionId: string): Promise<ActionResult<AutopilotResult>> {
  try {
    const user = await requirePermission("edition:publish");
    const result = await runAutopilot(editionId, { id: user.id, role: user.role }, { target: "organise" });
    return ok(result, autopilotMessage(result));
  } catch (err) {
    return toActionFailure(err);
  }
}
