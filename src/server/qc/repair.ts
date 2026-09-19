import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { canIllustrate } from "@/server/media/constants";
import { getStorage, storageKeys } from "@/server/storage";
import type { QcContext } from "./engine";
import type { Finding, RepairOutcome } from "./types";

const log = createLogger("qc:repair");

/**
 * Repairs that are arithmetic, not judgement — and every one of them local.
 *
 * The rule the whole engine turns on: never regenerate an issue to fix one page. Regenerating
 * changes a hundred things to fix one, and the remeasure afterwards then proves nothing, because
 * you can no longer tell whether the defect went away or simply moved somewhere nobody looked.
 *
 * So each repair here touches exactly the entity its finding named, and the engine measures again
 * with the same code that found the problem. A repair that succeeds and a measurement that still
 * fails is a repair that did not work, and the report says so rather than smoothing it over.
 */

const outcome = (finding: Finding, succeeded: boolean, detail: string, after: number | string | null = null): RepairOutcome => ({
  strategy: finding.repairStrategy!,
  metricId: finding.metricId,
  location: finding.location,
  attempted: true,
  succeeded,
  before: finding.beforeValue,
  after,
  detail,
});

/**
 * A missing thumbnail or web variant, made again from the original.
 *
 * Only the derived file is rebuilt. If the original is gone too there is nothing to derive from,
 * and inventing a picture would be worse than a broken box: it would be a broken box nobody
 * noticed.
 */
export async function regenerateVariant(finding: Finding): Promise<RepairOutcome> {
  const mediaId = finding.location.entityId;
  if (!mediaId) return outcome(finding, false, "the finding names no asset");

  const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, mediaId) });
  if (!asset) return outcome(finding, false, "the asset is no longer in the library");

  const storage = await getStorage();
  const original = await storage.get(asset.storageKey).catch(() => null);
  if (!original) {
    // The honest answer. The audit can say when the bytes went; nothing here can bring them back.
    return outcome(finding, false, "the original is missing from storage too, so there is nothing to derive from");
  }

  const { buildVariants } = await import("@/server/media/ingest");
  try {
    const rebuilt = await buildVariants(original, asset.mimeType);
    let written = 0;
    for (const variant of rebuilt) {
      const key = storageKeys.mediaVariant(asset.id, variant.kind, variant.format);
      await storage.put(key, variant.data, { contentType: variant.contentType });
      await db
        .insert(s.mediaVariants)
        .values({ assetId: asset.id, kind: variant.kind, storageKey: key, width: variant.width, height: variant.height, sizeBytes: variant.data.byteLength, format: variant.format })
        .onConflictDoUpdate({
          target: [s.mediaVariants.assetId, s.mediaVariants.kind],
          set: { storageKey: key, width: variant.width, height: variant.height, sizeBytes: variant.data.byteLength, format: variant.format },
        });
      written += 1;
    }
    return outcome(finding, written > 0, `rebuilt ${written} variant(s) from the original`, `${written} variants`);
  } catch (err) {
    return outcome(finding, false, err instanceof Error ? err.message : String(err));
  }
}

/**
 * A picture that may not carry a story, taken off the story.
 *
 * The link is removed, not the asset: a logo in the library is a logo somebody uploaded on purpose,
 * and deleting it to fix a page would be a repair that destroys evidence. What changes is the one
 * thing that was wrong — that it was placed as a photograph.
 */
export async function dropIneligibleAsset(finding: Finding, ctx: QcContext): Promise<RepairOutcome> {
  const mediaId = finding.location.entityId;
  if (!mediaId) return outcome(finding, false, "the finding names no asset");

  const links = await db.select({ storyId: s.storyMedia.storyId }).from(s.storyMedia).where(eq(s.storyMedia.mediaAssetId, mediaId));
  if (!links.length) return outcome(finding, false, "the asset is not attached to any story");

  const storyIds = links.map((link) => link.storyId);
  const stories = await db
    .select({ id: s.stories.id })
    .from(s.stories)
    .where(and(inArray(s.stories.id, storyIds), eq(s.stories.editionId, ctx.editionId)));
  if (!stories.length) return outcome(finding, false, "the asset belongs to another issue");

  await db.delete(s.storyMedia).where(and(eq(s.storyMedia.mediaAssetId, mediaId), inArray(s.storyMedia.storyId, stories.map((story) => story.id))));
  log.info("qc removed an ineligible picture from a story", { mediaId, editionId: ctx.editionId, stories: stories.length });
  return outcome(finding, true, `unlinked from ${stories.length} story(ies) in this issue`, "not placed");
}

/**
 * A photograph too coarse for where it is placed, swapped for one that is not.
 *
 * Only ever swapped for another picture *already attached to the same story* — never for something
 * found elsewhere in the library, which would be the software making an editorial choice. If the
 * story has nothing better, the finding stands and a person decides.
 */
export async function swapToValidAsset(finding: Finding, ctx: QcContext): Promise<RepairOutcome> {
  const mediaId = finding.location.entityId;
  if (!mediaId) return outcome(finding, false, "the finding names no asset");
  const minimum = ctx.profile.minimumPpi ?? 0;
  const placedMm = Number((finding.evidence as { placedMm?: number } | undefined)?.placedMm ?? 0);
  if (!minimum || !placedMm) return outcome(finding, false, "no profile minimum to swap towards");

  const link = await db.select({ storyId: s.storyMedia.storyId, role: s.storyMedia.role }).from(s.storyMedia).where(eq(s.storyMedia.mediaAssetId, mediaId)).limit(1);
  if (!link.length) return outcome(finding, false, "the asset is not attached to a story");

  const siblings = await db
    .select({ id: s.mediaAssets.id, width: s.mediaAssets.width, kind: s.mediaAssets.kind, rightsStatus: s.mediaAssets.rightsStatus, qualityFlags: s.mediaAssets.qualityFlags, isArchived: s.mediaAssets.isArchived, role: s.storyMedia.role })
    .from(s.storyMedia)
    .innerJoin(s.mediaAssets, eq(s.mediaAssets.id, s.storyMedia.mediaAssetId))
    .where(eq(s.storyMedia.storyId, link[0].storyId));

  const needed = Math.ceil((minimum * placedMm) / 25.4);
  const better = siblings
    .filter((each) => each.id !== mediaId && canIllustrate(each) && (each.width ?? 0) >= needed)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  if (!better) return outcome(finding, false, `the story has no other picture at least ${needed}px wide`);

  // Swap the roles so the better picture takes the place the coarse one had.
  await db.update(s.storyMedia).set({ role: link[0].role }).where(and(eq(s.storyMedia.storyId, link[0].storyId), eq(s.storyMedia.mediaAssetId, better.id)));
  await db.update(s.storyMedia).set({ role: "gallery" }).where(and(eq(s.storyMedia.storyId, link[0].storyId), eq(s.storyMedia.mediaAssetId, mediaId)));
  return outcome(finding, true, `swapped for a ${better.width}px picture already on the story`, `${better.width} px`);
}

/**
 * Text that still does not fit, given back to the paginator with more room to work in.
 *
 * The lever is the page's image scale: shrinking the figures frees text area, which is exactly what
 * the density pass already does when it is allowed to. Nothing is rewritten — an automatic repair
 * may move a picture, never a word.
 */
export async function reflowOverflow(finding: Finding): Promise<RepairOutcome> {
  const pageId = finding.location.entityId;
  if (!pageId) return outcome(finding, false, "the finding names no page");

  const page = await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageId) });
  if (!page) return outcome(finding, false, "the page is no longer on the plan");

  const current = Number(page.imageScale ?? 0);
  if (current >= 0.4) return outcome(finding, false, `the pictures on this page are already at their smallest (${current})`);
  const next = Math.min(0.4, current + 0.2);
  await db.update(s.pagePlanPages).set({ imageScale: next }).where(eq(s.pagePlanPages.id, pageId));
  log.info("qc shrank a page's figures to make room", { pageId, from: current, to: next });
  return outcome(finding, true, `shrank the page's figures from ${current} to ${next} to free text area`, next);
}

/** A signed URL that has expired, minted again. Cheap, and the commonest cause of a dead picture. */
export async function resignAssetUrl(finding: Finding): Promise<RepairOutcome> {
  const mediaId = finding.location.entityId;
  if (!mediaId) return outcome(finding, false, "the finding names no asset");
  const { mediaUrl } = await import("@/server/media/urls");
  const url = await mediaUrl(mediaId, "WEB", 400 * 24 * 60 * 60).catch(() => null);
  return url ? outcome(finding, true, "signed a fresh long-lived URL", "signed") : outcome(finding, false, "the asset has no file to sign a URL for");
}

/**
 * The artefact made again.
 *
 * The one repair that is not local, and deliberately the last resort: it is for defects *of the
 * artefact* — a page that will not parse, a page box the wrong size — where the issue itself is
 * fine and the file is not. It changes nothing editorial, so the remeasure still means something.
 */
export async function rerenderOutput(finding: Finding, ctx: QcContext): Promise<RepairOutcome> {
  try {
    const { requestExport } = await import("@/server/publication/versions");
    const { version } = await requestExport(ctx.editionId, { kind: "DRAFT", notes: `QC repair: ${finding.metricId}` });
    return outcome(finding, true, `queued a fresh render as ${version.label}`, version.label);
  } catch (err) {
    return outcome(finding, false, err instanceof Error ? err.message : String(err));
  }
}
