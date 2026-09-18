import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { registerJobHandler } from "@/server/jobs/registry";
import { getStorage } from "@/server/storage";
import { createLogger } from "@/server/logger";
import { launchBrowser } from "@/server/publication/pdf";
import { renderContactSheet, renderHtmlToImage, renderSpec } from "./render";
import { encoderReady, renderVideo } from "./video";
import { FORMATS } from "@/lib/creative/formats";
import { generateImagery, type ImageryProviderName } from "./imagery";
import { attachRendered, failAsset, getPack, hasCreditsLeft, recordCost } from "./service";
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

  /*
   * Everything already made at this fingerprint: nothing to do.
   *
   * On the assets rather than on the pack's status, because status is derived and assets are the
   * truth — and on the video too, not only the frames. Counting frames alone meant a Reel whose
   * frames rendered but whose encode was skipped (no ffmpeg on the host that day) reported "nothing
   * to render" forever afterwards: pressing Render again, which is exactly what somebody does after
   * installing the encoder, did nothing at all.
   */
  const done = pack.assets.filter((asset) => asset.kind === "FRAME" && asset.status === "READY").length;
  const missingVideo = FORMATS[pack.format].moving && !pack.assets.some((asset) => asset.kind === "VIDEO" && asset.status === "READY");
  // Owed only if it could actually be delivered. On a host with no encoder every "render again"
  // would otherwise redraw every frame in Chromium to arrive back at the same missing video.
  const owesVideo = missingVideo && (await encoderReady()).ok;
  if (!payload.force && done === pack.spec.frames.length && !owesVideo) {
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

  // Pictures the pack asked for and does not have yet. Done before the frames rather than during
  // them, so a provider that is slow or down is one delay at the start rather than a stall between
  // slides, and so the cost is recorded whether or not the render that follows succeeds.
  await fulfilGenerated(pack, images, browser, ctx.log);

  // Kept so the video can reuse them. Rendering a Reel's scenes a second time for the encoder is a
  // full Chromium pass per frame for bytes we already have in hand.
  const stills = new Map<number, { bytes: Buffer; mimeType: string }>();

  try {
    await renderSpec(pack.spec, {
      browser,
      images,
      onFrame: async (frame) => {
        stills.set(frame.index, { bytes: frame.bytes, mimeType: frame.mimeType });
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

    /*
     * A moving format also gets a video.
     *
     * After the stills rather than instead of them: the frames are the video's scenes, and a Reel
     * whose encode failed should still leave a pack somebody can look at and re-run. An encoder that
     * is missing fails this step alone, with a message naming the binary, rather than failing a
     * render that otherwise worked.
     */
    if (FORMATS[pack.format].moving) {
      const ready = await encoderReady();
      if (!ready.ok) {
        ctx.log(`no video: ${ready.detail}`);
      } else {
        const video = await renderVideo(pack.spec, { system: pack.motionSystem, browser, images, stills });
        const videoKey = keyFor(pack.id, "video.mp4");
        await storage.put(videoKey, video.bytes, { contentType: video.mimeType, cacheControl: "public, max-age=31536000, immutable" });
        await db
          .insert(s.creativeAssets)
          .values({
            organizationId: pack.organizationId,
            packId: pack.id,
            kind: "VIDEO",
            index: 0,
            status: "READY",
            storageKey: videoKey,
            mimeType: video.mimeType,
            width: video.width,
            height: video.height,
            durationSeconds: video.durationSeconds,
            sizeBytes: video.bytes.length,
            sha256: video.sha256,
          })
          .onConflictDoUpdate({
            target: [s.creativeAssets.packId, s.creativeAssets.kind, s.creativeAssets.index],
            set: {
              status: "READY",
              storageKey: videoKey,
              mimeType: video.mimeType,
              durationSeconds: video.durationSeconds,
              sizeBytes: video.bytes.length,
              sha256: video.sha256,
              updatedAt: new Date(),
            },
          });
        // Our own encoder, like our own renderer: free, and the ledger says so.
        await recordCost({
          organizationId: pack.organizationId,
          packId: pack.id,
          provider: "briefly",
          operation: "video",
          units: video.durationSeconds,
          unit: "second",
          costCents: 0,
        });
        ctx.log(`encoded ${video.durationSeconds.toFixed(1)}s of video`);
      }
    }

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
 * Make the pictures a spec asked for, once each, and keep them.
 *
 * Content-addressed on the key the composer put in the spec: an ask that has been fulfilled before —
 * by this pack, by another pack, by a render last week — is fetched from storage rather than bought
 * again. That is what stops "render again" from being a button that spends money, and it is why the
 * key is part of the fingerprint rather than a runtime id.
 *
 * A failure here never fails the render. The route ends at Briefly's own generator, which cannot
 * fail for want of a provider; if even that breaks, the frame falls back to the CSS field the
 * renderer draws inline, and the pack ships looking designed rather than broken.
 */
async function fulfilGenerated(
  pack: Awaited<ReturnType<typeof getPack>>,
  images: FrameImages,
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  logLine: (message: string, meta?: Record<string, unknown>) => void,
): Promise<void> {
  const wanted = new Map<string, NonNullable<NonNullable<(typeof pack.spec)>["frames"][number]["image"]>>();
  for (const frame of pack.spec?.frames ?? []) {
    if (frame.image?.generate && !frame.image.mediaId) wanted.set(frame.image.generate.key, frame.image);
  }
  if (!wanted.size) return;

  const storage = getStorage();
  // Super Admin may hold a workspace to a subset of providers — in-house only for a customer with a
  // procurement rule, say — independently of which keys happen to be configured.
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, pack.organizationId), columns: { settings: true } });
  const configured = (organization?.settings as { imageryProviders?: ImageryProviderName[] } | null)?.imageryProviders;

  /*
   * Out of credits is not out of pictures.
   *
   * A workspace that has spent its allowance falls back to Briefly's own generator, which costs
   * nothing and produces a designed ground from the brand's colours. Failing the render instead
   * would mean a customer loses a carousel they had already written because of a billing threshold,
   * which is the wrong end of the trade — the upgrade prompt belongs in the studio, not in a
   * half-rendered pack.
   */
  const affordable = await hasCreditsLeft(pack.organizationId, wanted.size);
  const allow = affordable ? configured : (["briefly"] as ImageryProviderName[]);
  if (!affordable) log.info("imagery allowance spent, drawing in-house", { packId: pack.id, images: wanted.size });

  for (const [key, image] of wanted) {
    const storageKey = `creative/generated/${key}.jpg`;
    const existing = await storage.exists(storageKey).catch(() => false);
    if (existing) {
      const bytes = await storage.get(storageKey);
      if (bytes) {
        images.set(key, `data:image/jpeg;base64,${bytes.toString("base64")}`);
        continue;
      }
    }

    try {
      const result = await generateImagery(
        { ...image.generate!, width: image.width, height: image.height },
        {
          allow,
          deps: {
            fetch: globalThis.fetch,
            renderHtml: (html, size) => renderHtmlToImage(html, size, { browser }),
          },
        },
      );
      await storage.put(storageKey, result.bytes, { contentType: result.mimeType, cacheControl: "public, max-age=31536000, immutable" });
      images.set(key, `data:${result.mimeType};base64,${result.bytes.toString("base64")}`);
      await recordCost({
        organizationId: pack.organizationId,
        packId: pack.id,
        provider: result.provider,
        operation: "image",
        model: result.model,
        units: 1,
        unit: "image",
        costCents: result.costCents,
        credits: result.credits,
      });
      logLine(`generated a ${image.generate!.subject} ground`, { provider: result.provider, key });
    } catch (error) {
      // The frame keeps its inline CSS field, which is a designed ground rather than a hole.
      log.warn("could not generate imagery", { packId: pack.id, key, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

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
  const ids = [...new Set(mediaIds)];
  const assets = await db.query.mediaAssets.findMany({
    where: (media, { inArray }) => inArray(media.id, ids),
    columns: { id: true, storageKey: true, mimeType: true },
  });
  // The 1600px web variant where one exists. A frame is 1080 wide, so the original — often a
  // 20-megapixel phone photograph — is fifteen times the bytes for no visible gain, inlined as a
  // data URI into a page Chromium has to parse before it can screenshot anything.
  const variants = await db.query.mediaVariants.findMany({
    where: (variant, { inArray: within, and: both, eq: is }) => both(within(variant.assetId, ids), is(variant.kind, "WEB")),
    columns: { assetId: true, storageKey: true, format: true },
  });
  const web = new Map(variants.map((variant) => [variant.assetId, variant]));

  for (const asset of assets) {
    const variant = web.get(asset.id);
    const key = variant?.storageKey ?? asset.storageKey;
    const mimeType = variant ? `image/${variant.format === "jpg" ? "jpeg" : variant.format}` : asset.mimeType;
    const bytes = await storage.get(key).catch(() => null);
    if (!bytes) {
      log.warn("media missing for render", { mediaId: asset.id, key });
      continue;
    }
    images.set(asset.id, `data:${mimeType};base64,${bytes.toString("base64")}`);
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
