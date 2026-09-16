"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { kickJobRunner } from "@/server/jobs/runner";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { bulkArchive, bulkSetRights } from "@/server/media/rights";
import { describeMedia } from "@/server/media/describe";
import { enqueueMediaProcessing } from "@/server/media/jobs";
import type { RightsStatus } from "@/server/media/constants";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { RIGHTS_STATUS_LABELS } from "@/lib/constants";

const INLINE_DESCRIBE_LIMIT = 6;

function revalidate(editionId: string, ids: string[] = []) {
  revalidatePath(`/editions/${editionId}/media`);
  for (const id of ids) revalidatePath(`/media/${id}`);
}

export async function bulkSetRightsAction(
  editionId: string,
  ids: string[],
  status: RightsStatus,
  note: string | null,
): Promise<ActionResult<{ updated: number }>> {
  try {
    const user = await requirePermission("media:rights");
    const result = await bulkSetRights(ids, status, note, user);
    revalidate(editionId, ids);
    const n = result.updated;
    return ok(
      { updated: n },
      `${n} asset${n === 1 ? "" : "s"} set to ${RIGHTS_STATUS_LABELS[status]}${result.failed.length ? ` (${result.failed.length} skipped)` : ""}`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function bulkArchiveAction(
  editionId: string,
  ids: string[],
): Promise<ActionResult<{ archived: number }>> {
  try {
    const user = await requirePermission("media:manage");
    const result = await bulkArchive(ids, user);
    revalidate(editionId, ids);
    return ok(result, `${result.archived} asset${result.archived === 1 ? "" : "s"} archived`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Describes a few assets inline; larger selections are queued as background jobs. */
export async function bulkDescribeAction(
  editionId: string,
  ids: string[],
): Promise<ActionResult<{ described: number; queued: number; failed: number }>> {
  try {
    const user = await requirePermission("media:manage");
    const unique = [...new Set(ids)];
    if (!unique.length) return { ok: false, error: "Select at least one asset" };
    let described = 0;
    let failed = 0;
    let queued = 0;
    let firstError: string | null = null;
    if (unique.length <= INLINE_DESCRIBE_LIMIT) {
      for (const id of unique) {
        try {
          await describeMedia(id, { force: true });
          described += 1;
        } catch (err) {
          failed += 1;
          firstError = firstError ?? (err instanceof Error ? err.message : String(err));
        }
      }
    } else {
      for (const id of unique) {
        await enqueueMediaProcessing(id, {
          editionId,
          userId: user.id,
          dedupe: false,
          force: true,
        });
        queued += 1;
      }
      kickJobRunner();
    }
    revalidate(editionId, unique);
    if (failed && !described) return { ok: false, error: firstError ?? "AI description failed" };
    const message = queued
      ? `${queued} asset${queued === 1 ? "" : "s"} queued for AI description`
      : `${described} asset${described === 1 ? "" : "s"} described${failed ? ` · ${failed} failed` : ""}`;
    return ok({ described, queued, failed }, message);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Queues a description job for every asset of the edition that has none yet. */
export async function describeMissingAction(
  editionId: string,
): Promise<ActionResult<{ queued: number }>> {
  try {
    const user = await requirePermission("media:manage");
    const rows = await db
      .select({ id: s.mediaAssets.id })
      .from(s.mediaAssets)
      .where(
        and(
          eq(s.mediaAssets.editionId, editionId),
          eq(s.mediaAssets.isArchived, false),
          isNull(s.mediaAssets.aiDescription),
        ),
      );
    for (const row of rows)
      await enqueueMediaProcessing(row.id, { editionId, userId: user.id, dedupe: false });
    if (rows.length) kickJobRunner();
    revalidate(editionId);
    return ok(
      { queued: rows.length },
      rows.length
        ? `${rows.length} asset${rows.length === 1 ? "" : "s"} queued for AI description`
        : "Every asset already has a description",
    );
  } catch (err) {
    return toActionFailure(err);
  }
}
