"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { createPack, deletePack, generatePack, getPack, recompose, setBrief } from "@/server/creative/service";
import { enqueueRender } from "@/server/creative/jobs";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { CreativeFormat, CreativeMode } from "@/lib/creative/formats";
import type { CreativeBrief } from "@/lib/creative/brief";
import { getUi } from "@/server/i18n/locale";

export async function createPackAction(input: { name: string; format: CreativeFormat; mode: CreativeMode; system: string; motion?: string; editionId?: string | null }): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const tenant = await requireTenant();
    const pack = await createPack({
      organizationId: tenant.organizationId,
      name: input.name,
      format: input.format,
      mode: input.mode,
      editionId: input.editionId ?? null,
      actorId: user.id,
    });
    // The design system is a property of the pack rather than of the brief, so it is set at creation
    // and changing it re-composes without re-asking the model.
    const patch: { designSystem?: string; motionSystem?: string } = {};
    if (input.system && input.system !== "editorial") patch.designSystem = input.system;
    if (input.motion && input.motion !== "cut") patch.motionSystem = input.motion;
    if (Object.keys(patch).length) {
      const { db } = await import("@/server/db/client");
      const s = await import("@/server/db/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(s.creativePacks).set(patch).where(eq(s.creativePacks.id, pack.id));
    }
    revalidatePath("/studio");
    return ok({ id: pack.id });
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Write the brief, compose it, queue the render — one action.
 *
 * The three steps are separate in the service because they fail differently, and joined here because
 * from the outside it is one button. A failure at any step leaves the pack in the state that step
 * reached, so pressing it again resumes rather than restarts.
 */
export async function generatePackAction(packId: string, angle?: string): Promise<ActionResult<{ source: "model" | "local" }>> {
  try {
    const user = await requireUser();
    const result = await generatePack({ packId, actorId: user.id, angle: angle?.trim() || null });
    revalidatePath("/studio");
    revalidatePath(`/studio/${packId}`);
    return ok({ source: result.source }, result.source === "local" ? "Built from your own editorial — no model is connected" : "Directed and queued");
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Change the words, keep the look.
 *
 * The brief is the one thing a person may want to touch after the model has spoken — a headline
 * that is nearly right, a figure that should read "€1.2M". It goes back through the same door the
 * model's answer came through: parsed, checked, composed, inspected, repaired, rendered again. A
 * brief that cannot be rendered is refused with the sentences that say why, and nothing changes.
 */
export async function saveBriefAction(packId: string, brief: CreativeBrief): Promise<ActionResult<{ status: string }>> {
  try {
    const user = await requireUser();
    const pack = await setBrief({ packId, brief, actorId: user.id });
    if (pack.status !== "FAILED") await enqueueRender(pack, user.id);
    revalidatePath(`/studio/${packId}`);
    return ok({ status: pack.status }, pack.status === "FAILED" ? "Saved, but it does not fit — see what the check found" : "Saved and rendering");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Re-resolve an existing brief against the current brand, then re-render. */
export async function recomposeAction(packId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requireUser();
    const pack = await recompose(packId, user.id);
    if (pack.status !== "FAILED") await enqueueRender(pack, user.id);
    revalidatePath(`/studio/${packId}`);
    return ok(null, tr("Re-composed against your current brand"));
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function renderPackAction(packId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requireUser();
    const pack = await getPack(packId);
    await enqueueRender(pack, user.id);
    revalidatePath(`/studio/${packId}`);
    return ok(null, tr("Rendering"));
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deletePackAction(packId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requireUser();
    await deletePack(packId, user.id);
    revalidatePath("/studio");
    return ok(null, tr("Deleted"));
  } catch (error) {
    return toActionFailure(error);
  }
}
