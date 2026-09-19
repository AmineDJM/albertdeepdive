"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { auditStorage, storageHealth, verifyChecksums, type ChecksumResult, type StorageAudit, type StorageHealth } from "@/server/storage/audit";
import { migrateLocalObjectsToBucket, type MigrationReport } from "@/server/storage/migrate";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

/**
 * Storage is one service for every customer, so looking after it is a platform act.
 *
 * `settings:manage` is held only by a Briefly super admin, which is the same gate the rest of the
 * console uses. Nothing here is workspace-scoped on purpose: the question being answered is about
 * the bucket, not about one newsroom's pictures.
 */

export async function storageHealthAction(): Promise<ActionResult<StorageHealth>> {
  try {
    await requirePermission("settings:manage");
    return ok(await storageHealth());
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function auditStorageAction(): Promise<ActionResult<StorageAudit>> {
  try {
    await requirePermission("settings:manage");
    return ok(await auditStorage());
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function verifyChecksumsAction(sample = 25): Promise<ActionResult<ChecksumResult[]>> {
  try {
    await requirePermission("settings:manage");
    return ok(await verifyChecksums(sample));
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Copy the local disk into the connected bucket.
 *
 * Audited because it is the one action here that writes, and because "when did the files move"
 * is a question somebody will ask later. A dry run is not audited: it changes nothing.
 */
export async function migrateStorageAction(dryRun: boolean): Promise<ActionResult<MigrationReport>> {
  try {
    const user = await requirePermission("settings:manage");
    const report = await migrateLocalObjectsToBucket({ dryRun });
    if (!dryRun) {
      await audit({
        action: "storage.migrate",
        userId: user.id,
        entityType: "SETTING",
        metadata: { bucket: report.bucket, considered: report.considered, copied: report.copied, failed: report.failed, missingLocally: report.missingLocally },
      });
      revalidatePath("/admin/storage");
    }
    return ok(report);
  } catch (err) {
    return toActionFailure(err);
  }
}
