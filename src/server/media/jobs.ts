import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES, registerJobHandler } from "@/server/jobs/registry";
import { createLogger } from "@/server/logger";
import { NotFoundError } from "@/lib/action-result";
import { describeMedia } from "./describe";
import { DUPLICATE_THRESHOLD, hammingDistance, SIMILAR_THRESHOLD } from "./hash";

const log = createLogger("media:jobs");

export type MediaProcessPayload = { assetId: string; describe?: boolean; force?: boolean };

export type DuplicateCheckResult = {
  duplicateOfId: string | null;
  similarityGroup: string | null;
  flags: string[];
  nearest: { id: string; distance: number } | null;
  /** True when the asset carries a manual "not a duplicate" decision and was left untouched. */
  respectedManualDecision: boolean;
};

/**
 * Compares an asset's fingerprint with the other assets of its edition and stores the outcome:
 * `duplicateOfId` (exact SHA-256 match or hamming ≤ 6), `similarityGroup` (hamming ≤ 12) and the
 * matching quality flags. A manual "clear duplicate" decision is respected.
 */
export async function recheckDuplicates(assetId: string): Promise<DuplicateCheckResult> {
  const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, assetId) });
  if (!asset) throw new NotFoundError("Media asset");
  const manualClear = !!(asset.metadata as { duplicateCleared?: boolean }).duplicateCleared;
  if (manualClear) {
    return {
      duplicateOfId: asset.duplicateOfId,
      similarityGroup: asset.similarityGroup,
      flags: asset.qualityFlags,
      nearest: null,
      respectedManualDecision: true,
    };
  }
  const others = await db
    .select({
      id: s.mediaAssets.id,
      sha256: s.mediaAssets.sha256,
      phash: s.mediaAssets.phash,
      similarityGroup: s.mediaAssets.similarityGroup,
      createdAt: s.mediaAssets.createdAt,
    })
    .from(s.mediaAssets)
    .where(
      and(
        ne(s.mediaAssets.id, assetId),
        eq(s.mediaAssets.isArchived, false),
        asset.editionId ? eq(s.mediaAssets.editionId, asset.editionId) : undefined,
        isNotNull(s.mediaAssets.phash),
      ),
    );

  let duplicateOfId: string | null = asset.duplicateOfId;
  let similarityGroup: string | null = asset.similarityGroup;
  let nearest: { id: string; distance: number } | null = null;
  const flags = new Set(
    asset.qualityFlags.filter(
      (f) => f !== "EXACT_DUPLICATE" && f !== "NEAR_DUPLICATE" && f !== "SIMILAR_IMAGE",
    ),
  );
  const groupMembers: string[] = [];

  for (const other of others) {
    const exact = !!asset.sha256 && other.sha256 === asset.sha256;
    const distance =
      asset.phash && other.phash
        ? hammingDistance(asset.phash, other.phash)
        : Number.POSITIVE_INFINITY;
    if (!nearest || distance < nearest.distance)
      nearest = { id: other.id, distance: Number.isFinite(distance) ? distance : 64 };
    if (exact) {
      flags.add("EXACT_DUPLICATE");
      duplicateOfId = duplicateOfId ?? other.id;
      similarityGroup = similarityGroup ?? other.similarityGroup ?? other.id;
      groupMembers.push(other.id);
    } else if (distance <= DUPLICATE_THRESHOLD) {
      flags.add("NEAR_DUPLICATE");
      duplicateOfId = duplicateOfId ?? other.id;
      similarityGroup = similarityGroup ?? other.similarityGroup ?? other.id;
      groupMembers.push(other.id);
    } else if (distance <= SIMILAR_THRESHOLD) {
      flags.add("SIMILAR_IMAGE");
      similarityGroup = similarityGroup ?? other.similarityGroup ?? other.id;
      groupMembers.push(other.id);
    }
  }
  // An exact duplicate should point at the exact match rather than a merely similar one.
  if (flags.has("EXACT_DUPLICATE") && duplicateOfId) {
    const exactMatch = others.find((o) => !!asset.sha256 && o.sha256 === asset.sha256);
    if (exactMatch && asset.duplicateOfId === null) duplicateOfId = exactMatch.id;
  }
  const nextFlags = [...flags];
  await db
    .update(s.mediaAssets)
    .set({ duplicateOfId, similarityGroup, qualityFlags: nextFlags })
    .where(eq(s.mediaAssets.id, assetId));
  if (similarityGroup && groupMembers.length) {
    for (const id of groupMembers) {
      await db
        .update(s.mediaAssets)
        .set({ similarityGroup })
        .where(and(eq(s.mediaAssets.id, id), eq(s.mediaAssets.isArchived, false)));
    }
  }
  return {
    duplicateOfId,
    similarityGroup,
    flags: nextFlags,
    nearest,
    respectedManualDecision: false,
  };
}

registerJobHandler<MediaProcessPayload, Record<string, unknown>>(
  JOB_TYPES.MEDIA_PROCESS,
  async (payload, ctx) => {
    const { assetId } = payload;
    if (!assetId) throw new Error("media.process: assetId is required");
    const result: Record<string, unknown> = { assetId };
    await ctx.progress(0, 2, "Describing image");
    if (payload.describe !== false) {
      try {
        const described = await describeMedia(assetId, { force: payload.force });
        result.described = true;
        result.describeModel = described.model;
        result.kind = described.kind;
      } catch (err) {
        // The library must keep working without an AI provider: record the failure and move on.
        result.described = false;
        result.describeError = err instanceof Error ? err.message : String(err);
        ctx.log("describe skipped", { assetId, error: result.describeError });
      }
    }
    await ctx.progress(1, 2, "Checking duplicates");
    const dup = await recheckDuplicates(assetId);
    result.duplicateOfId = dup.duplicateOfId;
    result.similarityGroup = dup.similarityGroup;
    result.flags = dup.flags;
    await ctx.progress(2, 2, "Done");
    log.info("processed", {
      assetId,
      described: result.described,
      duplicateOfId: dup.duplicateOfId,
    });
    return result;
  },
);

/**
 * Queues the post-ingest processing of an asset (AI description + duplicate re-check). Upload-time
 * calls are idempotent per asset; pass `dedupe: false` to force a re-run from the UI.
 */
export async function enqueueMediaProcessing(
  assetId: string,
  options: {
    editionId?: string | null;
    userId?: string | null;
    dedupe?: boolean;
    force?: boolean;
    describe?: boolean;
  } = {},
) {
  return enqueueJob({
    type: JOB_TYPES.MEDIA_PROCESS,
    payload: {
      assetId,
      force: options.force ?? false,
      describe: options.describe ?? true,
    } satisfies MediaProcessPayload,
    idempotencyKey: options.dedupe === false ? undefined : `media.process:${assetId}`,
    editionId: options.editionId ?? null,
    createdById: options.userId ?? null,
    priority: 6,
  });
}
