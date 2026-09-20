import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";

/**
 * The library as an editorial memory.
 *
 * §54 of the design brief: Briefly should know which assets have already appeared, where, when and
 * how often — because without that, the same three photographs open every edition and the
 * publication starts to look like a screensaver. A newsroom's picture desk keeps this in its head;
 * here it is a query.
 *
 * Derived rather than recorded. A separate "appearances" table would be one more thing to write on
 * every publish and one more thing to be wrong when somebody edits an old issue; what actually
 * happened is already in the data — this picture is attached to that story, that story ran in that
 * edition, and that edition went out on that date.
 */

export type MediaUse = {
  mediaId: string;
  /** Editions it has appeared in that were actually published. */
  appearances: number;
  lastUsed: Date | null;
  /** The editions, newest first, for the screen that shows why a picture is being held back. */
  editions: { editionId: string; label: string; publishedAt: Date | null }[];
};

const PUBLISHED = ["PUBLISHED", "ARCHIVED"] as const;

/**
 * How often each of these pictures has run, in editions other than this one.
 *
 * "Other than this one" matters: a picture used twice inside the issue being designed is a
 * composition problem, not a memory problem, and conflating them would make every second use of a
 * hero look like a repeat from last month.
 */
export async function mediaMemory(organizationId: string, mediaIds: string[], options: { exceptEditionId?: string } = {}): Promise<Map<string, MediaUse>> {
  const out = new Map<string, MediaUse>();
  for (const id of mediaIds) out.set(id, { mediaId: id, appearances: 0, lastUsed: null, editions: [] });
  if (mediaIds.length === 0) return out;

  // Picture → story → edition, keeping only the editions a reader actually saw.
  const rows = await db
    .select({
      mediaId: s.storyMedia.mediaAssetId,
      editionId: s.editions.id,
      label: s.editions.label,
      publishedAt: s.editions.publishedAt,
    })
    .from(s.storyMedia)
    .innerJoin(s.stories, eq(s.stories.id, s.storyMedia.storyId))
    .innerJoin(s.editions, eq(s.editions.id, s.stories.editionId))
    .where(
      and(
        inArray(s.storyMedia.mediaAssetId, mediaIds),
        eq(s.editions.organizationId, organizationId),
        inArray(s.editions.status, [...PUBLISHED]),
        options.exceptEditionId ? ne(s.editions.id, options.exceptEditionId) : undefined,
      ),
    )
    .orderBy(desc(s.editions.publishedAt));

  for (const row of rows) {
    const entry = out.get(row.mediaId);
    if (!entry) continue;
    // One edition counts once, however many stories in it used the picture.
    if (entry.editions.some((edition) => edition.editionId === row.editionId)) continue;
    entry.editions.push({ editionId: row.editionId, label: row.label, publishedAt: row.publishedAt });
    entry.appearances += 1;
    if (row.publishedAt && (!entry.lastUsed || row.publishedAt > entry.lastUsed)) entry.lastUsed = row.publishedAt;
  }
  return out;
}

/**
 * Pictures this workspace has that nothing has used yet.
 *
 * The other half of the memory, and the one an editor asks for by name: "what have we got that we
 * have not used?". Ordered by quality so the answer is useful rather than exhaustive.
 */
export async function unusedPictures(organizationId: string, limit = 40) {
  const used = await db.selectDistinct({ id: s.storyMedia.mediaAssetId }).from(s.storyMedia);
  const seen = new Set(used.map((row) => row.id));
  const rows = await db.query.mediaAssets.findMany({
    where: await scoped(s.mediaAssets.organizationId, eq(s.mediaAssets.isArchived, false), ne(s.mediaAssets.rightsStatus, "RED")),
    orderBy: [desc(s.mediaAssets.qualityScore), desc(s.mediaAssets.createdAt)],
    // Read past the limit: the filter happens here, so limiting first would return a short list of
    // pictures that all turn out to have been used.
    limit: limit * 4,
    columns: { id: true, fileName: true, caption: true, width: true, height: true, qualityScore: true, rightsStatus: true },
  });
  return rows.filter((row) => !seen.has(row.id)).slice(0, limit);
}

/**
 * The focal point and crops stored for a picture, if anything has worked them out yet.
 *
 * Kept on the asset's own metadata rather than in a new table: they are computed from the picture
 * and belong to it, they are read whole, and a crop that outlives its picture is meaningless.
 */
export type StoredFocal = { x: number; y: number; confidence: number };

export async function storedFocal(mediaId: string): Promise<StoredFocal | null> {
  const asset = await db.query.mediaAssets.findFirst({ where: await scoped(s.mediaAssets.organizationId, eq(s.mediaAssets.id, mediaId)), columns: { metadata: true } });
  const focal = (asset?.metadata as { focalPoint?: StoredFocal } | undefined)?.focalPoint;
  return focal && typeof focal.x === "number" && typeof focal.y === "number" ? focal : null;
}

export async function storeFocal(mediaId: string, focal: StoredFocal, crops: s.CropSuggestion[]): Promise<void> {
  const asset = await db.query.mediaAssets.findFirst({ where: await scoped(s.mediaAssets.organizationId, eq(s.mediaAssets.id, mediaId)), columns: { id: true, metadata: true } });
  if (!asset) return;
  await db
    .update(s.mediaAssets)
    .set({ metadata: { ...(asset.metadata as Record<string, unknown>), focalPoint: focal }, suggestedCrops: crops })
    .where(eq(s.mediaAssets.id, asset.id));
}
