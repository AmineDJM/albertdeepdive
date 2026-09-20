"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { designState, type DesignState } from "@/server/design/console";
import { designEdition, restoreDesign, saveDesign } from "@/server/design/service";
import { talkToDesign, type DesignReply } from "@/server/design/studio";
import { refineEditionDesign } from "@/server/design/refine";
import { runTournament, type TournamentResult } from "@/server/design/tournament";
import { layoutDesign } from "@/server/design/render/pdf";
import { applyOperations } from "@/lib/design/apply";
import { designOperationSchema, type DesignOperation } from "@/lib/design/operations";
import { describeDiff, diffDesigns } from "@/lib/design/diff";
import { saveArtDirection, directionFor } from "@/server/design/identity";
import { currentDesign } from "@/server/design/service";
import { readSignals } from "@/lib/design/signals";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { describePlan } from "@/lib/design/pages";
import { ensureBrand } from "@/server/brand/service";
import { storedFocals } from "@/server/design/memory";
import { requireTenant } from "@/server/tenancy/context";
import type { BrandSystem } from "@/lib/brand/system";

/**
 * The design screen's own actions.
 *
 * Every one of them goes through the same engine the conversation does: a control and a sentence
 * are two ways of saying the same thing, and a screen that had its own private path into the design
 * would be a second engine with its own bugs.
 */

function revalidateDesign(editionId: string) {
  revalidatePath(`/editions/${editionId}/design`);
  revalidatePath(`/editions/${editionId}/layout`);
  revalidatePath(`/editions/${editionId}`);
}

export async function designStateAction(editionId: string): Promise<ActionResult<DesignState>> {
  try {
    await requirePermission("layout:edit");
    return ok(await designState(editionId));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Design the issue for the first time, or from the beginning again. */
export async function designEditionAction(editionId: string, steer?: string): Promise<ActionResult<DesignState>> {
  try {
    const user = await requirePermission("layout:edit");
    await designEdition(editionId, { steer: steer?.trim() || null, userId: user.id });
    revalidateDesign(editionId);
    return ok(await designState(editionId));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** One change, from a control rather than a sentence. */
export async function designOperationAction(editionId: string, operation: DesignOperation): Promise<ActionResult<DesignState>> {
  try {
    const user = await requirePermission("layout:edit");
    const parsed = designOperationSchema.safeParse(operation);
    if (!parsed.success) return toActionFailure(new Error("That is not something the design understands"));

    const design = await currentDesign(editionId);
    if (!design) return toActionFailure(new Error("This edition has not been designed yet"));
    const [document, { resolved: direction }] = await Promise.all([
      buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true }),
      directionFor(editionId),
    ]);
    const applied = applyOperations(design, [parsed.data], { signals: readSignals(document), direction });
    const refused = applied.outcomes.find((outcome) => !outcome.done);
    if (refused) return toActionFailure(new Error(refused.what));

    await saveDesign(editionId, applied.design, { summary: describeDiff(diffDesigns(design, applied.design)), userId: user.id });
    revalidateDesign(editionId);
    return ok(await designState(editionId));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** A dial: this issue's departure from the title's usual look, which recomposes the issue. */
export async function designDialAction(editionId: string, dial: string, value: number): Promise<ActionResult<DesignState>> {
  try {
    const user = await requirePermission("layout:edit");
    const allowed = ["density", "colourIntensity", "ornament", "variation", "minimalism", "formality", "playfulness", "seriousness"];
    if (!allowed.includes(dial) || !Number.isFinite(value) || value < 0 || value > 1) return toActionFailure(new Error("That is not a dial this design has"));

    const { direction: stored } = await directionFor(editionId);
    await saveArtDirection(editionId, { ...stored, genome: { ...stored.genome, [dial]: value } }, { userId: user.id, stated: true });
    // The dials are the issue's direction: they mean nothing until the issue is composed from them.
    await designEdition(editionId, { local: true, userId: user.id, summary: `${dial} set to ${Math.round(value * 100)}%` });
    revalidateDesign(editionId);
    return ok(await designState(editionId));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Say something to the design. */
export async function designSayAction(editionId: string, message: string, selection: string[] = []): Promise<ActionResult<DesignReply>> {
  try {
    const user = await requirePermission("layout:edit");
    const reply = await talkToDesign(editionId, { message, selection }, user.id);
    revalidateDesign(editionId);
    return ok(reply);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Look at the pages and fix what looking finds. */
export async function designRefineAction(editionId: string): Promise<ActionResult<{ state: DesignState; said: string }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await refineEditionDesign(editionId, { userId: user.id, rounds: 2 });
    revalidateDesign(editionId);
    const said = result.rounds.map((round) => round.said).join(" ");
    return ok({ state: await designState(editionId), said: said || "Nothing needed changing." });
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Draw several covers and keep the one that wins. */
export async function designTournamentAction(editionId: string): Promise<ActionResult<{ state: DesignState; result: TournamentResult }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await runTournament(editionId, { scope: { kind: "cover" }, entrants: 3, userId: user.id });
    revalidateDesign(editionId);
    return ok({ state: await designState(editionId), result });
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Put an earlier design back, as a new revision. */
export async function designRestoreAction(editionId: string, revision: number): Promise<ActionResult<DesignState>> {
  try {
    const user = await requirePermission("layout:edit");
    await restoreDesign(editionId, revision, { userId: user.id });
    revalidateDesign(editionId);
    return ok(await designState(editionId));
  } catch (err) {
    return toActionFailure(err);
  }
}

export type LayoutReport = { pages: number; overflowing: number[]; underfilled: number[]; summary: string };

/** Lay the design out on paper and say what the paper made of it. */
export async function designLayoutAction(editionId: string): Promise<ActionResult<LayoutReport>> {
  try {
    await requirePermission("layout:edit");
    const design = await currentDesign(editionId);
    if (!design) return toActionFailure(new Error("This edition has not been designed yet"));

    const tenant = await requireTenant();
    const document = await buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true });
    const [{ resolved: direction }, focals, brand] = await Promise.all([
      directionFor(editionId),
      storedFocals(document.media.map((media) => media.id)),
      ensureBrand(tenant.organizationId),
    ]);

    const laid = await layoutDesign({ design, document, direction, brand: brand.system as BrandSystem, focals });
    return ok({
      pages: laid.plan.pages.length,
      overflowing: laid.report.overflowing,
      underfilled: laid.report.underfilled,
      summary: describePlan(laid.plan),
    });
  } catch (err) {
    return toActionFailure(err);
  }
}
