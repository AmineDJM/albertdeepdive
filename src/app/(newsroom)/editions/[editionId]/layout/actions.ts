"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import {
  movePlanPage,
  moveSectionRun,
  regeneratePagePlan,
  reorderPlanPages,
  runCopyfitPass,
  setPageFlags,
  setPageNotes,
  setPageStory,
  setPageTemplate,
  setPlanStatus,
  type FlatplanReport,
} from "@/server/publication/flatplan";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { templateByCode } from "@/lib/constants";

function revalidateFlatplan(editionId: string) {
  revalidatePath(`/editions/${editionId}/layout`);
  revalidatePath(`/editions/${editionId}`);
}

/** Re-runs the deterministic page allocation. Locked pages keep their number and their story. */
export async function regeneratePlanAction(editionId: string, includeCandidates = false): Promise<ActionResult<{ pages: number; locked: number; warnings: string[] }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await regeneratePagePlan(editionId, { userId: user.id, includeCandidates });
    revalidateFlatplan(editionId);
    const locked = result.locked ? `, ${result.locked} locked page${result.locked === 1 ? "" : "s"} kept` : "";
    return ok(result, `Plan regenerated: ${result.pages} pages${locked}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Runs the print engine's copyfit pass (measure → flow → re-measure) and stores the layout report. */
export async function runCopyfitAction(editionId: string): Promise<ActionResult<FlatplanReport>> {
  try {
    const user = await requirePermission("layout:edit");
    const report = await runCopyfitPass(editionId, user.id);
    revalidateFlatplan(editionId);
    return ok(report, `${report.pages} pages after ${report.rounds} round${report.rounds === 1 ? "" : "s"} · ${report.continuationPagesAdded} continuation page${report.continuationPagesAdded === 1 ? "" : "s"}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setPageTemplateAction(editionId: string, pageId: string, template: string): Promise<ActionResult<{ template: string; pageNumber: number }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await setPageTemplate(editionId, pageId, template, user.id);
    revalidateFlatplan(editionId);
    return ok(result, `Template changed to ${templateByCode(template).name}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Persists a new running order; `orderedAnchorIds` are the pages the editor can move. */
export async function reorderPagesAction(editionId: string, orderedAnchorIds: string[]): Promise<ActionResult<{ pages: number }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await reorderPlanPages(editionId, orderedAnchorIds, user.id);
    revalidateFlatplan(editionId);
    return ok(result, "Running order saved");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function movePageAction(editionId: string, pageId: string, direction: "up" | "down"): Promise<ActionResult<{ pages: number }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await movePlanPage(editionId, pageId, direction, user.id);
    revalidateFlatplan(editionId);
    return ok(result, direction === "up" ? "Page moved earlier" : "Page moved later");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function moveSectionAction(editionId: string, sectionId: string | null, direction: "up" | "down"): Promise<ActionResult<{ pages: number }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await moveSectionRun(editionId, sectionId, direction, user.id);
    revalidateFlatplan(editionId);
    return ok(result, direction === "up" ? "Section moved earlier" : "Section moved later");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setPageLockAction(
  editionId: string,
  pageId: string,
  patch: { isLocked?: boolean; isArticleLocked?: boolean; isImageLocked?: boolean },
): Promise<ActionResult<{ isLocked: boolean; pageNumber: number }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await setPageFlags(editionId, pageId, patch, user.id);
    revalidateFlatplan(editionId);
    const message =
      patch.isLocked === undefined
        ? "Page updated"
        : patch.isLocked
          ? "Page locked — re-planning will not move it"
          : "Page unlocked";
    return ok({ isLocked: result.isLocked, pageNumber: result.pageNumber }, message);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Pins a story to a page (and locks the page), or clears the page. */
export async function setPageStoryAction(editionId: string, pageId: string, storyId: string | null, pin = true): Promise<ActionResult<{ pageNumber: number; storyTitle: string | null }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await setPageStory(editionId, pageId, storyId, { pin, userId: user.id });
    revalidateFlatplan(editionId);
    return ok(result, result.storyTitle ? `“${result.storyTitle}” pinned to this page` : "Page cleared");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setPageNotesAction(editionId: string, pageId: string, notes: string): Promise<ActionResult<{ pageNumber: number }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await setPageNotes(editionId, pageId, notes, user.id);
    revalidateFlatplan(editionId);
    return ok(result, "Note saved");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Signs the flatplan off (or reopens it). The publication gate checks for a validated plan. */
export async function setPlanStatusAction(editionId: string, status: "DRAFT" | "VALIDATED" | "LOCKED"): Promise<ActionResult<{ status: string; pages: number; overflow: number }>> {
  try {
    const user = await requirePermission("layout:edit");
    const result = await setPlanStatus(editionId, status, user.id);
    revalidateFlatplan(editionId);
    revalidatePath(`/editions/${editionId}/qa`);
    const message =
      status === "DRAFT"
        ? "Flatplan reopened"
        : result.overflow
          ? `Flatplan ${status.toLowerCase()} — ${result.overflow} page(s) still overflow`
          : `Flatplan ${status.toLowerCase()} · ${result.pages} pages fit`;
    return ok(result, message);
  } catch (err) {
    return toActionFailure(err);
  }
}
