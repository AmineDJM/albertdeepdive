"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { compareVersions, downloadUrl, requestExport, type PublicationKind, type VersionComparison } from "@/server/publication/versions";
import { renderVersion } from "@/server/publication/versions";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

function revalidateExports(editionId: string) {
  revalidatePath(`/editions/${editionId}/exports`);
  revalidatePath(`/editions/${editionId}/qa`);
  revalidatePath(`/editions/${editionId}`);
}

/**
 * Queues a new version and its render. The PDF and the DOCX come from the one document snapshot
 * taken here, so the two files can never describe different issues.
 */
export async function requestExportAction(editionId: string, kind: PublicationKind, notes?: string): Promise<ActionResult<{ versionId: string; label: string }>> {
  try {
    const user = await requirePermission("export:run");
    const { version } = await requestExport(editionId, { kind, userId: user.id, notes: notes?.trim() || null });
    revalidateExports(editionId);
    return ok({ versionId: version.id, label: version.label }, `Version ${version.label} queued for rendering`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Re-runs the renderer for a version that failed, without creating a new version number. */
export async function retryRenderAction(editionId: string, versionId: string): Promise<ActionResult> {
  try {
    await requirePermission("export:run");
    const version = await renderVersion(versionId);
    revalidateExports(editionId);
    return version.status === "READY" ? ok(null, `Version ${version.label} rendered`) : ok(null, `Version ${version.label} is ${version.status.toLowerCase()}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function downloadAssetAction(assetId: string): Promise<ActionResult<{ url: string; fileName: string }>> {
  try {
    await requirePermission("edition:view");
    const { url, fileName } = await downloadUrl(assetId);
    return ok({ url, fileName });
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function compareVersionsAction(aId: string, bId: string): Promise<ActionResult<VersionComparison>> {
  try {
    await requirePermission("edition:view");
    return ok(await compareVersions(aId, bId));
  } catch (err) {
    return toActionFailure(err);
  }
}
