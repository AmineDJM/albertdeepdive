import sharp from "sharp";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit, recordDecision } from "@/server/audit";
import { getStorage, storageKeys } from "@/server/storage";
import { createLogger } from "@/server/logger";
import { guardTenant } from "@/server/tenancy/scope";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { CONSENT_TEXT_VERSION } from "@/lib/constants";
import { type Permission, type Role, roleHasPermission } from "@/lib/auth/permissions";
import {
  MEDIA_KINDS,
  RIGHTS_STATUSES,
  STORY_MEDIA_ROLES,
  type RightsStatus,
  type StoryMediaRole,
} from "./constants";

const log = createLogger("media:rights");

/** Who performs a mutation. Server actions pass the current user; the role is re-checked here. */
export type MediaActor = { id: string; role: Role };

function assertActor(actor: MediaActor, permission: Permission) {
  if (!roleHasPermission(actor.role, permission))
    throw new ForbiddenError(`Missing permission: ${permission}`);
}

/** One asset of the active workspace. Another workspace's id is "not found", like one that never existed. */
async function loadAsset(assetId: string) {
  const asset = await guardTenant(await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, assetId) }), "Media asset");
  if (!asset) throw new NotFoundError("Media asset");
  return asset;
}

/* ──────────────────────────────────────────────────────────────────────────
   Rights
   ────────────────────────────────────────────────────────────────────────── */

export const rightsStatusSchema = z.enum(RIGHTS_STATUSES);
export const rightsNoteSchema = z.string().trim().max(1000).nullable().optional();

/**
 * Sets the rights status of one asset. Every change is an editorial decision (with the previous
 * value) and an audit entry, because RED blocks the asset at export and GREEN clears it for print.
 */
export async function setRightsStatus(
  assetId: string,
  status: RightsStatus,
  note: string | null | undefined,
  actor: MediaActor,
) {
  assertActor(actor, "media:rights");
  const parsedStatus = rightsStatusSchema.parse(status);
  // undefined keeps the existing note; "" or null clears it.
  const parsedNote = note === undefined ? undefined : rightsNoteSchema.parse(note) || null;
  const asset = await loadAsset(assetId);
  const [row] = await db
    .update(s.mediaAssets)
    .set({
      rightsStatus: parsedStatus,
      rightsNote: parsedNote === undefined ? asset.rightsNote : parsedNote,
    })
    .where(eq(s.mediaAssets.id, assetId))
    .returning();
  await recordDecision({
    editionId: asset.editionId,
    entityType: "MEDIA",
    entityId: assetId,
    decision: `RIGHTS_${parsedStatus}`,
    reason: parsedNote,
    previousValue: { rightsStatus: asset.rightsStatus, rightsNote: asset.rightsNote },
    newValue: { rightsStatus: parsedStatus, rightsNote: row.rightsNote },
    userId: actor.id,
  });
  return row;
}

export async function bulkSetRights(
  assetIds: string[],
  status: RightsStatus,
  note: string | null | undefined,
  actor: MediaActor,
) {
  assertActor(actor, "media:rights");
  const ids = [...new Set(assetIds)];
  if (!ids.length) throw new ValidationError("Select at least one asset");
  if (ids.length > 500) throw new ValidationError("Too many assets at once (max 500)");
  let updated = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await setRightsStatus(id, status, note, actor);
      updated += 1;
    } catch (err) {
      failed.push(id);
      log.warn("bulk rights: asset skipped", { id, err });
    }
  }
  return { updated, failed };
}

/* ──────────────────────────────────────────────────────────────────────────
   Metadata
   ────────────────────────────────────────────────────────────────────────── */

export const mediaMetadataSchema = z.object({
  caption: z.string().trim().max(400).nullable().optional(),
  altText: z.string().trim().max(400).nullable().optional(),
  photographer: z.string().trim().max(120).nullable().optional(),
  credit: z.string().trim().max(160).nullable().optional(),
  kind: z.enum(MEDIA_KINDS).optional(),
});
export type MediaMetadataPatch = z.input<typeof mediaMetadataSchema>;

export async function updateMediaMetadata(
  assetId: string,
  rawPatch: MediaMetadataPatch,
  actor: MediaActor,
) {
  assertActor(actor, "media:manage");
  const patch = mediaMetadataSchema.parse(rawPatch);
  const asset = await loadAsset(assetId);
  const values: Partial<typeof s.mediaAssets.$inferInsert> = {};
  const changed: string[] = [];
  for (const key of ["caption", "altText", "photographer", "credit"] as const) {
    if (patch[key] === undefined) continue;
    const next = patch[key] === "" ? null : (patch[key] ?? null);
    if (next !== asset[key]) {
      values[key] = next;
      changed.push(key);
    }
  }
  if (patch.kind && patch.kind !== asset.kind) {
    values.kind = patch.kind;
    values.metadata = { ...asset.metadata, kindSetByUser: true };
    changed.push("kind");
  }
  if (!changed.length) return asset;
  const [row] = await db
    .update(s.mediaAssets)
    .set(values)
    .where(eq(s.mediaAssets.id, assetId))
    .returning();
  await audit({
    action: "media.update",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
    metadata: { fields: changed },
  });
  return row;
}

/* ──────────────────────────────────────────────────────────────────────────
   Archive / restore
   ────────────────────────────────────────────────────────────────────────── */

export async function archiveMedia(assetId: string, actor: MediaActor) {
  assertActor(actor, "media:manage");
  const asset = await loadAsset(assetId);
  if (asset.isArchived) return asset;
  const [row] = await db
    .update(s.mediaAssets)
    .set({ isArchived: true })
    .where(eq(s.mediaAssets.id, assetId))
    .returning();
  await audit({
    action: "media.archive",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
    metadata: { fileName: asset.fileName },
  });
  return row;
}

export async function restoreMedia(assetId: string, actor: MediaActor) {
  assertActor(actor, "media:manage");
  const asset = await loadAsset(assetId);
  if (!asset.isArchived) return asset;
  const [row] = await db
    .update(s.mediaAssets)
    .set({ isArchived: false })
    .where(eq(s.mediaAssets.id, assetId))
    .returning();
  await audit({
    action: "media.restore",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
    metadata: { fileName: asset.fileName },
  });
  return row;
}

export async function bulkArchive(assetIds: string[], actor: MediaActor) {
  assertActor(actor, "media:manage");
  const ids = [...new Set(assetIds)];
  if (!ids.length) throw new ValidationError("Select at least one asset");
  let archived = 0;
  for (const id of ids) {
    try {
      await archiveMedia(id, actor);
      archived += 1;
    } catch (err) {
      log.warn("bulk archive: asset skipped", { id, err });
    }
  }
  return { archived };
}

/* ──────────────────────────────────────────────────────────────────────────
   Delete
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Deletes a picture for good: the row, its variants, and the files in storage.
 *
 * Archiving hides; this removes. Everything that pointed at the picture lets go of it in the same
 * transaction — a story's link, an article's image block, a page's placement, an edition's cover,
 * the workspace's logo — so nothing is left pointing at a hole, and a page that used it is laid
 * out again without it. The files go after the rows: a storage hiccup leaves a stray file, which
 * the storage audit lists, never a row pointing at a missing file. Frozen artefacts (a PDF that
 * already went out) keep their copy, because they are what was sent.
 */
export async function deleteMedia(assetId: string, actor: MediaActor): Promise<{ id: string; fileName: string; files: number }> {
  assertActor(actor, "media:manage");
  const asset = await loadAsset(assetId);
  const variants = await db.select({ storageKey: s.mediaVariants.storageKey }).from(s.mediaVariants).where(eq(s.mediaVariants.assetId, assetId));
  const keys = [...new Set([asset.storageKey, ...variants.map((v) => v.storageKey)].filter(Boolean))];

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update articles set body = (
        select coalesce(jsonb_agg(block order by position), '[]'::jsonb)
        from jsonb_array_elements(body) with ordinality as blocks(block, position)
        where not (block->>'type' = 'image' and block->>'assetId' = ${assetId})
      )
      where body @> ${JSON.stringify([{ type: "image", assetId }])}::jsonb`);
    await tx.execute(sql`update page_plan_pages set media_asset_ids = array_remove(media_asset_ids, ${assetId}::uuid) where ${assetId}::uuid = any(media_asset_ids)`);
    await tx.update(s.editions).set({ coverMediaAssetId: null }).where(eq(s.editions.coverMediaAssetId, assetId));
    await tx.update(s.organizations).set({ logoMediaId: null }).where(eq(s.organizations.logoMediaId, assetId));
    // Variants, story links and attachments' pointers go with the row (cascade / set null).
    await tx.delete(s.mediaAssets).where(eq(s.mediaAssets.id, assetId));
  });

  const storage = await getStorage();
  let removed = 0;
  for (const key of keys) {
    try {
      await storage.delete(key);
      removed += 1;
    } catch (err) {
      log.warn("delete: file left in storage", { assetId, key, err });
    }
  }
  await audit({
    action: "media.delete",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
    metadata: { fileName: asset.fileName, files: removed, of: keys.length },
  });
  return { id: assetId, fileName: asset.fileName, files: removed };
}

export async function bulkDelete(assetIds: string[], actor: MediaActor) {
  assertActor(actor, "media:manage");
  const ids = [...new Set(assetIds)];
  if (!ids.length) throw new ValidationError("Select at least one asset");
  let deleted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await deleteMedia(id, actor);
      deleted += 1;
    } catch (err) {
      failed += 1;
      log.warn("bulk delete: asset skipped", { id, err });
    }
  }
  return { deleted, failed };
}

/* ──────────────────────────────────────────────────────────────────────────
   Duplicates
   ────────────────────────────────────────────────────────────────────────── */

const DUPLICATE_FLAGS = ["EXACT_DUPLICATE", "NEAR_DUPLICATE"];

/** Marks `assetId` as a duplicate of `duplicateOfId`; both join the same similarity group. */
export async function markDuplicate(assetId: string, duplicateOfId: string, actor: MediaActor) {
  assertActor(actor, "media:manage");
  if (assetId === duplicateOfId)
    throw new ValidationError("An asset cannot be a duplicate of itself");
  const [asset, original] = await Promise.all([loadAsset(assetId), loadAsset(duplicateOfId)]);
  if (original.duplicateOfId === assetId)
    throw new ValidationError("The other asset is already marked as a duplicate of this one");
  const group = original.similarityGroup ?? asset.similarityGroup ?? original.id;
  const flags = asset.qualityFlags.some((f) => DUPLICATE_FLAGS.includes(f))
    ? asset.qualityFlags
    : [...asset.qualityFlags, "NEAR_DUPLICATE"];
  const restMeta: Record<string, unknown> = { ...asset.metadata };
  delete restMeta.duplicateCleared;
  const [row] = await db
    .update(s.mediaAssets)
    .set({
      duplicateOfId: original.id,
      similarityGroup: group,
      qualityFlags: flags,
      metadata: restMeta,
    })
    .where(eq(s.mediaAssets.id, assetId))
    .returning();
  if (original.similarityGroup !== group)
    await db
      .update(s.mediaAssets)
      .set({ similarityGroup: group })
      .where(eq(s.mediaAssets.id, original.id));
  await audit({
    action: "media.duplicate.mark",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
    metadata: {
      duplicateOfId: original.id,
      fileName: asset.fileName,
      originalFileName: original.fileName,
    },
  });
  return row;
}

/** Clears a duplicate relation. The asset remembers the decision so automatic re-checks respect it. */
export async function clearDuplicate(assetId: string, actor: MediaActor) {
  assertActor(actor, "media:manage");
  const asset = await loadAsset(assetId);
  const [row] = await db
    .update(s.mediaAssets)
    .set({
      duplicateOfId: null,
      similarityGroup: null,
      qualityFlags: asset.qualityFlags.filter(
        (f) => f !== "EXACT_DUPLICATE" && f !== "NEAR_DUPLICATE" && f !== "SIMILAR_IMAGE",
      ),
      metadata: { ...asset.metadata, duplicateCleared: true },
    })
    .where(eq(s.mediaAssets.id, assetId))
    .returning();
  await audit({
    action: "media.duplicate.clear",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
    metadata: { previousDuplicateOfId: asset.duplicateOfId },
  });
  return row;
}

/* ──────────────────────────────────────────────────────────────────────────
   Consent
   ────────────────────────────────────────────────────────────────────────── */

export const imageConsentSchema = z.object({
  contributorId: z.string().uuid().nullable().optional(),
  accepted: z.boolean().default(true),
  textVersion: z.string().trim().min(1).max(40).default(CONSENT_TEXT_VERSION),
  ipHash: z.string().max(64).nullable().optional(),
  userAgent: z.string().max(300).nullable().optional(),
});
export type ImageConsentInput = z.input<typeof imageConsentSchema>;

/** Records an IMAGE_RIGHTS consent for one asset (from the public form or logged by an editor). */
export async function recordImageConsent(
  assetId: string,
  rawInput: ImageConsentInput,
  recordedByUserId?: string | null,
) {
  const input = imageConsentSchema.parse(rawInput);
  const asset = await loadAsset(assetId);
  const contributorId = input.contributorId ?? asset.uploadedByContributorId ?? null;
  const [row] = await db
    .insert(s.consentRecords)
    .values({
      submissionId: asset.submissionId,
      contributorId,
      mediaAssetId: assetId,
      type: "IMAGE_RIGHTS",
      textVersion: input.textVersion,
      accepted: input.accepted,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .returning();
  await audit({
    action: input.accepted ? "media.consent.record" : "media.consent.decline",
    userId: recordedByUserId ?? null,
    actorType: recordedByUserId ? "USER" : "CONTRIBUTOR",
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
    metadata: { contributorId, textVersion: input.textVersion, accepted: input.accepted },
    ipHash: input.ipHash ?? null,
  });
  return row;
}

/* ──────────────────────────────────────────────────────────────────────────
   Story links
   ────────────────────────────────────────────────────────────────────────── */

export const storyMediaRoleSchema = z.enum(STORY_MEDIA_ROLES);
/** Roles that a story can only have once; attaching a new one demotes the previous holder to gallery. */
const SINGLETON_ROLES: StoryMediaRole[] = ["hero", "cover"];

async function loadStoryFor(assetId: string, storyId: string) {
  const [asset, story] = await Promise.all([
    loadAsset(assetId),
    db.query.stories.findFirst({
      where: eq(s.stories.id, storyId),
      columns: { id: true, editionId: true, title: true },
    }),
  ]);
  if (!story) throw new NotFoundError("Story");
  if (asset.editionId && asset.editionId !== story.editionId)
    throw new ValidationError("This asset belongs to another edition");
  return { asset, story };
}

async function demoteSingletonRole(storyId: string, role: string, exceptAssetId: string) {
  if (!SINGLETON_ROLES.includes(role as StoryMediaRole)) return;
  await db
    .update(s.storyMedia)
    .set({ role: "gallery" })
    .where(
      and(
        eq(s.storyMedia.storyId, storyId),
        eq(s.storyMedia.role, role),
        ne(s.storyMedia.mediaAssetId, exceptAssetId),
      ),
    );
}

/** Links an asset to a story with a role (idempotent: re-attaching updates the role). */
export async function attachToStory(
  assetId: string,
  storyId: string,
  role: StoryMediaRole = "gallery",
  actor: MediaActor,
) {
  assertActor(actor, "media:manage");
  const parsedRole = storyMediaRoleSchema.parse(role);
  const { asset, story } = await loadStoryFor(assetId, storyId);
  if (asset.rightsStatus === "RED")
    throw new ValidationError(
      "This asset is blocked (rights RED) and cannot be attached to a story",
    );
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${s.storyMedia.sortOrder}), -1) + 1` })
    .from(s.storyMedia)
    .where(eq(s.storyMedia.storyId, storyId));
  await demoteSingletonRole(storyId, parsedRole, assetId);
  const [row] = await db
    .insert(s.storyMedia)
    .values({
      storyId,
      mediaAssetId: assetId,
      role: parsedRole,
      sortOrder: Number(next),
      addedByAi: false,
    })
    .onConflictDoUpdate({
      target: [s.storyMedia.storyId, s.storyMedia.mediaAssetId],
      set: { role: parsedRole },
    })
    .returning();
  if (!asset.editionId)
    await db
      .update(s.mediaAssets)
      .set({ editionId: story.editionId })
      .where(eq(s.mediaAssets.id, assetId));
  await audit({
    action: "media.attach",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: story.editionId,
    metadata: { storyId, storyTitle: story.title, role: parsedRole },
  });
  return row;
}

export async function detachFromStory(assetId: string, storyId: string, actor: MediaActor) {
  assertActor(actor, "media:manage");
  const { asset, story } = await loadStoryFor(assetId, storyId);
  const deleted = await db
    .delete(s.storyMedia)
    .where(and(eq(s.storyMedia.storyId, storyId), eq(s.storyMedia.mediaAssetId, assetId)))
    .returning();
  if (!deleted.length) throw new NotFoundError("Story link");
  await audit({
    action: "media.detach",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId ?? story.editionId,
    metadata: { storyId, storyTitle: story.title, role: deleted[0].role },
  });
  return deleted[0];
}

export async function setStoryMediaRole(
  assetId: string,
  storyId: string,
  role: StoryMediaRole,
  actor: MediaActor,
) {
  assertActor(actor, "media:manage");
  const parsedRole = storyMediaRoleSchema.parse(role);
  const { asset, story } = await loadStoryFor(assetId, storyId);
  await demoteSingletonRole(storyId, parsedRole, assetId);
  const [row] = await db
    .update(s.storyMedia)
    .set({ role: parsedRole })
    .where(and(eq(s.storyMedia.storyId, storyId), eq(s.storyMedia.mediaAssetId, assetId)))
    .returning();
  if (!row) throw new NotFoundError("Story link");
  await audit({
    action: "media.role",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId ?? story.editionId,
    metadata: { storyId, storyTitle: story.title, role: parsedRole },
  });
  return row;
}

/* ──────────────────────────────────────────────────────────────────────────
   Crops
   ────────────────────────────────────────────────────────────────────────── */

export const cropSchema = z.object({
  name: z.string().trim().min(1).max(40),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(16),
  height: z.number().int().min(16),
  aspect: z.string().trim().max(20).optional(),
});
export type CropInput = z.input<typeof cropSchema>;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Human aspect label ("3:2", "16:9", or "1.37:1" when the ratio is not a small fraction). */
export function aspectLabel(width: number, height: number) {
  const g = gcd(width, height);
  const w = width / g;
  const h = height / g;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}:1`;
}

/**
 * Generates (or replaces) the CROP variant of an asset from the original file. Coordinates are in
 * the pixel space of the stored asset (after EXIF auto-rotation, like `width`/`height`).
 */
export async function setCrop(assetId: string, rawCrop: CropInput, actor: MediaActor) {
  assertActor(actor, "media:manage");
  const crop = cropSchema.parse(rawCrop);
  const asset = await loadAsset(assetId);
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (crop.x + crop.width > width || crop.y + crop.height > height) {
    throw new ValidationError(`Crop exceeds the image bounds (${width}×${height})`, {
      crop: ["Out of bounds"],
    });
  }
  const storage = await getStorage();
  const original = await storage.get(asset.storageKey);
  if (!original) throw new NotFoundError("Original file");

  const keepPng =
    (asset.format === "png" || asset.format === "gif") &&
    !!(asset.metadata as { hasAlpha?: boolean }).hasAlpha;
  const format: "png" | "jpeg" = keepPng ? "png" : "jpeg";
  let pipeline = sharp(original, { failOn: "none" })
    .rotate()
    .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height });
  pipeline =
    format === "png"
      ? pipeline.png({ compressionLevel: 9 })
      : pipeline.jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: "4:4:4" });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const key = storageKeys.mediaVariant(assetId, "CROP", format);
  await storage.put(key, data, {
    contentType: `image/${format}`,
    cacheControl: "private, max-age=3600",
  });

  const cropSpec: s.CropSuggestion = {
    name: crop.name,
    aspect: crop.aspect ?? aspectLabel(crop.width, crop.height),
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
  };
  const variant = await db.transaction(async (tx) => {
    const previous = await tx
      .delete(s.mediaVariants)
      .where(and(eq(s.mediaVariants.assetId, assetId), eq(s.mediaVariants.kind, "CROP")))
      .returning({ storageKey: s.mediaVariants.storageKey });
    const [row] = await tx
      .insert(s.mediaVariants)
      .values({
        assetId,
        kind: "CROP",
        storageKey: key,
        width: info.width,
        height: info.height,
        sizeBytes: data.byteLength,
        format,
        cropSpec,
      })
      .returning();
    return { row, previousKey: previous[0]?.storageKey };
  });
  if (variant.previousKey && variant.previousKey !== key) {
    try {
      await storage.delete(variant.previousKey);
    } catch (err) {
      log.warn("could not delete previous crop file", { key: variant.previousKey, err });
    }
  }
  await audit({
    action: "media.crop",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
    metadata: { ...cropSpec },
  });
  const url = await storage.getSignedUrl(key, { expiresInSeconds: 3600 });
  return { variant: variant.row, url };
}

/** Removes the CROP variant (file + row). */
export async function clearCrop(assetId: string, actor: MediaActor) {
  assertActor(actor, "media:manage");
  const asset = await loadAsset(assetId);
  const deleted = await db
    .delete(s.mediaVariants)
    .where(and(eq(s.mediaVariants.assetId, assetId), eq(s.mediaVariants.kind, "CROP")))
    .returning();
  if (!deleted.length) throw new AppError("This asset has no crop", "NOT_FOUND", 404);
  try {
    await (await getStorage()).delete(deleted[0].storageKey);
  } catch (err) {
    log.warn("could not delete crop file", { key: deleted[0].storageKey, err });
  }
  await audit({
    action: "media.crop.clear",
    userId: actor.id,
    entityType: "MEDIA",
    entityId: assetId,
    editionId: asset.editionId,
  });
  return deleted[0];
}
