import { createHash } from "node:crypto";
import sharp from "sharp";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { editions, mediaAssets, mediaVariants } from "@/server/db/schema";
import { optionalOrganizationId } from "@/server/tenancy/context";
import { extensionForMime, getStorage, storageKeys } from "@/server/storage";
import { createLogger } from "@/server/logger";
import { dHashFromGray, DUPLICATE_THRESHOLD, hammingDistance, SIMILAR_THRESHOLD } from "./hash";
import { scoreQuality, suggestCrops } from "./quality";

const log = createLogger("media:ingest");

export const SUPPORTED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/avif",
] as const;

export type IngestMediaInput = {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
  editionId?: string | null;
  submissionId?: string | null;
  contributorId?: string | null;
  userId?: string | null;
  caption?: string | null;
  altText?: string | null;
  photographer?: string | null;
  credit?: string | null;
  rightsStatus?: "GREEN" | "YELLOW" | "RED";
  rightsNote?: string | null;
  kind?: "photo" | "logo" | "screenshot" | "diagram" | "chart" | "document";
  /** Skip duplicate lookup (seeding many files quickly). */
  skipDuplicateCheck?: boolean;
};

export type IngestedMedia = {
  asset: typeof mediaAssets.$inferSelect;
  variants: (typeof mediaVariants.$inferSelect)[];
};

export async function sniffMime(buffer: Buffer, fallback?: string) {
  try {
    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(buffer);
    if (detected?.mime) return detected.mime;
  } catch (err) {
    log.warn("mime sniffing failed", { err });
  }
  return fallback ?? "application/octet-stream";
}

function guessKind(
  fileName: string,
  format: string,
  hasAlpha: boolean,
  width: number,
  height: number,
): IngestMediaInput["kind"] {
  const name = fileName.toLowerCase();
  if (/logo/.test(name)) return "logo";
  if (/screenshot|dashboard|screen/.test(name)) return "screenshot";
  if (/diagram|schema|flow/.test(name)) return "diagram";
  if (/chart|graph|plot/.test(name)) return "chart";
  if (format === "png" && hasAlpha && Math.max(width, height) < 1200) return "logo";
  return "photo";
}

/**
 * Ingests one image: validates, extracts metadata, computes hashes/quality, generates
 * thumbnail/web/print variants and stores everything. Never alters the original file.
 */
export async function ingestMedia(input: IngestMediaInput): Promise<IngestedMedia> {
  const storage = await getStorage();
  const mimeType = await sniffMime(input.buffer, input.mimeType);
  if (!(SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const image = sharp(input.buffer, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("Could not read image dimensions");
  const format = meta.format ?? extensionForMime(mimeType);
  const kind = input.kind ?? guessKind(input.fileName, format, !!meta.hasAlpha, width, height);

  const [stats, grayBuf] = await Promise.all([
    image.clone().stats(),
    image.clone().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer(),
  ]);
  const phash = dHashFromGray(grayBuf, 9, 8);
  const dominant = stats.dominant
    ? `#${[stats.dominant.r, stats.dominant.g, stats.dominant.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
    : null;
  const sharpness = stats.channels.length
    ? stats.channels.reduce((s, c) => s + c.stdev, 0) / stats.channels.length
    : null;
  const quality = scoreQuality({
    width,
    height,
    sizeBytes: input.buffer.byteLength,
    format,
    kind: kind ?? "photo",
    sharpness,
  });

  const assetId = crypto.randomUUID();
  const ext = extensionForMime(mimeType);
  const originalKey = storageKeys.mediaOriginal(assetId, ext);
  await storage.put(originalKey, input.buffer, { contentType: mimeType });

  const variantRows: (typeof mediaVariants.$inferInsert)[] = [];
  for (const variant of await buildVariants(input.buffer, mimeType)) {
    const key = storageKeys.mediaVariant(assetId, variant.kind, variant.format);
    await storage.put(key, variant.data, {
      contentType: variant.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });
    variantRows.push({
      assetId,
      kind: variant.kind,
      storageKey: key,
      width: variant.width,
      height: variant.height,
      sizeBytes: variant.data.byteLength,
      format: variant.format,
      cropSpec: null,
    });
  }

  let duplicateOfId: string | null = null;
  let similarityGroup: string | null = null;
  const flags = [...quality.flags];
  if (!input.skipDuplicateCheck) {
    const candidates = await db
      .select({
        id: mediaAssets.id,
        sha256: mediaAssets.sha256,
        phash: mediaAssets.phash,
        similarityGroup: mediaAssets.similarityGroup,
      })
      .from(mediaAssets)
      .where(
        and(
          isNotNull(mediaAssets.phash),
          ne(mediaAssets.id, assetId),
          input.editionId ? eq(mediaAssets.editionId, input.editionId) : undefined,
        ),
      );
    for (const c of candidates) {
      if (c.sha256 === sha256) {
        duplicateOfId = c.id;
        flags.push("EXACT_DUPLICATE");
        similarityGroup = c.similarityGroup ?? c.id;
        break;
      }
      const d = c.phash ? hammingDistance(c.phash, phash) : 99;
      if (d <= DUPLICATE_THRESHOLD) {
        duplicateOfId = duplicateOfId ?? c.id;
        if (!flags.includes("NEAR_DUPLICATE")) flags.push("NEAR_DUPLICATE");
        similarityGroup = similarityGroup ?? c.similarityGroup ?? c.id;
      } else if (d <= SIMILAR_THRESHOLD) {
        similarityGroup = similarityGroup ?? c.similarityGroup ?? c.id;
        if (!flags.includes("SIMILAR_IMAGE")) flags.push("SIMILAR_IMAGE");
      }
    }
    if (similarityGroup) {
      await db
        .update(mediaAssets)
        .set({ similarityGroup })
        .where(
          and(
            eq(mediaAssets.id, similarityGroup),
            eq(mediaAssets.similarityGroup, similarityGroup),
          ),
        );
      await db
        .update(mediaAssets)
        .set({ similarityGroup })
        .where(eq(mediaAssets.id, similarityGroup));
    }
  }

  // An asset belongs to the workspace that owns the edition it was filed against; uploads that are
  // not tied to an edition fall back to the workspace in scope for the request.
  const organizationId =
    (input.editionId ? (await db.query.editions.findFirst({ where: eq(editions.id, input.editionId), columns: { organizationId: true } }))?.organizationId : null) ??
    (await optionalOrganizationId());

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      id: assetId,
      organizationId,
      editionId: input.editionId ?? null,
      submissionId: input.submissionId ?? null,
      uploadedByContributorId: input.contributorId ?? null,
      uploadedByUserId: input.userId ?? null,
      storageKey: originalKey,
      fileName: input.fileName,
      mimeType,
      sizeBytes: input.buffer.byteLength,
      width,
      height,
      format,
      aspectRatio: Math.round((width / height) * 1000) / 1000,
      orientation: width >= height ? (width === height ? "square" : "landscape") : "portrait",
      dominantColour: dominant,
      sha256,
      phash,
      qualityScore: quality.score,
      qualityFlags: flags,
      caption: input.caption ?? null,
      altText: input.altText ?? null,
      photographer: input.photographer ?? null,
      credit: input.credit ?? (input.photographer ? `© ${input.photographer}` : null),
      rightsStatus: input.rightsStatus ?? "YELLOW",
      rightsNote: input.rightsNote ?? null,
      kind: kind ?? "photo",
      suggestedCrops: suggestCrops(width, height),
      duplicateOfId,
      similarityGroup,
      metadata: {
        density: meta.density ?? null,
        hasAlpha: !!meta.hasAlpha,
        space: meta.space ?? null,
        exifBytes: meta.exif?.byteLength ?? 0,
      },
    })
    .returning();
  const variants = await db.insert(mediaVariants).values(variantRows).returning();
  log.info("ingested", { assetId, width, height, kind, quality: quality.score, flags });
  return { asset, variants };
}

export type BuiltVariant = {
  kind: "THUMBNAIL" | "WEB" | "PRINT";
  format: "webp" | "png" | "jpeg";
  contentType: string;
  data: Buffer;
  width: number;
  height: number;
};

/**
 * The three sizes every picture is kept in, derived from the original.
 *
 * Extracted from the ingest so that a preflight repair can rebuild a variant whose file has gone
 * missing without duplicating the recipe — a thumbnail regenerated at different settings from the
 * one beside it is a subtler defect than the missing file it replaced.
 */
export async function buildVariants(original: Buffer, mimeType: string): Promise<BuiltVariant[]> {
  const format = mimeType.split("/")[1]?.toLowerCase() ?? "";
  const keepPng = format === "png" || format === "gif";
  const specs = [
    { kind: "THUMBNAIL" as const, width: 480, format: "webp" as const, quality: 78 },
    { kind: "WEB" as const, width: 1600, format: "webp" as const, quality: 82 },
    { kind: "PRINT" as const, width: 2600, format: keepPng ? ("png" as const) : ("jpeg" as const), quality: 92 },
  ];
  const out: BuiltVariant[] = [];
  for (const spec of specs) {
    let pipeline = sharp(original, { failOn: "none" }).rotate().resize({ width: spec.width, withoutEnlargement: true });
    if (spec.format === "webp") pipeline = pipeline.webp({ quality: spec.quality });
    else if (spec.format === "png") pipeline = pipeline.png({ compressionLevel: 9 });
    else pipeline = pipeline.jpeg({ quality: spec.quality, mozjpeg: true, chromaSubsampling: "4:4:4" });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    out.push({ kind: spec.kind, format: spec.format, contentType: `image/${spec.format}`, data, width: info.width, height: info.height });
  }
  return out;
}
