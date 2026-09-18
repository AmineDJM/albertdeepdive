"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { overrideQualityGate, clearQualityGateOverride, publishEdition, archiveEdition } from "@/server/publication/versions";
import { approveAllArticles, autoPickCover, generateExports, validateImageRights, validateLayout } from "@/server/publication/gate-fixes";
import { transitionEdition } from "@/server/editions/service";
import { AppError, ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { getUi } from "@/server/i18n/locale";

function revalidateEdition(editionId: string) {
  revalidatePath(`/editions/${editionId}/qa`);
  revalidatePath(`/editions/${editionId}/exports`);
  revalidatePath(`/editions/${editionId}/layout`);
  revalidatePath(`/editions/${editionId}/media`);
  revalidatePath(`/editions/${editionId}/articles`);
  revalidatePath(`/editions/${editionId}`);
}

/**
 * Overriding a gate is an editor-in-chief decision and always carries a written reason: the reason
 * is what appears on the gate afterwards, and in the audit trail.
 */
export async function overrideGateAction(editionId: string, gateKey: string, reason: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("qa:override");
    await overrideQualityGate(editionId, gateKey, reason, { id: user.id, role: user.role });
    revalidateEdition(editionId);
    return ok(null, tr("Gate overridden"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function clearOverrideAction(editionId: string, gateKey: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("qa:override");
    await clearQualityGateOverride(editionId, gateKey, { id: user.id, role: user.role });
    revalidateEdition(editionId);
    return ok(null, tr("Override removed"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * The inline "Fix it here" on a failing checklist gate. It does the real work that clears the gate
 * (approve the articles, validate the layout, regenerate exports, …), each behind the permission that
 * operation actually needs. Not every gate has an automatic fix — RED media and factual conflicts
 * need a human decision, so they only offer the "go and fix" link.
 */
export async function fixGateAction(editionId: string, gateKey: string): Promise<ActionResult> {
  try {
    let message = "Done";
    switch (gateKey) {
      case "every_selected_article_approved": {
        const user = await requirePermission("article:approve");
        const n = await approveAllArticles(editionId, { id: user.id, role: user.role });
        message = n ? `${n} article${n === 1 ? "" : "s"} approved` : "No articles needed approving";
        break;
      }
      case "image_rights_validated": {
        const user = await requirePermission("media:rights");
        const n = await validateImageRights(editionId, { id: user.id, role: user.role });
        message = n ? `${n} image${n === 1 ? "" : "s"} marked validated (GREEN)` : "No unclear images to validate";
        break;
      }
      case "cover_approved": {
        const user = await requirePermission("edition:edit");
        const title = await autoPickCover(editionId, { id: user.id, role: user.role });
        message = title ? `Cover set to “${title}”` : "No approved story to feature yet";
        break;
      }
      case "page_layout_validated":
      case "toc_consistent":
      case "page_numbers_consistent": {
        const user = await requirePermission("layout:edit");
        const pages = await validateLayout(editionId, { id: user.id, role: user.role });
        message = `Flat-plan rebuilt and validated (${pages} pages)`;
        break;
      }
      case "no_text_overflow":
      case "pdf_generated":
      case "docx_generated": {
        const user = await requirePermission("export:run");
        const label = await generateExports(editionId, { id: user.id, role: user.role });
        message = `Exports regenerated (${label})`;
        break;
      }
      default:
        throw new AppError("This gate has no automatic fix — use the link to resolve it by hand.", "NO_FIX", 400);
    }
    revalidateEdition(editionId);
    return ok(null, message);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function moveEditionStatusAction(editionId: string, status: EditionStatus, reason?: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("edition:edit");
    await transitionEdition(editionId, status, user.id, reason);
    revalidateEdition(editionId);
    return ok(null, tr("Edition moved on"));
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
  const tr = await getUi();
  try {
    const user = await requirePermission("edition:publish");
    await archiveEdition(editionId, user.id);
    revalidateEdition(editionId);
    revalidatePath("/archive");
    return ok(null, tr("Edition archived"));
  } catch (err) {
    return toActionFailure(err);
  }
}
