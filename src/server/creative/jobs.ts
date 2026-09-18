import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { registerJobHandler } from "@/server/jobs/registry";
import { getStorage } from "@/server/storage";
import { createLogger } from "@/server/logger";
import { launchBrowser } from "@/server/publication/pdf";
import { renderContactSheet, renderSpec } from "./render";
import { attachRendered, failAsset, getPack, recordCost } from "./service";
import type { FrameImages } from "./render-html";

const log = createLogger("creative-jobs");

/**
 * Rendering, off the request.
 *
 * A ten-slide carousel is about half a second of Chromium; a video is minutes. Neither belongs in a
 * request, and the difference between them is only degree, so both go through the same queue rather
 * than one being "fast enough" until the day it is not.
 *
 * The job is idempotent on the pack's fingerprint. Re-running it after nothing changed re-renders
 * nothing: the fingerprint is a hash of the resolved spec, so identical inputs produce identical
 * bytes and there is nothing to gain from producing them twice. That is what makes "render" a safe
 * button to press twice.
 */

export const CREATIVE_RENDER = "creative.render";

type RenderPayload = { packId: string; force?: boolean };

/** Where a pack's files live. Grouped by pack so deleting one is a prefix delete. */
const keyFor = (packId: string, name: string) => `creative/${packId}/${name}`;

registerJobHandler<RenderPayload, { frames: number; skipped: boolean }>(CREATIVE_RENDER, async (payload, ctx) => {
  const pack = await getPack(payload.packId);
  if (!pack.spec) throw new Error("This pack has no spec to render. Direct it first.");

  // Everything already rendered at this fingerprint: nothing to do. The check is on the assets
  // rather than on the pack's status, because status is derived and assets are the truth.
  const done = pack.assets.filter((asset) => asset.kind === "FRAME" && asset.status === "READY").length;
  if (!payload.force && done === pack.spec.frames.length) {
    ctx.log("nothing to render", { packId: pack.id, fingerprint: pack.fingerprint });
    return { frames: done, skipped: true };
  }

  await db.update(s.creativePacks).set({ status: "RENDERING", error: null, updatedAt: new Date() }).where(eq(s.creativePacks.id, pack.id));
  await db
    .update(s.creativeAssets)
    .set({ status: "RENDERING", updatedAt: new Date() })
    .where(and(eq(s.creativeAssets.packId, pack.id), eq(s.creativeAssets.status, "PENDING")));

  const storage = getStorage();
  const images = await loadImages(pack.spec.frames.flatMap((frame) => (frame.image?.mediaId ? [frame.image.mediaId] : [])));
  const browser = await launchBrowser();
  let rendered = 0;

  try {
    await renderSpec(pack.spec, {
      browser,
      images,
      onFrame: async (frame) => {
        const extension = frame.mimeType === "image/jpeg" ? "jpg" : "png";
        const key = keyFor(pack.id, `frame-${String(frame.index + 1).padStart(2, "0")}.${extension}`);
        await storage.put(key, frame.bytes, { contentType: frame.mimeType, cacheControl: "public, max-age=31536000, immutable" });
        await attachRendered({
          packId: pack.id,
          index: frame.index,
          storageKey: key,
          mimeType: frame.mimeType,
          sizeBytes: frame.bytes.length,
          sha256: frame.sha256,
        });
        rendered += 1;
        await ctx.progress(rendered, pack.spec!.frames.length, `frame ${rendered}`);
      },
    });

    // The cover is what the studio's list shows and what somebody shares before posting.
    const sheet = await renderContactSheet(pack.spec, { browser, images });
    const coverKey = keyFor(pack.id, "cover.jpg");
    await storage.put(coverKey, sheet.bytes, { contentType: sheet.mimeType, cacheControl: "public, max-age=31536000, immutable" });
    await db
      .insert(s.creativeAssets)
      .values({
        organizationId: pack.organizationId,
        packId: pack.id,
        kind: "COVER",
        index: 0,
        status: "READY",
        storageKey: coverKey,
        mimeType: sheet.mimeType,
        width: sheet.width,
        height: sheet.height,
        sizeBytes: sheet.bytes.length,
        sha256: sheet.sha256,
      })
      .onConflictDoUpdate({
        target: [s.creativeAssets.packId, s.creativeAssets.kind, s.creativeAssets.index],
        set: { status: "READY", storageKey: coverKey, mimeType: sheet.mimeType, sizeBytes: sheet.bytes.length, sha256: sheet.sha256, updatedAt: new Date() },
      });

    // Our own renderer costs nothing, and the ledger says so rather than staying silent: a pack with
    // no cost row cannot be told apart from one nobody has rendered.
    await recordCost({
      organizationId: pack.organizationId,
      packId: pack.id,
      provider: "briefly",
      operation: "render",
      units: rendered,
      unit: "frame",
      costCents: 0,
    });

    log.info("pack rendered", { packId: pack.id, frames: rendered });
    return { frames: rendered, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failAsset(pack.id, rendered, message);
    await db.update(s.creativePacks).set({ status: "FAILED", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(s.creativePacks.id, pack.id));
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
});

/**
 * The organisation's own photographs, as data URIs.
 *
 * Read through the storage adapter and inlined, never fetched over HTTP. The renderer must not
 * depend on a signed URL still being valid, on the app being reachable from wherever the worker
 * runs, or on a network that might be slow — a picture that arrives late is a picture missing from
 * the frame, and the screenshot will not wait.
 */
async function loadImages(mediaIds: string[]): Promise<FrameImages> {
  const images: FrameImages = new Map();
  if (!mediaIds.length) return images;

  const storage = getStorage();
  const assets = await db.query.mediaAssets.findMany({
    where: (media, { inArray }) => inArray(media.id, [...new Set(mediaIds)]),
    columns: { id: true, storageKey: true, mimeType: true },
  });

  for (const asset of assets) {
    const bytes = await storage.get(asset.storageKey).catch(() => null);
    if (!bytes) {
      log.warn("media missing for render", { mediaId: asset.id, key: asset.storageKey });
      continue;
    }
    images.set(asset.id, `data:${asset.mimeType};base64,${bytes.toString("base64")}`);
  }
  return images;
}

/**
 * Queue a render.
 *
 * Keyed on the fingerprint, so pressing the button twice while the first run is still going does not
 * queue a second one, and a re-render after an edit is a genuinely different job.
 */
export async function enqueueRender(pack: { id: string; fingerprint: string | null; organizationId: string }, actorId?: string | null) {
  return enqueueJob({
    type: CREATIVE_RENDER,
    payload: { packId: pack.id },
    idempotencyKey: `creative:${pack.id}:${pack.fingerprint ?? "none"}`,
    createdById: actorId ?? null,
    priority: 4,
    maxAttempts: 2,
  });
}
